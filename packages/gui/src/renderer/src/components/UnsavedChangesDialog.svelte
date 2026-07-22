<script>
  /**
   * Modal prompt shown when the user tries to leave (or close) a dirty edit form.
   *
   * @typedef {object} Props
   * @property {() => void} onSave - Save the changes, then proceed.
   * @property {() => void} onDiscard - Throw the changes away, then proceed.
   * @property {() => void} onCancel - Stay put.
   */
  import * as m from "../lib/paraglide/messages.js";

  /** @type {Props} */
  let { onSave, onDiscard, onCancel } = $props();

  let dialogEl;

  // Open as a true modal on mount; close the native dialog on teardown.
  $effect(() => {
    dialogEl.showModal();
    return () => dialogEl.close();
  });

  // Escape fires the native `cancel` event. Keep the parent's state the single
  // source of truth: swallow the default close and route through onCancel so the
  // parent unmounts us.
  function handleCancel(event) {
    event.preventDefault();
    onCancel();
  }
</script>

<dialog
  bind:this={dialogEl}
  class="dialog"
  aria-labelledby="unsaved-title"
  oncancel={handleCancel}
>
  <p id="unsaved-title" class="title">{m.unsaved_title()}</p>
  <p class="body">{m.unsaved_body()}</p>
  <div class="actions">
    <button type="button" class="danger" onclick={onDiscard}>{m.unsaved_discard()}</button>
    <button type="button" class="ghost" onclick={onCancel}>{m.unsaved_cancel()}</button>
    <button type="button" class="primary" onclick={onSave}>{m.unsaved_save()}</button>
  </div>
</dialog>

<style>
  .dialog {
    width: 100%;
    max-width: 26rem;
    /* Pin near the top of the viewport, centered horizontally. */
    margin: 10vh auto auto;
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: var(--spacing-lg);
    box-shadow: var(--shadow, 0 8px 24px rgba(0, 0, 0, 0.25));
  }

  .dialog[open] {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.45);
  }

  .title {
    margin: 0;
    font-weight: 700;
    font-size: var(--font-size-md);
  }

  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }

  /* Push the destructive Discard to the far left, away from Save. */
  .actions .danger {
    margin-right: auto;
  }
</style>
