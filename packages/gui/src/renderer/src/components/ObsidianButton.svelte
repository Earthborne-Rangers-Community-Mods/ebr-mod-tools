<script lang="ts">
  /**
   * Icon button that opens a mod's folder as a vault in Obsidian.
   */
  import { openInObsidian } from "../lib/platform.js";
  import * as m from "../lib/paraglide/messages.js";
  import obsidianLogo from "../assets/icons/obsidian-logo.svg";

  interface Props {
    /** Absolute path to the mod directory to open. */
    dir: string;
  }
  let { dir }: Props = $props();
</script>

<button
  type="button"
  class="obsidian-button"
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
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
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
