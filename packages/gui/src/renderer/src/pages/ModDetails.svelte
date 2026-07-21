<script>
  import { onMount } from "svelte";
  import BackButton from "../components/BackButton.svelte";
  import CheckGroup from "../components/CheckGroup.svelte";
  import EmojiField from "../components/EmojiField.svelte";
  import LanguageField from "../components/LanguageField.svelte";
  import MidCampaignSafety from "../components/MidCampaignSafety.svelte";
  import ObsidianButton from "../components/ObsidianButton.svelte";
  import { navigation } from "../lib/navigation.svelte.js";
  import { modDetailsForm } from "../lib/moddetails.svelte.js";
  import { typeName, typeDesc } from "../lib/modtypes.js";
  import { openPath } from "../lib/platform.js";
  import { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "core";
  import * as m from "../lib/paraglide/messages.js";

  const form = modDetailsForm;

  onMount(() => form.load(navigation.selectedModId));

  const ERROR_MESSAGES = {
    "invalid-name": m.moddetails_error_invalid_name,
    "invalid-version": m.moddetails_error_invalid_version,
    "invalid-description": m.moddetails_error_invalid_description,
    "invalid-author": m.moddetails_error_invalid_author,
  };

  function campaignLabel(campaign) {
    return campaign.oneDayMission
      ? `${campaign.name} (${m.moddetails_one_day_tag()})`
      : campaign.name;
  }

  // Localized inline error for a field, or null when it is currently valid.
  function fieldError(field) {
    const code = form.fieldErrors[field];
    return code ? ERROR_MESSAGES[code]?.() : null;
  }
</script>

<section class="page">
  <BackButton />

  {#if !form.loaded}
    <p class="banner error" role="alert">{m.moddetails_not_found()}</p>
  {:else}
    <header class="mod-header">
      <span class="mod-icon" aria-hidden="true">{form.icon}</span>
      <div>
        <h1>{form.name}</h1>
        <p class="muted">{typeName(form.type)} &middot; v{form.version} &middot; {form.id}</p>
      </div>
      <span class="save-status" aria-live="polite">
        {#if form.saveState === "saving"}
          {m.moddetails_saving()}
        {:else if form.hasErrors}
          <span class="error-text">{m.moddetails_save_blocked()}</span>
        {:else if form.saveState === "error"}
          <span class="error-text">{m.moddetails_save_error({ detail: form.errorDetail ?? "" })}</span>
        {:else if form.dirty}
          {m.moddetails_unsaved()}
        {:else if form.saveState === "saved"}
          {m.moddetails_saved()}
        {/if}
      </span>
    </header>

    <div class="actions">
      <button
        type="button"
        class="primary"
        onclick={() => form.save()}
        disabled={!form.dirty || form.saveState === "saving"}
      >
        {m.moddetails_save()}
      </button>
      <button
        type="button"
        class="secondary"
        onclick={() => form.revert()}
        disabled={!form.dirty || form.saveState === "saving"}
      >
        {m.moddetails_undo()}
      </button>
      <button type="button" class="ghost" onclick={() => openPath(form.dir)}>
        {m.moddetails_open_folder()}
      </button>
      <ObsidianButton dir={form.dir} size="fill" />
    </div>

    <div class="fields">
      <label class="field">
        <span>{m.moddetails_field_name()}</span>
        <input type="text" bind:value={form.name} onblur={() => form.validateField("name")} />
        {#if fieldError("name")}
          <small class="hint error-text">{fieldError("name")}</small>
        {/if}
      </label>
      <label class="field">
        <span>{m.moddetails_field_id()}</span>
        <input type="text" value={form.id} readonly />
      </label>
      <label class="field">
        <span>{m.moddetails_field_version()}</span>
        <input type="text" bind:value={form.version} onblur={() => form.validateField("version")} />
        {#if fieldError("version")}
          <small class="hint error-text">{fieldError("version")}</small>
        {/if}
      </label>
      <div class="field">
        <span id="icon-field-label">{m.moddetails_field_icon()}</span>
        <EmojiField bind:value={form.icon} labelledby="icon-field-label" />
      </div>
      <label class="field">
        <span>{m.moddetails_field_type()}</span>
        <select
          value={form.pendingType ?? form.type}
          onchange={(e) => form.requestTypeChange(e.currentTarget.value)}
        >
          {#each MOD_TYPES as type (type.id)}
            <option value={type.id}>
              {typeName(type.id)} &mdash; {typeDesc(type.id)}
            </option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>{m.moddetails_field_language()}</span>
        <LanguageField bind:value={form.language} />
      </label>
      <label class="field wide">
        <span>{m.moddetails_field_description()}</span>
        <textarea rows="2" bind:value={form.description} onblur={() => form.validateField("description")}></textarea>
        {#if fieldError("description")}
          <small class="hint error-text">{fieldError("description")}</small>
        {/if}
      </label>
      <label class="field">
        <span>{m.moddetails_field_author()}</span>
        <input type="text" bind:value={form.author} onblur={() => form.validateField("author")} />
        {#if fieldError("author")}
          <small class="hint error-text">{fieldError("author")}</small>
        {/if}
      </label>
      <label class="field">
        <span>{m.moddetails_field_discord()}</span>
        <input type="text" bind:value={form.authorDiscord} />
      </label>
      <label class="field wide">
        <span>{m.moddetails_field_tags()}</span>
        <input type="text" bind:value={form.tags} />
        <small class="hint">{m.moddetails_tags_hint()}</small>
      </label>
      <label class="field wide">
        <span>{m.moddetails_field_repo_url()}</span>
        <input type="text" value={form.repoUrl || m.moddetails_repo_url_none()} readonly />
      </label>
    </div>

    {#if form.typeChangePending}
      <div class="banner warn" role="alert">
        <p class="warn-title">{m.moddetails_type_warning_title({ type: typeName(form.pendingType) })}</p>
        <p>{m.moddetails_type_warning()}</p>
        <div class="banner-actions">
          <button type="button" class="primary" onclick={() => form.confirmTypeChange()}>
            {m.moddetails_type_confirm()}
          </button>
          <button type="button" class="ghost" onclick={() => form.cancelTypeChange()}>
            {m.moddetails_type_cancel()}
          </button>
        </div>
      </div>
    {/if}

    <CheckGroup
      legend={m.moddetails_campaigns()}
      items={OFFICIAL_CAMPAIGNS}
      key={(campaign) => campaign.id}
      label={campaignLabel}
      checked={(campaign) => form.campaigns.includes(campaign.id)}
      onToggle={(campaign) => form.toggleCampaign(campaign.id)}
    />

    <CheckGroup
      legend={m.moddetails_required_products()}
      items={OFFICIAL_PRODUCTS}
      key={(product) => product.id}
      label={(product) => product.name}
      checked={(product) => form.requiredProducts.includes(product.id)}
      onToggle={(product) => form.toggleRequiredProduct(product.id)}
    />

    <CheckGroup
      legend={m.moddetails_optional_products()}
      items={OFFICIAL_PRODUCTS}
      key={(product) => product.id}
      label={(product) => product.name}
      checked={(product) => form.optionalProducts.includes(product.id)}
      onToggle={(product) => form.toggleOptionalProduct(product.id)}
    />

    <MidCampaignSafety
      type={form.type}
      bind:safe={form.safeToAddMidCampaign}
      bind:notes={form.midCampaignNotes}
    />
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
    align-items: center;
    gap: var(--spacing-md);
  }

  .mod-icon {
    font-size: 2.5rem;
    line-height: 1;
  }

  .save-status {
    margin-left: auto;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-sm);
  }

  .banner {
    margin: 0;
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .banner.error {
    border-color: var(--color-error);
    color: var(--color-error);
  }

  .banner.warn {
    border-color: var(--color-warning, var(--color-border));
  }

  .banner .warn-title {
    font-weight: 600;
    margin: 0;
  }

  .banner p {
    margin: 0;
  }

  .banner-actions {
    display: flex;
    gap: var(--spacing-sm);
  }

  .fields {
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

  .error-text {
    color: var(--color-error);
  }
</style>
