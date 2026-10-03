// Relies on Dawn globals: fetchConfig (global.js), publish/subscribe (pubsub.js), PUB_SUB_EVENTS (constants.js).
// The Three.js scene (hb-3d-scene.js, built from src/hb-3d) is only imported once the section nears the viewport.
if (!customElements.get('hb-configurator')) {
  customElements.define(
    'hb-configurator',
    class HbConfigurator extends HTMLElement {
      connectedCallback() {
        this.config = JSON.parse(this.querySelector('[data-hb-config]').textContent);
        this.stage = this.querySelector('[data-hb-stage]');
        this.canvasHost = this.querySelector('[data-hb-canvas]');
        this.statusEl = this.querySelector('[data-hb-stage-status]');
        this.detailEl = this.querySelector('[data-hb-detail]');
        this.priceEl = this.querySelector('[data-hb-price]');
        this.finishNameEl = this.querySelector('[data-hb-finish-name]');
        this.addButton = this.querySelector('[data-hb-add]');
        this.addStatus = this.querySelector('[data-hb-add-status]');
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.variant = this.config.variants.find((v) => v.id === this.config.selectedVariantId) || this.config.variants[0];
        this.money = new Intl.NumberFormat(document.documentElement.lang || undefined, {
          style: 'currency',
          currency: window.Shopify?.currency?.active || 'USD',
        });

        this.addEventListener('change', this.onChange.bind(this));
        this.addEventListener('click', this.onClick.bind(this));
        this.canvasHost.addEventListener('keydown', this.onKeydown.bind(this));

        this.unsubscribe = subscribe(PUB_SUB_EVENTS.variantChange, ({ data }) => {
          if (!data.variant || !this.config.variants.some((v) => v.id === data.variant.id)) return;
          this.applyVariant(this.config.variants.find((v) => v.id === data.variant.id), { syncMain: false });
          if (this.pendingSync?.variantId === data.variant.id) queueMicrotask(() => this.restoreAfterSync());
          else this.pendingSync = null;
        });

        this.onBlockSelect = this.onBlockSelect.bind(this);
        document.addEventListener('shopify:block:select', this.onBlockSelect);

        this.observer = new IntersectionObserver(
          (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            this.observer.disconnect();
            this.loadScene();
          },
          { rootMargin: '300px 0px' }
        );
        this.observer.observe(this.stage);
      }

      disconnectedCallback() {
        this.observer?.disconnect();
        this.unsubscribe?.();
        document.removeEventListener('shopify:block:select', this.onBlockSelect);
        this.scene?.dispose();
        this.scene = null;
      }

      async loadScene() {
        this.setStageState('loading');
        try {
          // Scripts served from the CDN have no base URL, so a protocol-relative asset_url can't be resolved by import().
          const { mountScene } = await import(new URL(this.dataset.sceneUrl, document.baseURI).href);
          if (!this.isConnected) return;
          this.scene = mountScene({
            host: this.canvasHost,
            hotspots: [...this.stage.querySelectorAll('[data-hb-hotspot]')].map((element) => ({
              part: element.dataset.part,
              element,
            })),
            finish: this.finishFor(this.variant),
            capacityMl: Number(this.dataset.capacity) || 600,
            reducedMotion: this.reducedMotion,
            onUserInteract: () => {
              this.stage.classList.add('is-interacted');
              this.syncAutoRotateButton();
            },
          });
          this.setStageState('ready');
          this.syncAutoRotateButton();
        } catch (error) {
          console.error(error);
          this.setStageState('unsupported');
        }
      }

      setStageState(state) {
        this.stage.dataset.state = state;
        const messages = {
          loading: this.dataset.msgLoading,
          unsupported: this.dataset.msgUnsupported,
          ready: '',
        };
        this.statusEl.textContent = messages[state] ?? '';
        this.stage.querySelectorAll('[data-hb-requires-scene]').forEach((el) => {
          el.hidden = state !== 'ready';
        });
      }

      finishFor(variant) {
        const value = variant?.options[this.config.finishIndex];
        return this.config.finishes.find((f) => f.value === value) || this.config.finishes[0] || {};
      }

      onChange(event) {
        const input = event.target.closest('[data-hb-finish-input]');
        if (!input) return;
        const options = [...this.variant.options];
        options[this.config.finishIndex] = input.value;
        const match =
          this.config.variants.find((v) => v.options.every((value, i) => value === options[i])) ||
          this.config.variants.find((v) => v.options[this.config.finishIndex] === input.value);
        if (match) this.applyVariant(match, { syncMain: true });
      }

      applyVariant(variant, { syncMain }) {
        if (!variant) return;
        const changed = variant.id !== this.variant.id;
        this.variant = variant;
        const value = variant.options[this.config.finishIndex];

        this.querySelectorAll('[data-hb-finish-input]').forEach((input) => {
          input.checked = input.value === value;
        });
        if (this.finishNameEl) this.finishNameEl.textContent = value || '';
        this.priceEl.textContent = this.money.format(variant.price / 100);
        this.addButton.disabled = !variant.available;
        this.addButton.textContent = variant.available ? this.dataset.msgAdd : this.dataset.msgSoldOut;
        this.setAddStatus('');

        if (changed) this.scene?.setFinish(this.finishFor(variant));
        if (syncMain) this.syncMainPicker(value);
      }

      // Drive Dawn's own variant picker so price, URL, gallery and the main form stay in step.
      syncMainPicker(value) {
        const name = this.config.finishOptionName;
        const picker = document.querySelector(`variant-selects[data-product-id="${this.dataset.productId}"]`);
        if (!picker || !name) return;

        const radio = [...picker.querySelectorAll('input[type="radio"]')].find(
          (input) => input.dataset.optionName === name && input.value === value
        );
        if (radio) {
          if (radio.checked) return;
          this.pendingSync = {
            variantId: this.variant.id,
            x: window.scrollX,
            y: window.scrollY,
            focus: document.activeElement,
          };
          radio.click();
          return;
        }
        const select = [...picker.querySelectorAll('select')].find((el) =>
          [...el.options].some((option) => option.value === value)
        );
        if (select && select.value !== value) {
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Dawn refocuses the clicked main-picker radio after re-rendering, which would scroll the page away.
      restoreAfterSync() {
        const { x, y, focus } = this.pendingSync;
        this.pendingSync = null;
        if (focus && this.contains(focus)) focus.focus({ preventScroll: true });
        window.scrollTo({ left: x, top: y, behavior: 'instant' });
      }

      onClick(event) {
        const hotspot = event.target.closest('[data-hb-part-trigger]');
        if (hotspot) return this.selectPart(hotspot.dataset.part);

        const action = event.target.closest('[data-hb-action]')?.dataset.hbAction;
        if (!action) return;
        if (action === 'add') return this.addToCart();
        if (!this.scene) return;
        this.stage.classList.add('is-interacted');

        if (action === 'zoom-in') this.scene.nudge({ zoom: 0.8 });
        if (action === 'zoom-out') this.scene.nudge({ zoom: 1.25 });
        if (action === 'reset') {
          this.selectPart(null);
          this.scene.resetView();
        }
        if (action === 'rotate') {
          this.scene.setAutoRotate(!this.scene.autoRotate);
          this.syncAutoRotateButton();
        }
        if (action === 'explode') {
          const button = event.target.closest('[data-hb-action]');
          const next = button.getAttribute('aria-pressed') !== 'true';
          button.setAttribute('aria-pressed', String(next));
          this.scene.setExploded(next);
        }
      }

      selectPart(part) {
        const hotspot = this.config.hotspots.find((h) => h.part === part);
        this.querySelectorAll('[data-hb-part-trigger]').forEach((el) => {
          el.setAttribute('aria-pressed', String(Boolean(hotspot) && el.dataset.part === part));
        });

        this.detailEl.hidden = !hotspot;
        if (!hotspot) return;
        this.detailEl.querySelector('[data-hb-detail-title]').textContent = hotspot.title;
        this.detailEl.querySelector('[data-hb-detail-text]').textContent = hotspot.text;
        if (this.scene) {
          this.stage.classList.add('is-interacted');
          this.setExploded(part === 'lid');
          this.scene.focusPart(part);
          this.syncAutoRotateButton();
        }
      }

      setExploded(value) {
        this.querySelector('[data-hb-action="explode"]')?.setAttribute('aria-pressed', String(value));
        this.scene.setExploded(value);
      }

      syncAutoRotateButton() {
        const button = this.querySelector('[data-hb-action="rotate"]');
        if (!button || !this.scene) return;
        const on = this.scene.autoRotate;
        button.setAttribute('aria-pressed', String(on));
        button.setAttribute('aria-label', on ? this.dataset.msgPause : this.dataset.msgPlay);
        button.querySelector('[data-hb-icon-pause]').hidden = !on;
        button.querySelector('[data-hb-icon-play]').hidden = on;
      }

      onKeydown(event) {
        if (!this.scene) return;
        const step = 0.2;
        const moves = {
          ArrowLeft: { azimuth: -step },
          ArrowRight: { azimuth: step },
          ArrowUp: { polar: -step },
          ArrowDown: { polar: step },
          '+': { zoom: 0.85 },
          '=': { zoom: 0.85 },
          '-': { zoom: 1.18 },
        };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        this.scene.nudge(move);
        this.stage.classList.add('is-interacted');
        this.syncAutoRotateButton();
      }

      onBlockSelect(event) {
        if (!this.contains(event.target)) return;
        const { part, finishValue } = event.target.dataset;
        if (part) this.selectPart(part);
        if (finishValue && this.scene) {
          const finish = this.config.finishes.find((f) => f.value === finishValue);
          if (finish) this.scene.setFinish(finish);
        }
      }

      setAddStatus(message, isError = false) {
        this.addStatus.textContent = message;
        this.addStatus.classList.toggle('hb-configurator__add-status--error', isError);
      }

      async addToCart() {
        if (this.addButton.getAttribute('aria-disabled') === 'true' || !this.variant.available) return;

        const cart = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
        const body = { items: [{ id: this.variant.id, quantity: 1 }] };
        if (cart) {
          body.sections = cart.getSectionsToRender().map((section) => section.id);
          body.sections_url = window.location.pathname;
          cart.setActiveElement(this.addButton);
        }

        this.addButton.setAttribute('aria-disabled', 'true');
        this.setAddStatus(this.dataset.msgAdding);
        try {
          const response = await fetch(`${window.routes.cart_add_url}.js`, {
            ...fetchConfig('json'),
            body: JSON.stringify(body),
          });
          const data = await response.json();
          if (!response.ok || data.status) {
            this.setAddStatus(data.description || data.message || this.dataset.msgError, true);
            return;
          }

          this.setAddStatus(this.dataset.msgAdded);
          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'hb-configurator', cartData: data });
          if (!cart) {
            window.location = window.routes.cart_url;
            return;
          }
          cart.classList.remove('is-empty');
          cart.renderContents({ ...data.items[0], sections: data.sections });
        } catch (error) {
          console.error(error);
          this.setAddStatus(this.dataset.msgError, true);
        } finally {
          this.addButton.removeAttribute('aria-disabled');
        }
      }
    }
  );
}
