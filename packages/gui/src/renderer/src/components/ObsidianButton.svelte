<script>
  /**
   * Icon button that opens a mod's folder as a vault in Obsidian.
   *
   * @typedef {object} Props
   * @property {string} dir - Absolute path to the mod directory to open.
   * @property {"compact"|"fill"} [size] - "compact" is a fixed 2rem square (for a
   *   row of same-size icon buttons); "fill" stretches to match the height of the
   *   other controls on its row, staying square via aspect-ratio.
   */
  import { openInObsidian } from "../lib/platform.js";
  import * as m from "../lib/paraglide/messages.js";
  import obsidianLogo from "../assets/icons/obsidian-logo.svg";

  /** @type {Props} */
  let { dir, size = "compact" } = $props();
</script>

<button
  type="button"
  class="obsidian-button"
  class:compact={size === "compact"}
  class:fill={size === "fill"}
  onclick={() => openInObsidian(dir)}
  aria-label={m.obsidian_open_label()}
  title={m.obsidian_open_label()}
>
  <img src={obsidianLogo} alt="" class="obsidian-logo" aria-hidden="true" />
</button>

<style>
  .obsidian-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .obsidian-button.compact {
    width: 2rem;
    height: 2rem;
  }

  /* Match the height of a standard button on the same row, staying square.
     A single-line button is one line box (line-height x 1rem) plus its vertical
     padding (6px x 2) and border (1px x 2) - the same literals app.css uses on
     .primary/.secondary/.ghost - so this tracks the row height without a
     hardcoded pixel size or a flex aspect-ratio quirk. */
  .obsidian-button.fill {
    --obsidian-fill-size: calc(1rem * var(--line-height-normal) + 14px);
    width: var(--obsidian-fill-size);
    height: var(--obsidian-fill-size);
  }

  .obsidian-button:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-primary);
  }

  .obsidian-logo {
    width: 1.25rem;
    height: 1.25rem;
    display: block;
  }
</style>
