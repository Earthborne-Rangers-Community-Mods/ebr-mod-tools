<script>
  import BackButton from "../components/BackButton.svelte";

  // Placeholder conflicted files for the blockout.
  const conflicts = [
    "Custom Campaigns/Expanded Boulder Field/1.1 Boulder Field.md",
    "Custom Campaigns/Expanded Boulder Field/NPCs/Old Marn.md",
    ".obsidian/snippets/ebr-symbols.css",
  ];
</script>

<section class="page">
  <BackButton />

  <h1>Resolve conflicts</h1>
  <p class="lead">
    This merge has conflicts. Choose which version to keep for each file, or open
    it in Obsidian to blend by hand. This is a simple per-file resolver, not a
    full mergetool.
  </p>

  <ul class="conflict-list">
    {#each conflicts as file (file)}
      <li class="conflict">
        <p class="path">{file}</p>
        <div class="choices">
          <label class="choice">
            <input type="radio" name={file} />
            Keep my version
          </label>
          <label class="choice">
            <input type="radio" name={file} />
            Use incoming version
          </label>
          <button type="button" class="secondary">Open in Obsidian</button>
        </div>
      </li>
    {/each}
  </ul>

  <div class="footer">
    <button type="button" class="ghost">Open terminal here</button>
    <div class="footer-right">
      <button type="button" class="danger">Undo this merge</button>
      <button type="button" class="primary">Finish merge</button>
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
    max-width: 44rem;
  }

  .conflict-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .conflict {
    padding: var(--space-md);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .path {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    word-break: break-all;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-md);
  }

  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: 0.9rem;
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--border);
    padding-top: var(--space-md);
  }

  .footer-right {
    display: flex;
    gap: var(--space-sm);
  }

  .danger {
    background: var(--danger-soft);
    color: var(--danger-strong);
    border-color: transparent;
  }
</style>
