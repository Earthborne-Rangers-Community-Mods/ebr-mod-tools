<script lang="ts">
  /**
   * "Get Obsidian" button with the Obsidian logo, linking to the download page.
   */
  import { openExternal } from "../lib/platform.js";
  import * as m from "../lib/paraglide/messages.js";
  import obsidianLogo from "../assets/icons/obsidian-logo.svg";

  /** Where to download Obsidian. */
  const OBSIDIAN_DOWNLOAD_URL = "https://obsidian.md";
</script>

<button type="button" class="secondary" onclick={() => openExternal(OBSIDIAN_DOWNLOAD_URL)}>
  <img src={obsidianLogo} alt="" class="obsidian-logo" aria-hidden="true" /> {m.help_panel_download_obsidian()}
</button>

<style>
  .obsidian-logo {
    width: 1rem;
    height: 1rem;
    display: inline-block;
    transform: translateY(0.1em);
  }
</style>
