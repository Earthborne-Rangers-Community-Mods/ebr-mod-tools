<script lang="ts">
  import BackButton from "../components/BackButton.svelte";
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import { setupStore } from "../lib/setup.svelte.js";
  import { themeStore, type ThemePreference } from "../lib/theme.svelte.js";
  import { openExternal } from "../lib/platform.js";
  import * as m from "../lib/paraglide/messages.js";
  import { pick } from "../lib/pick.js";
  import githubLogo from "../assets/icons/github-logo.svg";

  // Color-theme choices for the appearance control. "system" follows the OS
  // setting; "light"/"dark" pin the theme.
  const THEME_OPTIONS: { value: ThemePreference; label: () => string }[] = [
    { value: "system", label: m.setup_theme_system },
    { value: "light", label: m.setup_theme_light },
    { value: "dark", label: m.setup_theme_dark },
  ];

  // Snapshot of setup completion at page load. Deliberately non-reactive: the
  // back button's presence is fixed for the life of this page, so acting on the
  // page never reflows the top.
  const showBackButton = setupStore.completed;

  // Maps a store error code to its localized message.
  const ERROR_MESSAGES = {
    "no-sign-in": m.setup_error_no_sign_in,
    "status-failed": m.setup_error_status_failed,
    "setup-failed": m.setup_error_setup_failed,
    "save-failed": m.setup_error_save_failed,
    "clear-failed": m.setup_error_clear_failed,
    "switch-failed": m.setup_error_switch_failed,
    "switch-manual": m.setup_error_switch_manual,
  };

  // Inline confirmation for the destructive "switch account" action, which
  // makes git forget the saved GitHub credential.
  let confirmingSwitch = $state(false);

  async function confirmSwitchAccount() {
    confirmingSwitch = false;
    await setupStore.switchAccount();
  }

  // Inline confirmation for "start over", which clears the stored fork URLs and
  // author defaults from ~/.ebr/.
  let confirmingClear = $state(false);

  async function confirmClearStoredSetup() {
    confirmingClear = false;
    await setupStore.clearStoredSetup();
  }
</script>

<section class="page">
  {#if showBackButton}
    <BackButton />
  {/if}

  <h1>{m.setup_title()}</h1>
  <p class="lead">{m.setup_lead()}</p>
  <p class="detail github-help">
    {m.setup_github_prompt()}
    <button type="button" class="link" onclick={() => openExternal("https://github.com")}>
      {m.setup_github_link()}
    </button>
  </p>

  {#if setupStore.errorCode}
    <p class="banner error" role="alert">{pick(ERROR_MESSAGES, setupStore.errorCode)?.()}</p>
  {/if}

  <div class="card">
    <h2>{m.setup_credentials_heading()}</h2>
    <p class="detail">{m.setup_credentials_lead()}</p>
    <p class="status-row">
      <span
        class="dot"
        class:ok={!setupStore.checkingStatus && setupStore.credentialsOk}
        class:bad={!setupStore.checkingStatus && setupStore.credentialsChecked && !setupStore.credentialsOk}
      ></span>
      {#if setupStore.checkingStatus}
        {m.setup_credentials_checking()}
      {:else if setupStore.credentialsChecked}
        {setupStore.credentialsOk ? m.setup_credentials_working() : m.setup_credentials_none()}
      {:else if setupStore.displayLogin}
        {m.setup_credentials_unverified()}
      {:else}
        {m.setup_credentials_unchecked()}
      {/if}
    </p>
    {#if setupStore.detectedLogin}
      <p class="detail account-line">
        <span class="github-logo" style={`--github-mask: url("${githubLogo}")`} aria-hidden="true"></span>
        <strong class="account-name">{setupStore.detectedLogin}</strong>
      </p>
    {:else if setupStore.displayLogin}
      <p class="detail account-line">
        <span class="github-logo" style={`--github-mask: url("${githubLogo}")`} aria-hidden="true"></span>
        <strong class="account-name">{setupStore.displayLogin}</strong>
      </p>
    {:else}
      <p class="detail">{m.setup_no_account()}</p>
    {/if}
    <div class="card-actions">
      <button type="button" class="secondary" disabled={setupStore.busy} onclick={() => setupStore.checkStatus()}>
        {m.setup_check_status()}
      </button>
      {#if setupStore.detectedLogin}
        {#if confirmingSwitch}
          <button type="button" class="danger" disabled={setupStore.busy} onclick={confirmSwitchAccount}>
            {m.setup_switch_confirm_yes()}
          </button>
          <button type="button" class="ghost" disabled={setupStore.busy} onclick={() => (confirmingSwitch = false)}>
            {m.setup_switch_cancel()}
          </button>
        {:else}
          <button type="button" class="ghost" disabled={setupStore.busy} onclick={() => (confirmingSwitch = true)}>
            {m.setup_switch_account()}
          </button>
        {/if}
      {/if}
    </div>
    {#if setupStore.detectedLogin && confirmingSwitch}
      <p class="detail warn">{m.setup_switch_confirm()}</p>
    {/if}
  </div>

  <div class="card">
    <h2>{m.setup_forks_heading()}</h2>
    <p class="detail">{m.setup_forks_lead()}</p>
    <p class="status-row">
      <span
        class="dot"
        class:ok={!setupStore.settingUpForks && setupStore.completed}
        class:bad={!setupStore.settingUpForks && !setupStore.completed}
      ></span>
      {#if setupStore.settingUpForks}
        {setupStore.progress ?? m.setup_forks_working()}
      {:else}
        {setupStore.completed ? m.setup_forks_ready() : m.setup_forks_missing()}
      {/if}
    </p>
    <dl class="fork-list">
      <div>
        <dt>{m.setup_fork_base_content()}</dt>
        <dd>{setupStore.forks.baseContent ?? m.setup_not_configured()}</dd>
      </div>
      <div>
        <dt>{m.setup_fork_registry()}</dt>
        <dd>{setupStore.forks.registry ?? m.setup_not_configured()}</dd>
      </div>
    </dl>

    {#if setupStore.baseForkReachable === false || setupStore.registryForkReachable === false}
      <p class="detail warn">{m.setup_forks_unreachable()}</p>
    {/if}

    {#if setupStore.manualForks.length > 0}
      <div class="manual">
        <p class="detail">{m.setup_manual_intro()}</p>
        <ul class="manual-list">
          {#each setupStore.manualForks as fork (fork.repo)}
            <li>
              <button type="button" class="ghost" onclick={() => openExternal(fork.browserUrl)}>
                {m.setup_manual_open({ repo: fork.repo })}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="card-actions">
      <button
        type="button"
        class:primary={!setupStore.completed}
        class:secondary={setupStore.completed}
        disabled={setupStore.busy}
        onclick={() => setupStore.runSetup()}
      >
        {setupStore.completed ? m.setup_run_again() : m.setup_create_forks()}
      </button>
    </div>
  </div>

  <div class="card">
    <h2>{m.setup_author_heading()}</h2>
    <p class="detail">{m.setup_author_lead()}</p>
    <p class="status-row">
      <span
        class="dot"
        class:ok={!setupStore.authorDirty && setupStore.hasAuthorDefault}
        class:bad={!setupStore.authorDirty && !setupStore.hasAuthorDefault}
      ></span>
      {#if setupStore.authorDirty}
        {m.setup_author_unsaved()}
      {:else if setupStore.hasAuthorDefault}
        {m.setup_author_saved()}
      {:else}
        {m.setup_author_missing()}
      {/if}
    </p>
    <label class="field">
      <span>{m.setup_author_name()}</span>
      <input type="text" bind:value={setupStore.author} disabled={setupStore.busy} />
    </label>
    <label class="field">
      <span>{m.setup_author_discord()}</span>
      <input type="text" bind:value={setupStore.authorDiscord} disabled={setupStore.busy} />
    </label>
    <div class="card-actions">
      <button type="button" class="primary" disabled={setupStore.busy} onclick={() => setupStore.saveAuthorDefaults()}>
        {m.setup_save_defaults()}
      </button>
    </div>
  </div>

  <div class="card">
    <h2>{m.setup_appearance_heading()}</h2>
    <p class="detail">{m.setup_appearance_lead()}</p>
    <div class="theme-choice" role="radiogroup" aria-label={m.setup_appearance_heading()}>
      {#each THEME_OPTIONS as option (option.value)}
        <label class="theme-option" class:selected={themeStore.preference === option.value}>
          <input
            type="radio"
            name="theme"
            value={option.value}
            checked={themeStore.preference === option.value}
            onchange={() => themeStore.set(option.value)}
          />
          <span>{option.label()}</span>
        </label>
      {/each}
    </div>
  </div>

  <div class="clear-row">
    <div class="card-actions">
      {#if confirmingClear}
        <button type="button" class="danger" disabled={setupStore.busy} onclick={confirmClearStoredSetup}>
          {m.setup_clear_confirm_yes()}
        </button>
        <button type="button" class="ghost" disabled={setupStore.busy} onclick={() => (confirmingClear = false)}>
          {m.setup_clear_cancel()}
        </button>
      {:else}
        <button type="button" class="ghost" disabled={setupStore.busy} onclick={() => (confirmingClear = true)}>
          {m.setup_clear()}
        </button>
      {/if}
      {#if setupStore.completed}
        <button type="button" class="primary" disabled={setupStore.busy} onclick={() => navigation.go(ROUTES.MY_MODS)}>
          {m.setup_done()}
        </button>
      {/if}
    </div>
    {#if confirmingClear}
      <p class="detail warn">{m.setup_clear_lead()}</p>
    {/if}
  </div>
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .lead {
    color: var(--color-text-muted);
  }

  .github-help {
    margin-top: calc(-1 * var(--spacing-xs));
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    padding: var(--spacing-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .card h2 {
    font-size: 1rem;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-text-muted);
  }

  .dot.ok {
    background: var(--color-success);
  }

  .dot.bad {
    background: var(--color-error);
  }

  .detail {
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .detail.warn {
    color: var(--color-error);
  }

  .theme-choice {
    display: inline-flex;
    gap: var(--spacing-xs);
    align-self: flex-start;
    padding: var(--spacing-xs);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-bg);
  }

  .theme-option {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-xs) var(--spacing-md);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .theme-option:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }

  .theme-option.selected {
    background: var(--color-primary);
    color: var(--color-primary-text);
  }

  .theme-option.selected:hover {
    background: var(--color-primary-hover);
  }

  /* The native radio conveys state through the label styling; it stays in the
     DOM for keyboard selection and focus, but is visually hidden. */
  .theme-option input {
    position: absolute;
    width: 0;
    height: 0;
    margin: 0;
    opacity: 0;
  }

  .theme-option:focus-within {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .account-line {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .account-line strong {
    color: var(--color-github-logo);
  }

  .account-name {
    color: var(--color-github-logo);
  }

  .github-logo {
    display: inline-block;
    width: 1em;
    height: 1em;
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

  .fork-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .fork-list dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .fork-list dd {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    word-break: break-all;
  }

  .manual-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field span {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-sm);
  }

  /* The Start over action is not a section - it just sits quietly at the
     bottom of the page. */
  .clear-row {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }

  .clear-row .card-actions {
    justify-content: flex-end;
  }
</style>
