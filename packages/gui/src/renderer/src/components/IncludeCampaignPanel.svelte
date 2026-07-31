<script lang="ts">
  /**
   * Include-campaign screen of the "Add content" launcher: pick an official
   * campaign, preview whether merging it would conflict, then include it.
   * Driven by the launcher's campaign sub-flow. A conflicting include routes
   * to the Conflict page.
   */
  import { addContentFlow } from "../lib/addcontent.svelte.js";
  import { OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "core";
  import Spinner from "./Spinner.svelte";
  import { pick } from "../lib/pick.js";
  import * as m from "../lib/paraglide/messages.js";

  const flow = addContentFlow;
  const campaign = flow.campaign;

  const ERROR_MESSAGES = {
    "campaign-not-found": m.addcontent_error_campaign_not_found,
    "no-base": m.addcontent_error_no_base,
    "not-a-repo": m.addcontent_error_not_a_repo,
    "dirty-tree": m.addcontent_error_dirty_tree,
    "index-not-clean": m.addcontent_error_index_not_clean,
    invalid: m.addcontent_error_invalid,
  };

  /** Display name for a campaign id, falling back to the id. */
  function campaignName(id: string | null): string {
    if (!id) return "";
    return OFFICIAL_CAMPAIGNS.find((c) => c.id === id)?.name ?? id;
  }

  /** Readable list of product display names, falling back to raw ids. */
  function productNames(ids: string[]): string {
    return ids.map((id) => OFFICIAL_PRODUCTS.find((p) => p.id === id)?.name ?? id).join(", ");
  }

  // Including is only meaningful once the preview has loaded and there is
  // actually something to merge.
  const canInclude = $derived(
    !campaign.busy && !campaign.previewing && campaign.preview !== null && !campaign.preview.alreadyUpToDate,
  );
</script>

{#if campaign.report}
  <p class="body">
    {campaign.report.alreadyUpToDate
      ? m.addcontent_include_report_uptodate({ campaign: campaignName(campaign.report.campaignId) })
      : m.addcontent_include_report_done({ campaign: campaignName(campaign.report.campaignId) })}
  </p>
  <div class="actions">
    <button type="button" class="primary" onclick={() => flow.cancel()}>{m.addcontent_done()}</button>
  </div>
{:else}
  <p class="body">{m.addcontent_pick_campaign_lead()}</p>
  <label class="field">
    <span>{m.addcontent_pick_campaign_label()}</span>
    <select
      value={campaign.campaignSource}
      onchange={(e) => campaign.selectCampaign(e.currentTarget.value)}
      disabled={campaign.busy}
    >
      {#each OFFICIAL_CAMPAIGNS as option}
        <option value={option.id}>
          {option.oneDayMission
            ? m.addcontent_campaign_oneday_option({ name: option.name })
            : option.name}
        </option>
      {/each}
    </select>
  </label>

  {#if campaign.previewing}
    <div class="preview-loading"><Spinner label={m.addcontent_campaign_checking()} /></div>
  {:else if campaign.preview}
    {#if campaign.preview.alreadyUpToDate}
      <p class="body">{m.addcontent_campaign_up_to_date()}</p>
    {:else if campaign.preview.conflicts.length > 0}
      <p class="body warn">{m.addcontent_campaign_conflicts({ count: campaign.preview.conflicts.length })}</p>
      <ul class="file-list">
        {#each campaign.preview.conflicts as path}
          <li>{path}</li>
        {/each}
      </ul>
    {:else}
      <p class="body">{m.addcontent_campaign_clean()}</p>
    {/if}

    {#if !campaign.preview.alreadyUpToDate && campaign.missingProducts.length > 0}
      <fieldset class="product" disabled={campaign.busy}>
        <legend>{m.addcontent_product_legend({ product: productNames(campaign.missingProducts) })}</legend>
        <label class="radio">
          <input type="radio" value="required" bind:group={campaign.productChoice} />
          <span>{m.addcontent_product_required()}</span>
        </label>
        <label class="radio">
          <input type="radio" value="optional" bind:group={campaign.productChoice} />
          <span>{m.addcontent_product_optional()}</span>
        </label>
        <label class="radio">
          <input type="radio" value="skip" bind:group={campaign.productChoice} />
          <span>{m.addcontent_product_skip()}</span>
        </label>
      </fieldset>
    {/if}
  {/if}

  {#if campaign.errorCode}
    <p class="error-text" role="alert">
      {pick(ERROR_MESSAGES, campaign.errorCode)?.() ?? m.addcontent_error_include_failed()}
    </p>
  {/if}

  <div class="actions">
    {#if !campaign.busy}
      <button type="button" class="ghost" onclick={() => flow.back()}>
        {m.addcontent_back()}
      </button>
    {/if}
    <button type="button" class="primary" onclick={() => campaign.include()} disabled={!canInclude}>
      {campaign.busy ? m.addcontent_including() : m.addcontent_include_confirm()}
    </button>
  </div>
{/if}

<style>
  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .body.warn {
    color: var(--color-text);
    font-weight: 600;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .product {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    margin: 0;
    padding: 0;
    border: none;
  }

  .product legend {
    padding: 0;
    margin-bottom: var(--spacing-xs);
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .radio {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .field span {
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .file-list {
    margin: 0;
    padding-left: var(--spacing-lg);
    max-height: 10rem;
    overflow-y: auto;
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .preview-loading {
    padding: var(--spacing-xs) 0;
  }

  .error-text {
    color: var(--color-error);
    margin: 0;
    font-size: 0.875rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }
</style>
