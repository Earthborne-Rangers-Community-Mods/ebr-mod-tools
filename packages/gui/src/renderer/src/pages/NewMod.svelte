<script>
  import BackButton from "../components/BackButton.svelte";
  import CheckGroup from "../components/CheckGroup.svelte";
  import EmojiField from "../components/EmojiField.svelte";
  import LanguageField from "../components/LanguageField.svelte";
  import MidCampaignSafety from "../components/MidCampaignSafety.svelte";
  import { navigation, ROUTES } from "../lib/navigation.svelte.js";
  import { setupStore } from "../lib/setup.svelte.js";
  import {
    newModForm,
    MAP_SCAFFOLDS,
    PATH_SET_SCAFFOLDS,
    STORY_CAMPAIGNS,
  } from "../lib/newmod.svelte.js";
  import { typeName, typeDesc } from "../lib/modtypes.js";
  import { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "core";
  import * as m from "../lib/paraglide/messages.js";
  import { pick } from "../lib/pick.js";
  import { onMount } from "svelte";

  const form = newModForm;

  onMount(() => form.reset());

  const ERROR_MESSAGES = {
    "setup-required": m.newmod_error_setup_required,
    "invalid-name": m.newmod_error_invalid_name,
    "invalid-description": m.newmod_error_invalid_description,
    "invalid-language": m.newmod_error_invalid_language,
    "invalid-icon": m.newmod_error_invalid_icon,
    "invalid-author": m.newmod_error_invalid_author,
    "no-folder": m.newmod_error_no_folder,
  };

  // Expansions target story campaigns only; other types may target one-day
  // missions too.
  const campaignChoices = $derived(
    form.type === "expansion" ? STORY_CAMPAIGNS : OFFICIAL_CAMPAIGNS,
  );

  /** @param {{name: string, oneDayMission?: boolean}} campaign */
  function campaignLabel(campaign) {
    return campaign.oneDayMission ? `${campaign.name} (${m.newmod_one_day_tag()})` : campaign.name;
  }

  // Localized inline error for a field the user has blurred (or that failed the
  // create gate), or null when the field is currently valid.
  /** @param {string} field */
  function fieldError(field) {
    const code = form.fieldErrors[field];
    return code ? pick(ERROR_MESSAGES, code)?.() : null;
  }
</script>

<section class="page">
  <BackButton />

  <h1>{m.newmod_title()}</h1>
  <p class="lead">{m.newmod_lead()}</p>

  {#if !setupStore.completed}
    <div class="banner warn" role="alert">
      <span>{m.newmod_setup_required()}</span>
      <button type="button" class="secondary" onclick={() => navigation.go(ROUTES.SETUP)}>
        {m.newmod_go_setup()}
      </button>
    </div>
  {/if}

  {#if form.errorCode}
    <p class="banner error" role="alert">
      {#if form.errorCode === "create-failed"}
        {m.newmod_error_create({ detail: form.errorDetail ?? "" })}
      {:else}
        {pick(ERROR_MESSAGES, form.errorCode)?.()}
      {/if}
    </p>
  {/if}

  {#if form.completedWithWarnings}
    <div class="banner warn" role="alert">
      <p>{m.newmod_created_warnings()}</p>
      <ul>
        {#each form.warnings as warning, i (i)}
          <li>
            {#if warning.kind === "scaffold"}
              {m.newmod_warning_scaffold({ branch: warning.ref, detail: warning.detail })}
            {:else if warning.kind === "campaign-skipped"}
              {m.newmod_warning_campaign_skipped({ campaign: warning.ref })}
            {:else}
              {m.newmod_warning_campaign({ campaign: warning.ref, detail: warning.detail })}
            {/if}
          </li>
        {/each}
      </ul>
      <button type="button" class="primary" onclick={() => form.finish()}>{m.newmod_done()}</button>
    </div>
  {/if}

  <form class="form" onsubmit={(e) => e.preventDefault()}>
    <label class="field">
      <span>{m.newmod_field_name()}</span>
      <input
        type="text"
        bind:value={form.name}
        onblur={() => { form.validateField("name"); form.checkId(); }}
        placeholder={m.newmod_name_placeholder()}
        disabled={form.busy}
      />
      {#if fieldError("name")}
        <small class="hint error-text">{fieldError("name")}</small>
      {/if}
    </label>
    <label class="field">
      <span>{m.newmod_field_id()}</span>
      <input type="text" value={form.id} readonly />
      <small class="hint">{m.newmod_id_hint()}</small>
      {#if form.idStatus?.status === "claimed"}
        <small class="hint warn-text">
          {m.newmod_id_claimed({ author: form.idStatus.entry?.author ?? "" })}
        </small>
      {/if}
    </label>

    <label class="field">
      <span>{m.newmod_field_type()}</span>
      <select value={form.type} onchange={(e) => form.setType(e.currentTarget.value)} disabled={form.busy}>
        {#each MOD_TYPES as type (type.id)}
          <option value={type.id}>
            {typeName(type.id)} &mdash; {typeDesc(type.id)}
          </option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>{m.newmod_field_author()}</span>
      <input type="text" bind:value={form.author} onblur={() => form.validateField("author")} placeholder={m.newmod_author_placeholder()} disabled={form.busy} />
      {#if fieldError("author")}
        <small class="hint error-text">{fieldError("author")}</small>
      {/if}
    </label>
    <label class="field">
      <span>{m.newmod_field_discord()}</span>
      <input type="text" bind:value={form.authorDiscord} placeholder={m.newmod_discord_placeholder()} disabled={form.busy} />
    </label>
    <div class="field">
      <span id="icon-field-label">{m.newmod_field_icon()}</span>
      <EmojiField bind:value={form.icon} disabled={form.busy} labelledby="icon-field-label" />
      {#if fieldError("icon")}
        <small class="hint error-text">{fieldError("icon")}</small>
      {/if}
    </div>
    <label class="field">
      <span>{m.newmod_field_language()}</span>
      <LanguageField bind:value={form.language} disabled={form.busy} />
    </label>
    <label class="field wide">
      <span>{m.newmod_field_description()}</span>
      <textarea rows="2" bind:value={form.description} onblur={() => form.validateField("description")} placeholder={m.newmod_description_placeholder()} disabled={form.busy}></textarea>
      {#if fieldError("description")}
        <small class="hint error-text">{fieldError("description")}</small>
      {/if}
    </label>

    {#if form.showCampaignsField}
      <CheckGroup
        wide
        disabled={form.busy}
        legend={m.newmod_field_campaigns()}
        items={campaignChoices}
        key={(campaign) => campaign.id}
        label={campaignLabel}
        checked={(campaign) => form.campaigns.includes(campaign.id)}
        onToggle={(campaign) => form.toggleCampaign(campaign.id)}
      />
    {/if}

    {#if form.showScaffoldsField}
      <CheckGroup
        wide
        disabled={form.busy}
        legend={m.newmod_field_maps()}
        items={MAP_SCAFFOLDS}
        key={(scaffold) => scaffold.branch}
        label={(scaffold) => scaffold.name}
        checked={(scaffold) => form.selectedMaps.includes(scaffold.branch)}
        onToggle={(scaffold) => form.toggleMap(scaffold.branch)}
      />
      <CheckGroup
        wide
        disabled={form.busy}
        legend={m.newmod_field_sets()}
        items={PATH_SET_SCAFFOLDS}
        key={(scaffold) => scaffold.branch}
        label={(scaffold) => scaffold.name}
        checked={(scaffold) => form.selectedSets.includes(scaffold.branch)}
        onToggle={(scaffold) => form.toggleSet(scaffold.branch)}
      />
    {/if}

    {#if form.showProductsField}
      <CheckGroup
        wide
        disabled={form.busy}
        legend={m.newmod_field_products()}
        items={OFFICIAL_PRODUCTS}
        key={(product) => product.id}
        label={(product) => product.name}
        checked={(product) => form.requiredProducts.includes(product.id)}
        onToggle={(product) => form.toggleProduct(product.id)}
      />
    {/if}

    <MidCampaignSafety
      wide
      type={form.type}
      bind:safe={form.safeToAddMidCampaign}
      bind:notes={form.midCampaignNotes}
      disabled={form.busy}
    />

    <div class="field wide location">
      <span>{m.newmod_field_location()}</span>
      <div class="location-row">
        <button type="button" class="secondary" onclick={() => form.pickFolder()} disabled={form.busy}>
          {m.newmod_pick_folder()}
        </button>
        <code class="location-path">{form.parentDir ?? m.newmod_location_none()}</code>
      </div>
      {#if form.parentDir && form.id}
        <small class="hint">{m.newmod_location_hint({ folder: form.id })}</small>
      {/if}
    </div>

    {#if form.busy}
      <p class="progress" aria-live="polite">{form.progress ?? m.newmod_creating()}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="ghost" onclick={() => navigation.go(ROUTES.MY_MODS)} disabled={form.busy}>
        {m.newmod_cancel()}
      </button>
      <button
        type="submit"
        class="primary"
        onclick={() => form.create()}
        disabled={form.busy || !setupStore.completed}
      >
        {form.busy ? m.newmod_creating() : m.newmod_create()}
      </button>
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

  .banner ul {
    margin: 0;
    padding-left: var(--spacing-lg);
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

  .warn-text {
    color: var(--color-warning, var(--color-error));
  }

  .error-text {
    color: var(--color-error);
  }

  .location-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .location-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }

  .progress {
    grid-column: 1 / -1;
    margin: 0;
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
