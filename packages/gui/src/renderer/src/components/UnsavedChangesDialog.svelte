<script lang="ts">
  /**
   * Modal prompt shown when the user tries to leave (or close) a dirty edit form.
   */
  import Modal from "./Modal.svelte";
  import * as m from "../lib/paraglide/messages.js";

  interface Props {
    /** Save the changes, then proceed. */
    onSave: () => void;
    /** Throw the changes away, then proceed. */
    onDiscard: () => void;
    /** Stay put. */
    onCancel: () => void;
  }
  let { onSave, onDiscard, onCancel }: Props = $props();
</script>

<Modal {onCancel} labelledby="unsaved-title">
  <p id="unsaved-title" class="title">{m.unsaved_title()}</p>
  <p class="body">{m.unsaved_body()}</p>
  <div class="actions">
    <button type="button" class="danger" onclick={onDiscard}>{m.unsaved_discard()}</button>
    <button type="button" class="ghost" onclick={onCancel}>{m.unsaved_cancel()}</button>
    <button type="button" class="primary" onclick={onSave}>{m.unsaved_save()}</button>
  </div>
</Modal>

<style>
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
