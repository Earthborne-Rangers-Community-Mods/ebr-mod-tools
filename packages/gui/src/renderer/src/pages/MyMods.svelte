<script>
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import { openMods } from "../lib/mods.svelte.js";
  import { setupStore } from "../lib/setup.svelte.js";
  import { pickDirectory, openInObsidian, openExternal, MOD_MANAGER_URL } from "../lib/platform.js";
  import { MOD_TYPES } from "core";
  import { basename } from "node:path";
  import * as m from "../lib/paraglide/messages.js";
  import obsidianLogo from "../assets/icons/obsidian-logo.svg";
  import discordLogo from "../assets/icons/discord-logo.svg";
  import githubLogo from "../assets/icons/github-logo.svg";
  import gearIcon from "../assets/icons/gear.svg";

  let addError = $state(null);
  let confirmDir = $state(null);

  // Player-facing mod type names, localized. Falls back to core's English
  // catalog name (then the raw id) for any type not yet in the message catalog.
  const MOD_TYPE_NAME_MESSAGES = {
    campaign: m.mod_type_campaign_name,
    enhancement: m.mod_type_enhancement_name,
    "one-day-mission": m.mod_type_one_day_mission_name,
    expansion: m.mod_type_expansion_name,
    collection: m.mod_type_collection_name,
    theme: m.mod_type_theme_name,
  };

  function typeLabel(typeId) {
    return (
      MOD_TYPE_NAME_MESSAGES[typeId]?.() ??
      MOD_TYPES.find((t) => t.id === typeId)?.name ??
      typeId
    );
  }

  async function openExisting() {
    addError = null;
    const dir = await pickDirectory(openMods.pickerDefaultPath);
    if (!dir) return;
    const result = await openMods.add(dir);
    if (!result.ok) {
      if (result.reason === "not-found") {
        addError = m.mymods_error_not_a_mod({ folder: basename(dir) });
      } else if (result.reason === "unreadable") {
        addError = m.mymods_error_unreadable_detail({
          folder: basename(dir),
          detail: result.message ?? m.mymods_invalid_manifest_fallback(),
        });
      } else {
        addError = m.mymods_error_add_failed();
      }
    }
  }

  function requestClose(dir) {
    confirmDir = dir;
  }

  function cancelClose() {
    confirmDir = null;
  }

  function confirmClose(dir) {
    openMods.remove(dir);
    if (confirmDir === dir) confirmDir = null;
  }
</script>

<section class="page">
  <header class="account">
    <div>
      <p class="account-label">{m.mymods_signed_in_as()}</p>
      <p class="account-login">
        <span
          class="github-logo"
          style={`--github-mask: url("${githubLogo}")`}
          aria-hidden="true"
        ></span>
        {setupStore.displayLogin ?? m.mymods_no_account()}
      </p>
      <p class="account-author">
        {setupStore.author || setupStore.displayLogin || ""}
        {#if setupStore.authorDiscord}
          <span class="muted discord-handle">
            &middot;
            <span
              class="discord-logo"
              style={`--discord-mask: url("${discordLogo}")`}
              aria-hidden="true"
            ></span>
            {setupStore.authorDiscord}
          </span>
        {/if}
      </p>
    </div>
    <button
      type="button"
      class="account-setup"
      onclick={() => navigation.go(ROUTES.SETUP)}
      aria-label={m.mymods_account_setup()}
      title={m.mymods_account_setup()}
    >
      <span class="gear-icon" style={`--gear-mask: url("${gearIcon}")`} aria-hidden="true"></span>
    </button>
  </header>

  <div class="toolbar">
    <h1>{m.mymods_title()}</h1>
    <div class="toolbar-actions">
      <button type="button" class="secondary" onclick={openExisting}>{m.mymods_open_existing()}</button>
      <button type="button" class="primary" onclick={() => navigation.go(ROUTES.NEW_MOD)}>
        {m.mymods_new_mod()}
      </button>
    </div>
  </div>

  {#if addError}
    <p class="add-error" role="alert">{addError}</p>
  {/if}

  {#if openMods.entries.length === 0}
    <p class="empty">
      {m.mymods_empty({
        openExisting: m.mymods_open_existing(),
        newMod: m.mymods_new_mod(),
      })}
    </p>
  {:else}
    <ul class="mod-list">
      {#each openMods.entries as mod (mod.dir)}
        <li class="mod-card">
          {#if mod.status === "ready"}
            <button
              type="button"
              class="mod-open"
              onclick={() => navigation.go(ROUTES.MOD_DETAILS, { modId: mod.manifest.id })}
            >
              <span class="mod-icon" aria-hidden="true">{mod.manifest.icon}</span>
              <span class="mod-main">
                <span class="mod-name">{mod.manifest.name}</span>
                <span class="mod-meta">
                  {typeLabel(mod.manifest.type)} &middot; v{mod.manifest.version}
                </span>
              </span>
            </button>
          {:else if mod.status === "loading"}
            <div class="mod-open is-static">
              <span class="mod-icon" aria-hidden="true">&hellip;</span>
              <span class="mod-main">
                <span class="mod-name">{basename(mod.dir)}</span>
                <span class="mod-meta">{m.mymods_loading()}</span>
              </span>
            </div>
          {:else}
            <div class="mod-open is-static">
              <span class="mod-icon" aria-hidden="true">&#9888;</span>
              <span class="mod-main">
                <span class="mod-name">{basename(mod.dir)}</span>
                <span class="mod-meta error" title={mod.error ?? undefined}>
                  {m.mymods_error_unreadable()}
                </span>
              </span>
            </div>
          {/if}

          <div class="mod-actions">
            {#if confirmDir === mod.dir}
              <span class="confirm-label">{m.mymods_remove_confirm()}</span>
              <button type="button" class="ghost danger" onclick={() => confirmClose(mod.dir)}>
                {m.mymods_remove()}
              </button>
              <button type="button" class="ghost" onclick={cancelClose}>{m.mymods_cancel()}</button>
            {:else}
              {#if mod.status === "ready"}
                <button
                  type="button"
                  class="obsidian-button"
                  onclick={() => openInObsidian(mod.dir)}
                  aria-label={m.mymods_open_in_obsidian()}
                  title={m.mymods_open_in_obsidian()}
                >
                  <img src={obsidianLogo} alt="" class="obsidian-logo" aria-hidden="true" />
                </button>
              {/if}
              <button
                type="button"
                class="close-button"
                aria-label={m.mymods_remove_from_list_title()}
                title={m.mymods_remove_from_list_title()}
                onclick={() => requestClose(mod.dir)}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="published-link">
    <button type="button" class="ghost" onclick={() => openExternal(MOD_MANAGER_URL)}>
      {m.mymods_mod_manager_site()}
    </button>
  </div>
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  }

  .account {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-md);
    background: var(--color-surface-hover);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }

  .account-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .account-login {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    color: var(--color-github-logo);
    font-weight: 700;
    font-size: 1.1rem;
  }

  .github-logo {
    display: inline-block;
    width: 1.1rem;
    height: 1.1rem;
    flex-shrink: 0;
    background-color: var(--color-github-logo);
    mask-image: var(--github-mask);
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
    -webkit-mask-image: var(--github-mask);
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
  }

  .account-author {
    color: var(--color-text-muted);
  }

  /* Icon-only settings button. The account panel is `--color-surface-hover`, so
     hover to the lighter base surface instead of matching the panel. */
  .account-setup {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .account-setup:hover {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .gear-icon {
    display: block;
    width: 1.25rem;
    height: 1.25rem;
    background-color: currentColor;
    mask-image: var(--gear-mask);
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
    -webkit-mask-image: var(--gear-mask);
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
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

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .toolbar-actions {
    display: flex;
    gap: var(--spacing-sm);
  }

  .published-link {
    display: flex;
    justify-content: center;
  }

  .add-error {
    margin: 0;
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--color-error);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-error);
  }

  .empty {
    padding: var(--spacing-lg);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius);
    color: var(--color-text-muted);
    text-align: center;
  }

  .mod-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .mod-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .mod-open {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    flex: 1;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }

  .mod-open.is-static {
    cursor: default;
  }

  .mod-icon {
    font-size: 1.75rem;
    line-height: 1;
  }

  .mod-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mod-name {
    font-weight: 600;
    font-size: 1.05rem;
  }

  .mod-meta {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .mod-meta.error {
    color: var(--color-error);
  }

  .mod-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .confirm-label {
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .ghost.danger {
    color: var(--color-error);
    background: transparent;
    border-color: transparent;
  }

  .ghost.danger:hover {
    background: var(--color-error);
    border-color: var(--color-error);
    color: var(--color-primary-text);
  }

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

  .close-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast),
      color var(--transition-fast);
  }

  .close-button:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-primary);
    color: var(--color-text);
  }

  /* The multiplication-sign glyph sits below its em center; nudge it up so it
     reads as optically centered in the button. */
  .close-button span {
    display: block;
    line-height: 1;
    transform: translateY(-0.06em);
  }
</style>
