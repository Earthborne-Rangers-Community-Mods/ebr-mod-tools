<script>
  import BackButton from "../components/BackButton.svelte";
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import { findPlaceholderMod, PLACEHOLDER_MODS } from "../lib/placeholder.js";
  import { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "core";

  const mod = $derived(findPlaceholderMod(navigation.selectedModId) ?? PLACEHOLDER_MODS[0]);

  function typeLabel(typeId) {
    return MOD_TYPES.find((t) => t.id === typeId)?.name ?? typeId;
  }
</script>

<section class="page">
  <BackButton />

  <header class="mod-header">
    <span class="mod-icon" aria-hidden="true">{mod.icon}</span>
    <div>
      <h1>{mod.name}</h1>
      <p class="muted">{typeLabel(mod.type)} &middot; v{mod.version} &middot; {mod.id}</p>
    </div>
  </header>

  <div class="actions">
    <button type="button" class="primary">Save</button>
    <button type="button" class="primary">Publish</button>
    <button type="button" class="secondary">Include campaign</button>
    <button type="button" class="secondary">Scaffold</button>
    <button type="button" class="secondary" onclick={() => navigation.go(ROUTES.CONFLICT)}>
      Check for updates
    </button>
    {#if mod.prUrl}
      <a class="secondary link-button" href={mod.prUrl} target="_blank" rel="noreferrer">
        View open PR
      </a>
    {/if}
  </div>

  <div class="fields">
    <label class="field">
      <span>Name</span>
      <input type="text" value={mod.name} />
    </label>
    <label class="field">
      <span>ID</span>
      <input type="text" value={mod.id} readonly />
    </label>
    <label class="field">
      <span>Version</span>
      <input type="text" value={mod.version} />
    </label>
    <label class="field">
      <span>Icon</span>
      <input type="text" value={mod.icon} />
    </label>
    <label class="field">
      <span>Type</span>
      <select value={mod.type}>
        {#each MOD_TYPES as type (type.id)}
          <option value={type.id}>{type.name}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>Language</span>
      <input type="text" value={mod.language} />
    </label>
    <label class="field wide">
      <span>Description</span>
      <textarea rows="2">{mod.description}</textarea>
    </label>
    <label class="field">
      <span>Author</span>
      <input type="text" value={mod.author} />
    </label>
    <label class="field">
      <span>Discord</span>
      <input type="text" value={mod.authorDiscord} />
    </label>
    <label class="field wide">
      <span>Tags</span>
      <input type="text" value={mod.tags.join(", ")} />
    </label>
    <label class="field wide">
      <span>Repo URL</span>
      <input type="text" value={mod.repoUrl} readonly />
    </label>
  </div>

  <fieldset class="group">
    <legend>Campaigns</legend>
    <div class="checks">
      {#each OFFICIAL_CAMPAIGNS as campaign (campaign.id)}
        <label class="check">
          <input type="checkbox" checked={mod.campaigns.includes(campaign.id)} />
          {campaign.name}
        </label>
      {/each}
    </div>
  </fieldset>

  <fieldset class="group">
    <legend>Required products</legend>
    <div class="checks">
      {#each OFFICIAL_PRODUCTS as product (product.id)}
        <label class="check">
          <input type="checkbox" checked={mod.requiredProducts.includes(product.id)} />
          {product.name}
        </label>
      {/each}
    </div>
  </fieldset>

  <fieldset class="group">
    <legend>Optional products</legend>
    <div class="checks">
      {#each OFFICIAL_PRODUCTS as product (product.id)}
        <label class="check">
          <input type="checkbox" checked={mod.optionalProducts.includes(product.id)} />
          {product.name}
        </label>
      {/each}
    </div>
  </fieldset>

  <fieldset class="group">
    <legend>Mid-campaign safety</legend>
    <label class="check">
      <input type="checkbox" checked={mod.safeToAddMidCampaign} />
      Safe to add mid-campaign
    </label>
    <label class="field wide">
      <span>Notes</span>
      <textarea rows="2">{mod.midCampaignNotes}</textarea>
    </label>
  </fieldset>
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .mod-header {
    display: flex;
    align-items: center;
    gap: var(--space-md);
  }

  .mod-icon {
    font-size: 2.5rem;
    line-height: 1;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
  }

  .link-button {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-sm) var(--space-md);
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
    color: var(--text-secondary);
  }

  .group {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .group legend {
    font-weight: 600;
    padding: 0 var(--space-xs);
  }

  .checks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--space-xs);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: 0.9rem;
  }
</style>
