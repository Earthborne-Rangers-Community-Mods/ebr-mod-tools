<script>
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import { PLACEHOLDER_ACCOUNT, PLACEHOLDER_MODS } from "../lib/placeholder.js";
  import { MOD_TYPES } from "core";

  const account = PLACEHOLDER_ACCOUNT;
  const mods = PLACEHOLDER_MODS;

  function typeLabel(typeId) {
    return MOD_TYPES.find((t) => t.id === typeId)?.name ?? typeId;
  }
</script>

<section class="page">
  <header class="account">
    <div>
      <p class="account-label">Signed in as</p>
      <p class="account-login">{account.login}</p>
      <p class="account-author">
        {account.author}
        {#if account.authorDiscord}
          <span class="muted">&middot; {account.authorDiscord}</span>
        {/if}
      </p>
    </div>
    <button type="button" class="link" onclick={() => navigation.go(ROUTES.SETUP)}>
      Account &amp; setup
    </button>
  </header>

  <div class="toolbar">
    <h1>My Mods</h1>
    <div class="toolbar-actions">
      <button type="button" class="secondary">Open existing mod</button>
      <button type="button" class="primary" onclick={() => navigation.go(ROUTES.NEW_MOD)}>
        New mod
      </button>
    </div>
  </div>

  <ul class="mod-list">
    {#each mods as mod (mod.id)}
      <li class="mod-card">
        <button
          type="button"
          class="mod-open"
          onclick={() => navigation.go(ROUTES.MOD_DETAILS, { modId: mod.id })}
        >
          <span class="mod-icon" aria-hidden="true">{mod.icon}</span>
          <span class="mod-main">
            <span class="mod-name">{mod.name}</span>
            <span class="mod-meta">
              {typeLabel(mod.type)} &middot; v{mod.version}
              {#if mod.dirty}
                <span class="badge dirty">Unsaved changes</span>
              {/if}
              {#if mod.publishedVersion && mod.publishedVersion !== mod.version}
                <span class="badge published">Published v{mod.publishedVersion}</span>
              {/if}
            </span>
          </span>
        </button>
        <div class="mod-actions">
          {#if mod.dirty}
            <button type="button" class="secondary">Save</button>
          {/if}
          <button type="button" class="secondary">Open in Obsidian</button>
          <button type="button" class="ghost" title="Remove from list">Close</button>
        </div>
      </li>
    {/each}
  </ul>
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
    font-weight: 700;
    font-size: 1.1rem;
  }

  .account-author {
    color: var(--color-text-muted);
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

  .badge {
    font-size: 0.7rem;
    padding: 2px 6px;
    border-radius: 999px;
    font-weight: 600;
  }

  .badge.dirty {
    background: var(--color-surface);
    color: var(--color-primary);
    border: 1px solid var(--color-primary);
  }

  .badge.published {
    background: var(--color-surface);
    color: var(--color-success);
    border: 1px solid var(--color-success);
  }

  .mod-actions {
    display: flex;
    gap: var(--spacing-sm);
  }
</style>
