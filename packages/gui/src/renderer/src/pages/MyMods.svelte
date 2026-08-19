<script lang="ts">
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import { openMods } from "../lib/mods.svelte.js";
  import { setupStore } from "../lib/setup.svelte.js";
  import { gitStatus } from "../lib/gitstatus.svelte.js";
  import { conflictFlow } from "../lib/conflict.svelte.js";
  import { openModFlow } from "../lib/openmod.svelte.js";
  import { openExternal, MOD_MANAGER_URL } from "../lib/platform.js";
  import { typeName } from "../lib/modtypes.js";
  import ObsidianButton from "../components/ObsidianButton.svelte";
  import SaveControl from "../components/SaveControl.svelte";
  import PublishBadge from "../components/PublishBadge.svelte";
  import DirtyMarker from "../components/DirtyMarker.svelte";
  import HelpPanel from "../components/HelpPanel.svelte";
  import { helpDialog } from "../lib/helpdialog.svelte.js";
  import { basename } from "node:path";
  import * as m from "../lib/paraglide/messages.js";
  import discordLogo from "../assets/icons/discord-logo.svg";
  import githubLogo from "../assets/icons/github-logo.svg";
  import gearIcon from "../assets/icons/gear.svg";
  import helpIcon from "../assets/icons/circled-question.svg";

  let confirmDir = $state<string | null>(null);

  function requestClose(dir: string) {
    confirmDir = dir;
  }

  function cancelClose() {
    confirmDir = null;
  }

  function confirmClose(dir: string) {
    openMods.remove(dir);
    if (confirmDir === dir) confirmDir = null;
  }

  /**
   * Open a mod, reading its state from disk to route to the right place: a
   * mid-merge mod goes to the Conflict page; a mod with a valid manifest opens its
   * details; a readable-but-broken manifest opens straight in the editor to be
   * repaired.
   */
  async function openMod(dir: string) {
    if (await conflictFlow.enterFromDisk(dir)) return;
    const entry = openMods.getByDir(dir);
    const destination = entry?.status === "ready" ? ROUTES.MOD_DETAILS : ROUTES.MOD_EDIT;
    navigation.go(destination, { dir });
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
    <div class="account-actions">
      <button
        type="button"
        class="icon-button ghost"
        onclick={() => helpDialog.open()}
        aria-label={m.help_button_label()}
        title={m.help_button_label()}
      >
        <span class="icon" style={`--icon-mask: url("${helpIcon}")`} aria-hidden="true"></span>
      </button>
      <button
        type="button"
        class="icon-button ghost"
        onclick={() => navigation.go(ROUTES.SETUP)}
        aria-label={m.mymods_account_setup()}
        title={m.mymods_account_setup()}
      >
        <span class="icon" style={`--icon-mask: url("${gearIcon}")`} aria-hidden="true"></span>
      </button>
    </div>
  </header>

  <div class="toolbar">
    <h1>{m.mymods_title()}</h1>
    <div class="toolbar-actions">
      <button type="button" class="secondary" onclick={() => openModFlow.open()}>{m.mymods_open_existing()}</button>
      <button type="button" class="primary" onclick={() => navigation.go(ROUTES.NEW_MOD)}>
        {m.mymods_new_mod()}
      </button>
    </div>
  </div>

  {#if openMods.entries.length === 0}
    <p class="empty">
      <HelpPanel />
    </p>
  {:else}
    <ul class="mod-list">
      {#each openMods.entries as mod (mod.dir)}
        <li class="mod-card">
          {#if mod.status === "ready" && mod.manifest}
            {@const mf = mod.manifest}
            <button
              type="button"
              class="mod-open"
              onclick={() => openMod(mod.dir)}
            >
              <span class="mod-icon" aria-hidden="true">{mf.icon}</span>
              <span class="mod-main">
                <span class="mod-name">
                  {mf.name}<DirtyMarker dir={mod.dir} />
                  {#if gitStatus.get(mod.dir)?.merging}
                    <span class="mid-merge-flag">{m.mymods_mid_merge()}</span>
                  {/if}
                </span>
                <span class="mod-meta">
                  {typeName(mf.type ?? "")} &middot; v{mf.version}
                  <PublishBadge dir={mod.dir} />
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
          {:else if mod.manifest}
            <button
              type="button"
              class="mod-open"
              onclick={() => openMod(mod.dir)}
            >
              <span class="mod-icon" aria-hidden="true">&#9888;</span>
              <span class="mod-main">
                <span class="mod-name">{basename(mod.dir)}</span>
                <span class="mod-meta error">{m.mymods_error_invalid()}</span>
              </span>
            </button>
          {:else}
            <div class="mod-open is-static">
              <span class="mod-icon" aria-hidden="true">&#9888;</span>
              <span class="mod-main">
                <span class="mod-name">{basename(mod.dir)}</span>
                <span class="mod-meta error" title={mod.error ? m.mymods_error_unreadable_detail({ folder: basename(mod.dir), detail: mod.error }) : undefined}>
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
              {#if mod.status === "ready" && !gitStatus.get(mod.dir)?.merging}
                <SaveControl dir={mod.dir} />
                <ObsidianButton dir={mod.dir} />
              {/if}
              <button
                type="button"
                class="icon-button ghost"
                aria-label={m.mymods_remove_from_list_title()}
                title={m.mymods_remove_from_list_title()}
                onclick={() => requestClose(mod.dir)}
              >
                <span class="close-icon" aria-hidden="true">&times;</span>
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

  .account-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  /* Icon-only settings/help buttons. The account panel is `--color-surface-hover`,
     so hover to the lighter base surface instead of matching the panel. */
  .account-actions .icon-button:hover {
    background: var(--color-surface);
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

  .empty {
    padding: var(--spacing-lg);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius);
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

  .mid-merge-flag {
    display: inline-block;
    margin-left: var(--spacing-xs);
    padding: 0.05em 0.5em;
    border-radius: var(--radius-sm);
    background: var(--color-error);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    vertical-align: middle;
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

  /* The multiplication-sign glyph sits below its em center; nudge it up so it
     reads as optically centered in the button. */
  .close-icon {
    display: block;
    line-height: 1;
    transform: scale(1.5) translateY(-0.06em);
  }
</style>
