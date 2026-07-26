<script lang="ts">
  import { untrack } from "svelte";
  import BackButton from "../components/BackButton.svelte";
  import ObsidianButton from "../components/ObsidianButton.svelte";
  import SaveControl from "../components/SaveControl.svelte";
  import PublishBadge from "../components/PublishBadge.svelte";
  import DirtyMarker from "../components/DirtyMarker.svelte";
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import { openMods } from "../lib/mods.svelte.js";
  import { publishStatus } from "../lib/publishstatus.svelte.js";
  import { publishFlow } from "../lib/publish.svelte.js";
  import { typeName } from "../lib/modtypes.js";
  import { openPath, openExternal, MOD_MANAGER_URL } from "../lib/platform.js";
  import { showSafeChoice } from "../lib/midcampaign.js";
  import { OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "core";
  import pencilIcon from "../assets/icons/pencil.svg";
  import folderIcon from "../assets/icons/open-folder.svg";
  import discordLogo from "../assets/icons/discord-logo.svg";
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
    });
  });

  const pubStatus = $derived(entry ? publishStatus.get(entry.dir) : null);
  const modPageUrl = $derived(mod?.id ? `${MOD_MANAGER_URL}mods/${mod.id}` : null);

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
          <SaveControl dir={entry.dir} />
          <button
            type="button"
            class="icon-button"
            onclick={() => openPath(entry.dir)}
            aria-label={m.moddetails_open_folder()}
            title={m.moddetails_open_folder()}
          >
            <span class="icon" style={`--icon-mask: url("${folderIcon}")`} aria-hidden="true"></span>
          </button>
          <ObsidianButton dir={entry.dir} />
          <button
            type="button"
            class="icon-button"
            onclick={edit}
            aria-label={m.moddetails_edit()}
            title={m.moddetails_edit()}
          >
            <span class="icon" style={`--icon-mask: url("${pencilIcon}")`} aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </header>

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
      {#if showSafeChoice(mod.type ?? "")}
        <div class="row wide">
          <dt>{m.midcampaign_legend()}</dt>
          {#if mod.safeToAddMidCampaign}
            <dd class="safety-safe">&#x1f6e1;&#xfe0f; {m.moddetails_safe_mid_campaign()}</dd>
          {:else}
            <dd class="safety-unsafe">&#x26a0;&#xfe0f; {mod.midCampaignNotes || m.moddetails_not_safe_mid_campaign()}</dd>
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
        <button type="button" class="secondary" onclick={() => publishFlow.start(entry.dir)}>
          {m.publish_action()}
        </button>
      </div>
    </div>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .mod-header {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
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
  }

  .muted :global(.publish-badge) {
    vertical-align: middle;
  }


  .mod-icon {
    font-size: 2.5rem;
    line-height: 1;
  }

  .header-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .icon-button:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-primary);
  }

  .icon {
    display: block;
    width: 1.25rem;
    height: 1.25rem;
    background-color: currentColor;
    mask-image: var(--icon-mask);
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
    -webkit-mask-image: var(--icon-mask);
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
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
    font-size: 0.8rem;
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

  .safety-safe {
    color: var(--color-success);
  }

  .safety-unsafe {
    color: var(--color-error);
  }
</style>
