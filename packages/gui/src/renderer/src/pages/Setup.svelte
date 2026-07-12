<script>
  import BackButton from "../components/BackButton.svelte";
  import { PLACEHOLDER_ACCOUNT } from "../lib/placeholder.js";

  const account = PLACEHOLDER_ACCOUNT;
</script>

<section class="page">
  <BackButton />

  <h1>Setup</h1>
  <p class="lead">
    Feature-equivalent to <code>ebr setup</code>. Confirms your git credentials
    work and ensures your two creator forks exist.
  </p>

  <div class="card">
    <h2>GitHub credentials</h2>
    <p class="status-row">
      <span class="dot" class:ok={account.credentialsOk}></span>
      {account.credentialsOk ? "Credentials working" : "Not verified"}
    </p>
    <p class="detail">Detected account: <strong>{account.login}</strong></p>
    <button type="button" class="secondary">Check status</button>
  </div>

  <div class="card">
    <h2>Creator forks</h2>
    <p class="status-row">
      <span class="dot" class:ok={account.forksReady}></span>
      {account.forksReady ? "Both forks ready" : "Forks missing"}
    </p>
    <dl class="fork-list">
      <div>
        <dt>Base content</dt>
        <dd>{account.baseContentFork}</dd>
      </div>
      <div>
        <dt>Registry</dt>
        <dd>{account.registryFork}</dd>
      </div>
    </dl>
    <button type="button" class="secondary">Create forks</button>
  </div>

  <div class="card">
    <h2>Author defaults</h2>
    <label class="field">
      <span>Author name</span>
      <input type="text" value={account.author} />
    </label>
    <label class="field">
      <span>Discord handle</span>
      <input type="text" value={account.authorDiscord} />
    </label>
    <div class="card-actions">
      <button type="button" class="primary">Save defaults</button>
      <button type="button" class="ghost">Clear stored setup</button>
    </div>
  </div>
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .lead {
    color: var(--text-secondary);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .card h2 {
    font-size: 1rem;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-secondary);
  }

  .dot.ok {
    background: var(--success-strong);
  }

  .detail {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .fork-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .fork-list dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }

  .fork-list dd {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    word-break: break-all;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field span {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .card-actions {
    display: flex;
    gap: var(--space-sm);
  }
</style>
