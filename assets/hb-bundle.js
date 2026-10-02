// Relies on Dawn globals: fetchConfig (global.js), publish/subscribe (pubsub.js), PUB_SUB_EVENTS (constants.js).
if (!customElements.get('hb-bundle')) {
  customElements.define(
    'hb-bundle',
    class HbBundle extends HTMLElement {
      connectedCallback() {
        this.form = this.querySelector('form');
        this.submitButton = this.querySelector('[data-hb-submit]');
        this.totalEl = this.querySelector('[data-hb-total]');
        this.statusEl = this.querySelector('[data-hb-status]');
        this.currentItem = this.querySelector('[data-hb-current]');
        this.money = new Intl.NumberFormat(document.documentElement.lang || undefined, {
          style: 'currency',
          currency: window.Shopify?.currency?.active || 'USD',
        });

        this.form.addEventListener('change', this.onChange.bind(this));
        this.form.addEventListener('submit', this.onSubmit.bind(this));

        if (this.currentItem) {
          const ids = this.currentItem.dataset.variantIds.split(',');
          this.unsubscribe = subscribe(PUB_SUB_EVENTS.variantChange, ({ data }) => {
            // Ignore variant changes from other products on the page (e.g. quick add).
            if (data.variant && !ids.includes(String(data.variant.id))) return;
            this.syncCurrentVariant(data.variant);
          });
        }
      }

      disconnectedCallback() {
        this.unsubscribe?.();
      }

      onChange(event) {
        const select = event.target.closest('[data-hb-variant-select]');
        if (select) {
          const option = select.selectedOptions[0];
          const checkbox = select.closest('li').querySelector('input[type="checkbox"]');
          checkbox.value = option.value;
          checkbox.dataset.price = option.dataset.price;
        }
        this.setStatus('');
        this.updateTotal();
      }

      syncCurrentVariant(variant) {
        const checkbox = this.currentItem.querySelector('input[type="checkbox"]');
        const priceEl = this.currentItem.querySelector('[data-hb-price]');
        const available = Boolean(variant?.available);

        checkbox.disabled = !available;
        if (!available) checkbox.checked = false;
        if (variant) {
          checkbox.value = variant.id;
          checkbox.dataset.price = variant.price;
        }
        priceEl.textContent = available ? this.formatMoney(variant.price) : this.dataset.msgSoldOut || '';
        this.updateTotal();
      }

      selectedCheckboxes() {
        return [...this.form.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)')];
      }

      updateTotal() {
        const cents = this.selectedCheckboxes().reduce((sum, input) => sum + Number(input.dataset.price || 0), 0);
        this.totalEl.textContent = this.formatMoney(cents);
      }

      formatMoney(cents) {
        return this.money.format(Number(cents) / 100);
      }

      setStatus(message, isError = false) {
        this.statusEl.textContent = message;
        this.statusEl.classList.toggle('hb-bundle__status--error', isError);
      }

      async onSubmit(event) {
        event.preventDefault();
        if (this.submitButton.getAttribute('aria-disabled') === 'true') return;

        const items = this.selectedCheckboxes().map((input) => ({ id: Number(input.value), quantity: 1 }));
        if (!items.length) return this.setStatus(this.dataset.msgNone, true);

        const cart = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
        const body = { items };
        if (cart) {
          body.sections = cart.getSectionsToRender().map((section) => section.id);
          body.sections_url = window.location.pathname;
          cart.setActiveElement(this.submitButton);
        }

        this.submitButton.setAttribute('aria-disabled', 'true');
        this.setStatus(this.dataset.msgAdding);

        try {
          const response = await fetch(`${window.routes.cart_add_url}.js`, {
            ...fetchConfig('json'),
            body: JSON.stringify(body),
          });
          const data = await response.json();

          if (!response.ok || data.status) {
            this.setStatus(data.description || data.message || this.dataset.msgError, true);
            return;
          }

          this.setStatus(this.dataset.msgAdded);
          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'hb-bundle', cartData: data });

          if (!cart) {
            window.location = window.routes.cart_url;
            return;
          }
          cart.classList.remove('is-empty');
          // Dawn's drawer/notification expect the single-line add.js shape (id, key) plus sections.
          cart.renderContents({ ...data.items[0], sections: data.sections });
        } catch (error) {
          console.error(error);
          this.setStatus(this.dataset.msgError, true);
        } finally {
          this.submitButton.removeAttribute('aria-disabled');
        }
      }
    }
  );
}
