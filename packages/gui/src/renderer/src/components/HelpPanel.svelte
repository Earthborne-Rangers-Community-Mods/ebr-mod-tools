<script lang="ts">
  /**
   * "What is Obsidian?" onboarding content: a concept map of the mod/GitHub/
   * Obsidian workflow, and links to get Obsidian and the modding guide.
   */
  import { openExternal, MOD_MANAGER_URL } from "../lib/platform.js";
  import { moddingGuideUrl } from "../lib/onboarding.svelte.js";
  import * as m from "../lib/paraglide/messages.js";
  import ObsidianDownloadButton from "./ObsidianDownloadButton.svelte";

  const moddingGuide = moddingGuideUrl(MOD_MANAGER_URL);
</script>

<div class="help-panel">
  <p class="body">{m.help_panel_intro()}</p>
  <ol class="concept-map">
    <li>{m.help_panel_step_newmod()}</li>
    <li>{m.help_panel_step_github()}</li>
    <li>{m.help_panel_step_obsidian()}</li>
    <li>{m.help_panel_step_publish()}</li>
  </ol>
  <p class="body">{m.help_panel_finally()}</p>
  <div class="links">
    <ObsidianDownloadButton />
    <button type="button" class="secondary" onclick={() => openExternal(moddingGuide)}>
      {m.help_panel_modding_guide()}
    </button>
  </div>
</div>

<style>
  .help-panel {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .concept-map {
    margin: 0;
    padding-left: 1.25em;
    color: var(--color-text-muted);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-xs);
    padding-bottom: var(--spacing-sm);
  }
</style>
