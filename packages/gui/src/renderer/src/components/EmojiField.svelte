<script>
  /**
   * Emoji picker field - a compact trigger button that opens an off-the-shelf
   * emoji picker (emoji-picker-element) in a popover. Reusable across forms that
   * edit a mod's single-emoji icon.
   *
   * Offline by design: the picker's emoji database ships bundled and is handed
   * to the web component as a same-origin blob: URL, so nothing is fetched from
   * the network. Both the picker and its data are lazy-loaded on first open to
   * keep app startup lean.
   */
  import { onDestroy } from "svelte";
  import * as m from "../lib/paraglide/messages.js";

  // `labelledby` is the id of an external field label; when provided it is
  // prepended to the trigger's accessible name so the surrounding "Icon" context
  // is announced along with the button's own content.
  let { value = $bindable(""), disabled = false, labelledby = undefined, onchange = undefined } = $props();

  // Unique id so the trigger can reference its own content in aria-labelledby.
  const triggerId = $props.id();

  let open = $state(false);
  let loaded = $state(false);
  let loadError = $state(false);
  let dataSourceUrl = $state(/** @type {string|null} */ (null));
  let pickerEl = $state(/** @type {HTMLElement|null} */ (null));
  let rootEl = $state(/** @type {HTMLElement|null} */ (null));

  // Lazy-load the picker element and its bundled data on first open.
  async function ensureLoaded() {
    if (loaded || loadError) return;
    try {
      await import("emoji-picker-element");
      const data = await import("emoji-picker-element-data/en/emojibase/data.json");
      const blob = new Blob([JSON.stringify(data.default)], { type: "application/json" });
      dataSourceUrl = URL.createObjectURL(blob);
      loaded = true;
    } catch {
      loadError = true;
    }
  }

  async function toggle() {
    if (disabled) return;
    if (open) {
      open = false;
      return;
    }
    await ensureLoaded();
    open = !loadError;
  }

  /** @param {any} event */
  function handleEmojiClick(event) {
    value = event.detail.unicode;
    open = false;
    onchange?.();
  }

  function clear() {
    value = "";
    onchange?.();
  }

  // Free the bundled-data blob URL when the field is torn down so it does not
  // linger in renderer memory across route changes.
  onDestroy(() => {
    if (dataSourceUrl) URL.revokeObjectURL(dataSourceUrl);
  });

  // The emoji-click event is a custom-element event, so wire it up imperatively
  // once the element mounts.
  $effect(() => {
    const el = pickerEl;
    if (!el) return;
    el.addEventListener("emoji-click", handleEmojiClick);
    return () => el.removeEventListener("emoji-click", handleEmojiClick);
  });

  // Dismiss on outside click or Escape while the popover is open.
  $effect(() => {
    if (!open) return;
    /** @param {PointerEvent} event */
    function onPointerDown(event) {
      if (rootEl && !rootEl.contains(/** @type {Node} */ (event.target))) open = false;
    }
    /** @param {KeyboardEvent} event */
    function onKeyDown(event) {
      if (event.key === "Escape") open = false;
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  });
</script>

<div class="emoji-field" bind:this={rootEl}>
  <div class="row">
    <button
      type="button"
      id={triggerId}
      class="trigger"
      onclick={toggle}
      {disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-labelledby={labelledby ? `${labelledby} ${triggerId}` : triggerId}
    >
      {#if value}
        <span class="emoji">{value}</span>
      {:else}
        <span class="placeholder">{m.emoji_choose_label()}</span>
      {/if}
    </button>
    {#if value && !disabled}
      <button type="button" class="clear" onclick={clear} aria-label={m.emoji_clear_label()}>
        &times;
      </button>
    {/if}
  </div>

  {#if open && loaded}
    <div class="popover" role="dialog" aria-label={m.emoji_choose_label()}>
      <emoji-picker bind:this={pickerEl} data-source={dataSourceUrl}></emoji-picker>
    </div>
  {/if}

  {#if loadError}
    <small class="hint error-text">{m.emoji_load_error()}</small>
  {/if}
</div>

<style>
  .emoji-field {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.5rem;
    height: 2.5rem;
    padding: 0 var(--spacing-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .trigger:hover:not(:disabled) {
    background: var(--color-surface-hover);
  }

  .trigger:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .emoji {
    font-size: 1.375rem;
    line-height: 1;
  }

  .placeholder {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
  }

  .clear:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }

  .popover {
    position: absolute;
    top: calc(100% + var(--spacing-xs));
    left: 0;
    z-index: 20;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  /* Map the picker's public custom properties onto the app's design tokens so it
     matches the surrounding chrome. Custom properties pierce the shadow DOM. */
  emoji-picker {
    --background: var(--color-surface);
    --border-color: var(--color-border);
    --border-radius: var(--radius);
    --button-active-background: var(--color-surface-hover);
    --button-hover-background: var(--color-surface-hover);
    --category-font-color: var(--color-text);
    --indicator-color: var(--color-primary);
    --input-border-color: var(--color-border);
    --input-font-color: var(--color-text);
    --input-placeholder-color: var(--color-text-muted);
    --outline-color: var(--color-focus);
    height: 22rem;
  }

  .hint {
    font-size: var(--font-size-xs);
  }

  .error-text {
    color: var(--color-error);
  }
</style>
