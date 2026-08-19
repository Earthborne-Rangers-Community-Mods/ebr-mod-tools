<script lang="ts">
  /**
   * Include-mod screen of the "Add content" launcher (Advanced mode only).
   * Paste the mod's Mod Manager or GitHub URL (or its bare id), resolve it
   * against the registry, preview whether merging it would conflict, then
   * include it. Driven by the launcher's mod sub-flow. A conflicting include
   * routes to the Conflict page.
   */
  import { addContentFlow } from "../lib/addcontent.svelte.js";
  import Spinner from "./Spinner.svelte";
  import { pick } from "../lib/pick.js";
  import * as m from "../lib/paraglide/messages.js";

  const flow = addContentFlow;
  const mod = flow.mod;

  const ERROR_MESSAGES = {
    "mod-not-found": m.addcontent_error_mod_not_found,
    "registry-unreachable": m.addcontent_error_registry_unreachable,
    "not-a-repo": m.addcontent_error_not_a_repo,
    "dirty-tree": m.addcontent_error_dirty_tree,
    "index-not-clean": m.addcontent_error_index_not_clean,
    invalid: m.addcontent_error_invalid,
  };

  // Including is only meaningful once the mod resolved for the CURRENT field
  // text, the preview loaded, and there is actually something to merge. Editing
  // the id after resolving must not let Include silently act on the stale
  // resolution.
  const canInclude = $derived(
    !mod.busy &&
      !mod.previewing &&
      !mod.isStale &&
      mod.resolved !== null &&
      mod.preview !== null &&
      !mod.preview.alreadyUpToDate,
  );
</script>

{#if mod.report}
  <p class="body">
    {mod.report.alreadyUpToDate
      ? m.addcontent_include_mod_report_uptodate({ mod: mod.report.modId })
      : m.addcontent_include_mod_report_done({ mod: mod.report.modId })}
  </p>
  <div class="actions">
    <button type="button" class="primary" onclick={() => flow.cancel()}>{m.addcontent_done()}</button>
  </div>
{:else}
  <p class="body">{m.addcontent_pick_mod_lead()}</p>
  <label class="field">
    <span>{m.addcontent_pick_mod_label()}</span>
    <input
      type="text"
      bind:value={mod.modSource}
      placeholder={m.addcontent_pick_mod_placeholder()}
      disabled={mod.busy || mod.previewing}
    />
  </label>
  <div class="actions find-actions">
    <button
      type="button"
      class="secondary"
      onclick={() => mod.resolve()}
      disabled={mod.busy || mod.previewing || !mod.modSource.trim()}
    >
      {mod.previewing ? m.addcontent_mod_checking() : m.addcontent_mod_find()}
    </button>
  </div>

  {#if mod.previewing}
    <div class="preview-loading"><Spinner label={m.addcontent_mod_checking()} /></div>
  {:else if mod.resolved && mod.preview}
    {#if mod.isStale}
      <p class="body warn">{m.addcontent_mod_stale()}</p>
    {:else}
      <p class="body">{m.addcontent_mod_resolved({ name: mod.resolved.name, author: mod.resolved.author })}</p>
      {#if mod.preview.alreadyUpToDate}
        <p class="body">{m.addcontent_mod_up_to_date()}</p>
      {:else if mod.preview.conflicts.length > 0}
        <p class="body warn">{m.addcontent_mod_conflicts({ count: mod.preview.conflicts.length })}</p>
        <ul class="file-list">
          {#each mod.preview.conflicts as path}
            <li>{path}</li>
          {/each}
        </ul>
      {:else}
        <p class="body">{m.addcontent_mod_clean()}</p>
      {/if}
    {/if}
  {/if}

  {#if mod.errorCode}
    <p class="error-text" role="alert">
      {pick(ERROR_MESSAGES, mod.errorCode)?.() ?? m.addcontent_error_include_mod_failed()}
    </p>
  {/if}

  <div class="actions">
    {#if !mod.busy}
      <button type="button" class="ghost" onclick={() => flow.back()}>
        {m.addcontent_back()}
      </button>
    {/if}
    <button type="button" class="primary" onclick={() => mod.include()} disabled={!canInclude}>
      {mod.busy ? m.addcontent_mod_including() : m.addcontent_mod_include_confirm()}
    </button>
  </div>
{/if}

<style>
  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .body.warn {
    color: var(--color-text);
    font-weight: 600;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .field span {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .find-actions {
    justify-content: flex-start;
    margin-top: 0;
  }

  .file-list {
    margin: 0;
    padding-left: var(--spacing-lg);
    max-height: 10rem;
    overflow-y: auto;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .preview-loading {
    padding: var(--spacing-xs) 0;
  }

  .error-text {
    color: var(--color-error);
    margin: 0;
    font-size: var(--font-size-sm);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }
</style>
