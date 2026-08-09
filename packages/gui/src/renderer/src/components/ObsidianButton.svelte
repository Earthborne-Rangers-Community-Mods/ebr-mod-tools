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
  class="icon-button secondary"
  onclick={() => openInObsidian(dir)}
  aria-label={m.obsidian_open_label()}
  title={m.obsidian_open_label()}
>
  <img src={obsidianLogo} alt="" class="obsidian-logo" aria-hidden="true" />
</button>

<style>
  .obsidian-logo {
    width: 1.25rem;
    height: 1.25rem;
    display: block;
  }
</style>
