<script lang="ts">
  /**
   * Shown when the user tries to close the app while a flow operation (save,
   * publish, add-content) is still running. It only informs and dismisses -
   * closing is blocked until the operation finishes, at which point the app
   * shell auto-dismisses this notice.
   */
  import Modal from "./Modal.svelte";
  import * as m from "../lib/paraglide/messages.js";

  interface Props {
    /** Dismiss the notice. Does not close the app. */
    onDismiss: () => void;
  }
  let { onDismiss }: Props = $props();
</script>

<Modal onCancel={onDismiss} title={m.busy_close_title()} labelledby="busy-close-title">
  <p class="body">{m.busy_close_body()}</p>
  <div class="actions">
    <button type="button" class="primary" onclick={onDismiss}>{m.busy_close_ok()}</button>
  </div>
</Modal>

<style>
  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--spacing-sm);
  }
</style>
