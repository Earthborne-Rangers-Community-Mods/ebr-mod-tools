<script>
  import BackButton from "../components/BackButton.svelte";
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import { MOD_TYPES } from "core";
</script>

<section class="page">
  <BackButton />

  <h1>New Mod</h1>
  <p class="lead">
    Feature-equivalent to <code>ebr new</code>. Walks you through creating a mod
    as a new branch in your fork.
  </p>

  <form class="form" onsubmit={(e) => e.preventDefault()}>
    <label class="field">
      <span>Name</span>
      <input type="text" placeholder="Expanded Boulder Field" />
    </label>
    <label class="field">
      <span>ID</span>
      <input type="text" placeholder="expanded-boulder-field" />
      <small class="hint">Derived from the name; lowercase kebab-case.</small>
    </label>
    <label class="field">
      <span>Type</span>
      <select>
        {#each MOD_TYPES as type (type.id)}
          <option value={type.id}>{type.name} &mdash; {type.description}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>Author</span>
      <input type="text" placeholder="ModCreatorName" />
    </label>
    <label class="field">
      <span>Discord (optional)</span>
      <input type="text" placeholder="modcreator#1234" />
    </label>
    <label class="field">
      <span>Icon (optional)</span>
      <input type="text" placeholder="Emoji" />
    </label>
    <label class="field">
      <span>Language</span>
      <input type="text" value="en" />
    </label>
    <label class="field wide">
      <span>Description</span>
      <textarea rows="2" placeholder="Short description for registry browsing."></textarea>
    </label>

    <p class="note">
      Type-specific questions (which campaigns to include, which maps and sets to
      scaffold, mid-campaign safety) appear here once this flow is wired up.
    </p>

    <div class="form-actions">
      <button type="button" class="ghost" onclick={() => navigation.go(ROUTES.MY_MODS)}>
        Cancel
      </button>
      <button type="submit" class="primary">Create mod</button>
    </div>
  </form>
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

  .form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--spacing-sm) var(--spacing-md);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field.wide {
    grid-column: 1 / -1;
  }

  .field span {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .hint {
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }

  .note {
    grid-column: 1 / -1;
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--color-surface-hover);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius);
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }

  .form-actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
  }
</style>
