<script lang="ts">
  import { untrack } from "svelte";
  import BackButton from "../components/BackButton.svelte";
  import Modal from "../components/Modal.svelte";
  import ObsidianButton from "../components/ObsidianButton.svelte";
  import ObsidianDownloadButton from "../components/ObsidianDownloadButton.svelte";
  import SaveControl from "../components/SaveControl.svelte";
  import PublishBadge from "../components/PublishBadge.svelte";
  import DirtyMarker from "../components/DirtyMarker.svelte";
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import { openMods } from "../lib/mods.svelte.js";
  import { publishStatus } from "../lib/publishstatus.svelte.js";
  import { publishFlow } from "../lib/publish.svelte.js";
  import { addContentFlow } from "../lib/addcontent.svelte.js";
  import { addContentKinds } from "../lib/addcontent.js";
  import { updateStatus } from "../lib/updatestatus.svelte.js";
  import { updateFlow } from "../lib/update.svelte.js";
  import { updateCount } from "../lib/updatequeue.js";
  import { gitStatus } from "../lib/gitstatus.svelte.js";
  import { conflictFlow } from "../lib/conflict.svelte.js";
  import { onboarding } from "../lib/onboarding.svelte.js";
  import { typeName } from "../lib/modtypes.js";
  import { openPath, openExternal, openTerminal, MOD_MANAGER_URL } from "../lib/platform.js";
  import { showSafeChoice } from "../lib/midcampaign.js";
  import { advancedMode } from "../lib/advancedmode.svelte.js";
  import { pullFlow } from "../lib/pull.svelte.js";
  import { OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "core";
  import pencilIcon from "../assets/icons/pencil.svg";
  import plusIcon from "../assets/icons/plus.svg";
  import updateIcon from "../assets/icons/circled-down-arrow.svg";
  import folderIcon from "../assets/icons/open-folder.svg";
  import discordLogo from "../assets/icons/discord-logo.svg";
  import terminalIcon from "../assets/icons/command-prompt.svg";
  import difftoolIcon from "../assets/icons/git-compare.svg";
  import pullIcon from "../assets/icons/download.svg";
  import * as m from "../lib/paraglide/messages.js";

  const entry = $derived(navigation.selectedModDir ? openMods.getByDir(navigation.selectedModDir) : null);
  const mod = $derived(entry?.manifest ?? null);

  // Publish state drives the header chip and the external publish links.
  $effect(() => {
    const d = entry?.dir;
    if (!d) return;
    untrack(() => {
      publishStatus.refresh(d);
      publishStatus.checkPr(d);
      gitStatus.ensure(d);
    });
  });

  const pubStatus = $derived(entry ? publishStatus.get(entry.dir) : null);
  const modPageUrl = $derived(mod?.id ? `${MOD_MANAGER_URL}mods/${mod.id}` : null);
  // A mid-merge mod must be resolved before anything else can be built on it.
  const status = $derived(entry ? gitStatus.get(entry.dir) : null);
  const merging = $derived(status?.merging === true);
  const updatesAvailable = $derived(entry ? updateCount(updateStatus.get(entry.dir)) : 0);
  const pullingHere = $derived(pullFlow.busy && pullFlow.dir === entry?.dir);

  /** Advanced-mode branch-per-mod explainer */
  let showBranchExplainer = $state(false);

  // The update check fetches every remote the mod pulls from and adds any that
  // are missing, so it waits on the git status: mid-merge its answer is unusable
  // and the update affordances are hidden anyway.
  $effect(() => {
    const d = entry?.dir;
    const status = d ? gitStatus.get(d) : null;
    if (!d || !status?.loaded || status.merging) return;
    untrack(() => updateStatus.check(d));
  });

  /**
   * Map a list of ids to their catalog display names, falling back to the id.
   */
  function names(ids: string[] | undefined, catalog: ReadonlyArray<{ id: string; name: string }>) {
    return (ids ?? []).map((id) => catalog.find((c) => c.id === id)?.name ?? id);
  }

  function edit() {
    if (!entry) return;
    navigation.go(ROUTES.MOD_EDIT, { dir: entry.dir });
  }
</script>

<section class="page">
  <BackButton />

  {#if !entry || !mod}
    <p class="banner error" role="alert">{m.moddetails_not_found()}</p>
  {:else}
    <header class="mod-header">
      <div class="mod-header-main">
        <span class="mod-icon" aria-hidden="true">{mod.icon}</span>
        <div>
          <h1>{mod.name}<DirtyMarker dir={entry.dir} /></h1>
          <p class="muted">
            {typeName(mod.type ?? "")} &middot; v{mod.version}
            <PublishBadge dir={entry.dir} />
            &middot; {mod.id}
          </p>
        </div>
        <div class="header-actions">
          {#if !merging}
            <SaveControl dir={entry.dir} />
            {#if advancedMode.enabled && status?.hasUpstreamChanges}
              <button
                type="button"
                class="icon-button secondary"
                disabled={pullingHere}
                onclick={() => pullFlow.pull(entry.dir)}
                aria-label={pullingHere ? m.moddetails_git_pulling() : m.moddetails_git_pull()}
                title={pullingHere ? m.moddetails_git_pulling() : m.moddetails_git_pull()}
              >
                <span class="icon" style={`--icon-mask: url("${pullIcon}")`} aria-hidden="true"></span>
              </button>
            {/if}
            {#if advancedMode.enabled && status?.hasUncommitted}
              <button
                type="button"
                class="icon-button secondary"
                onclick={() => openTerminal(entry.dir, "git difftool")}
                aria-label={m.moddetails_git_difftool()}
                title={m.moddetails_git_difftool()}
              >
                <span class="icon" style={`--icon-mask: url("${difftoolIcon}")`} aria-hidden="true"></span>
              </button>
            {/if}
            {#if updatesAvailable > 0}
              <button
                type="button"
                class="primary icon-button"
                onclick={() => updateFlow.start(entry.dir)}
                aria-label={m.update_action()}
                title={m.update_action()}
              >
                <span class="icon" style={`--icon-mask: url("${updateIcon}")`} aria-hidden="true"></span>
              </button>
            {/if}
            {#if addContentKinds(mod.type, advancedMode.enabled).length > 0}
              <button
                type="button"
                class="icon-button secondary"
                onclick={() => addContentFlow.start(entry.dir, mod.type ?? "")}
                aria-label={m.addcontent_action()}
                title={m.addcontent_action()}
              >
                <span class="icon" style={`--icon-mask: url("${plusIcon}")`} aria-hidden="true"></span>
              </button>
            {/if}
          {/if}
          <button
            type="button"
            class="icon-button secondary"
            onclick={() => openPath(entry.dir)}
            aria-label={m.moddetails_open_folder()}
            title={m.moddetails_open_folder()}
          >
            <span class="icon" style={`--icon-mask: url("${folderIcon}")`} aria-hidden="true"></span>
          </button>
          {#if advancedMode.enabled}
            <button
              type="button"
              class="icon-button secondary"
              onclick={() => openTerminal(entry.dir)}
              aria-label={m.moddetails_open_terminal()}
              title={m.moddetails_open_terminal()}
            >
              <span class="icon" style={`--icon-mask: url("${terminalIcon}")`} aria-hidden="true"></span>
            </button>
          {/if}
          {#if !merging}
            <ObsidianButton dir={entry.dir} />
            <button
              type="button"
              class="icon-button secondary"
              onclick={edit}
              aria-label={m.moddetails_edit()}
              title={m.moddetails_edit()}
            >
              <span class="icon" style={`--icon-mask: url("${pencilIcon}")`} aria-hidden="true"></span>
            </button>
          {/if}
        </div>
      </div>
      {#if advancedMode.enabled && status?.branch}
        <p class="branch-line muted">
          {m.moddetails_branch_label({ branch: status.branch })}
          <button
            type="button"
            class="link"
            aria-label={m.moddetails_branch_explainer_alt()}
            title={m.moddetails_branch_explainer_alt()}
            onclick={() => (showBranchExplainer = true)}
          >
            {m.moddetails_branch_explainer_help()}
          </button>
        </p>
      {/if}
    </header>

    {#if merging}
      <div class="merge-banner" role="alert">
        <div class="merge-banner-text">
          <span class="merge-banner-title">{m.moddetails_mid_merge_title()}</span>
          <span class="merge-banner-body">{m.moddetails_mid_merge_body()}</span>
        </div>
        <button type="button" class="primary" onclick={() => conflictFlow.enterFromDisk(entry.dir)}>
          {m.moddetails_mid_merge_resolve()}
        </button>
      </div>
    {/if}

    {#if pullFlow.errorCode && pullFlow.dir === entry.dir}
      <p class="banner error" role="alert">{m.moddetails_git_pull_failed()}</p>
    {/if}
    
    <dl class="details">
      <div class="row wide">
        <dt>{m.moddetails_field_description()}</dt>
        <dd>{mod.description}</dd>
      </div>
      <div class="row">
        <dt>{m.moddetails_field_author()}</dt>
        <dd class="author">
          <span>{mod.author}</span>
          {#if mod.authorDiscord}
            <span class="discord-handle">
              <span
                class="discord-logo"
                style={`--discord-mask: url("${discordLogo}")`}
                aria-hidden="true"
              ></span>
              {mod.authorDiscord}
            </span>
          {/if}
        </dd>
      </div>
      <div class="row">
        <dt>{m.moddetails_field_language()}</dt>
        <dd>{mod.language}</dd>
      </div>
      {#if mod.tags && mod.tags.length > 0}
        <div class="row wide">
          <dt>{m.moddetails_field_tags()}</dt>
          <dd>{mod.tags.join(", ")}</dd>
        </div>
      {/if}
      <div class="row wide">
        <dt>{m.moddetails_field_repo_url()}</dt>
        <dd>
          {#if mod.repoUrl}
            <a
              class="link"
              href={mod.repoUrl}
              onclick={(event) => {
                event.preventDefault();
                openExternal(mod.repoUrl ?? "");
              }}
            >
              {mod.repoUrl}
            </a>
          {:else}
            {m.moddetails_repo_url_none()}
          {/if}
        </dd>
      </div>
      <div class="row wide">
        <dt>{m.moddetails_campaigns()}</dt>
        <dd>
          {#if mod.campaigns?.length}
            <ul class="tag-list">
              {#each names(mod.campaigns, OFFICIAL_CAMPAIGNS) as label}
                <li class="badge-outline">{label}</li>
              {/each}
            </ul>
          {:else}
            {m.moddetails_value_none()}
          {/if}
        </dd>
      </div>
      <div class="row wide">
        <dt>{m.moddetails_required_products()}</dt>
        <dd>
          {#if mod.requiredProducts?.length}
            <ul class="tag-list">
              {#each names(mod.requiredProducts, OFFICIAL_PRODUCTS) as label}
                <li class="badge-outline">{label}</li>
              {/each}
            </ul>
          {:else}
            {m.moddetails_value_none()}
          {/if}
        </dd>
      </div>
      {#if mod.optionalProducts && mod.optionalProducts.length > 0}
        <div class="row wide">
          <dt>{m.moddetails_optional_products()}</dt>
          <dd>
            <ul class="tag-list">
              {#each names(mod.optionalProducts, OFFICIAL_PRODUCTS) as label}
                <li class="badge-outline">{label}</li>
              {/each}
            </ul>
          </dd>
        </div>
      {/if}
      {#if mod.includedMods && mod.includedMods.length > 0}
        <div class="row wide">
          <dt>{m.moddetails_built_from()}</dt>
          <dd>
            <ul class="included-mods-list">
              {#each mod.includedMods as included (included.id)}
                <li class="included-mod">
                  <button
                    type="button"
                    class="link included-mod-name"
                    onclick={() => openExternal(`${MOD_MANAGER_URL}mods/${included.id}`)}
                  >
                    {included.name}
                  </button>
                  <span class="included-mod-meta">
                    {m.moddetails_built_from_entry({ version: included.version, author: included.author })}
                  </span>
                </li>
              {/each}
            </ul>
          </dd>
        </div>
      {/if}
      {#if showSafeChoice(mod.type ?? "")}
        <div class="row wide">
          <dt>{m.midcampaign_legend()}</dt>
          {#if mod.safeToAddMidCampaign}
            <dd>{m.moddetails_safe_mid_campaign()}</dd>
          {:else}
            <dd>{mod.midCampaignNotes || m.moddetails_not_safe_mid_campaign()}</dd>
          {/if}
        </div>
      {/if}
    </dl>

    <div class="mod-footer">
      <div class="footer-links">
        {#if pubStatus?.published && modPageUrl}
          <button type="button" class="ghost" onclick={() => openExternal(modPageUrl)}>
            {m.publish_view_on_site()}
          </button>
        {/if}
      </div>
      <div class="footer-actions">
        {#each pubStatus?.prs ?? [] as pr}
          <button type="button" class="ghost" onclick={() => openExternal(pr.url)}>
            {(pubStatus?.prs?.length ?? 0) > 1 && pr.number != null
              ? m.publish_view_pr_numbered({ number: pr.number })
              : m.publish_view_pr()}
          </button>
        {/each}
        {#if !merging}
          <button type="button" class="secondary" onclick={() => publishFlow.start(entry.dir)}>
            {m.publish_action()}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</section>

{#if onboarding.showNewModExplainer}
  <Modal onCancel={() => onboarding.dismissNewModExplainer()} title={m.newmod_explainer_title()} labelledby="new-mod-explainer-title">
    <p class="body">{m.newmod_explainer_body({ dir: entry?.dir ?? m.newmod_unknown_folder() })}</p>
    <div class="explainer-actions">
      <ObsidianDownloadButton />
      <button type="button" class="secondary" onclick={() => onboarding.learnMoreFromNewModExplainer()}>
        {m.newmod_explainer_learn_more()}
      </button>
      <button type="button" class="primary" onclick={() => onboarding.dismissNewModExplainer()}>
        {m.newmod_explainer_dismiss()}
      </button>
    </div>
  </Modal>
{/if}

{#if showBranchExplainer}
  <Modal onCancel={() => (showBranchExplainer = false)} title={m.moddetails_branch_explainer_title()} labelledby="branch-explainer-title">
    <p class="body">{m.moddetails_branch_explainer_body({ branch: status?.branch ?? "" })}</p>
    <div class="explainer-actions">
      <button type="button" class="primary" onclick={() => (showBranchExplainer = false)}>
        {m.moddetails_branch_explainer_dismiss()}
      </button>
    </div>
  </Modal>
{/if}


<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .explainer-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }

  .mod-header {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .merge-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-md);
    flex-wrap: wrap;
    padding: var(--spacing-md);
    border: 1px solid var(--color-error);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--color-error) 12%, var(--color-surface));
  }

  .merge-banner-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .merge-banner-title {
    font-weight: var(--font-weight-bold);
    color: var(--color-error);
  }

  .merge-banner-body {
    color: var(--color-text);
    font-size: var(--font-size-sm);
  }

  .mod-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--spacing-md);
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--color-border);
  }

  .footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-md);
  }

  .footer-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--spacing-sm);
  }

  .mod-header-main {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    flex-wrap: wrap;
  }

  .branch-line {
    margin: 0;
    font-size: var(--font-size-sm);
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .muted :global(.publish-badge) {
    vertical-align: middle;
  }

  .mod-icon {
    font-size: var(--font-size-xl);
    line-height: 1;
  }

  .header-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  @media (max-width: 800px) {
    .header-actions {
      order: -1;
      flex-basis: 100%;
      justify-content: flex-end;
    }
  }

  .details {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--spacing-sm) var(--spacing-md);
    margin: 0;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row.wide {
    grid-column: 1 / -1;
  }

  .row dt {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .row dd {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .author {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .discord-handle {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
  }

  .discord-logo {
    display: inline-block;
    width: 1.1em;
    height: 1.1em;
    flex-shrink: 0;
    background-color: currentColor;
    mask-image: var(--discord-mask);
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
    -webkit-mask-image: var(--discord-mask);
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
  }

  .tag-list {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
    padding: 0;
    margin: 0;
  }

  .badge-outline {
    display: inline-block;
    font-size: var(--font-size-xs);
    padding: 3px var(--spacing-sm);
    border-radius: var(--radius-full);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text);
  }

  .included-mods-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    font-size: var(--font-size-sm);
    padding: 0;
    margin: 0;
  }

  .included-mod {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--spacing-xs);
  }

  .included-mod-name {
    font-weight: var(--font-weight-medium);
  }

  .included-mod-meta {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }
</style>
