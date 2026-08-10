<script lang="ts">
  /**
   * Presentational modal shell over the native `<dialog>` element: opens as a
   * true modal on mount, closes on teardown, and routes the native `cancel`
   * event (Escape) to the caller so the caller's state stays the single source
   * of truth. Callers provide the content and its own styling; this component
   * owns only the dialog frame and backdrop.
   */
  import type { Snippet } from "svelte";

  interface Props {
    /** Handles the native `cancel` event (Escape). */
    onCancel: () => void;
    /** id of the element that labels the dialog (aria-labelledby). */
    labelledby?: string;
    /** CSS max-width for the dialog. Defaults to 26rem. */
    maxWidth?: string;
    /** Dialog contents. */
    children: Snippet;
  }
  let { onCancel, labelledby, maxWidth = "26rem", children }: Props = $props();

  let dialogEl: HTMLDialogElement;

  // Open as a true modal on mount; close the native dialog on teardown.
  $effect(() => {
    dialogEl.showModal();
    return () => dialogEl.close();
  });

  // Escape fires the native `cancel` event. Swallow the default close and route
  // through onCancel so the caller decides whether to dismiss.
  function handleCancel(event: Event) {
    event.preventDefault();
    onCancel();
  }
</script>

<dialog
  bind:this={dialogEl}
  class="dialog"
  style={`max-width: ${maxWidth}`}
  aria-labelledby={labelledby}
  oncancel={handleCancel}
>
  {@render children()}
</dialog>

<style>
  .dialog {
    width: 100%;
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
</style>
