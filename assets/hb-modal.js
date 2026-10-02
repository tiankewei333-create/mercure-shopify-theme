// Thin wrapper around native <dialog>: focus trapping, Esc and focus return come from the browser.
if (!customElements.get('hb-modal')) {
  customElements.define(
    'hb-modal',
    class HbModal extends HTMLElement {
      connectedCallback() {
        this.dialog = this.querySelector('dialog');
        this.trigger = this.querySelector('[data-hb-modal-open]');
        if (!this.dialog || !this.trigger) return;

        this.trigger.addEventListener('click', () => this.dialog.showModal());
        // The dialog has no padding, so a click whose target is the dialog itself landed on the backdrop.
        this.dialog.addEventListener('click', (event) => {
          if (event.target === this.dialog) this.dialog.close();
        });
      }
    }
  );
}
