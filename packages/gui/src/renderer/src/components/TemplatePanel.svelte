<script lang="ts">
  /**
   * Template (scaffold) screen of the "Add content" launcher: pick a template,
   * preview the changelist, optionally add its implied product, then stamp.
   * Driven by the launcher's template sub-flow.
   */
  import { addContentFlow } from "../lib/addcontent.svelte.js";
  import { KNOWN_SCAFFOLDS, OFFICIAL_PRODUCTS } from "core";
  import Spinner from "./Spinner.svelte";
  import { pick } from "../lib/pick.js";
  import * as m from "../lib/paraglide/messages.js";

  const flow = addContentFlow;
  const template = flow.template;

  const ERROR_MESSAGES = {
    "nothing-to-add": m.addcontent_error_nothing,
    "not-found": m.addcontent_error_not_found,
    "not-a-repo": m.addcontent_error_not_a_repo,
    invalid: m.addcontent_error_invalid,
  };

  /** Display name for a product id, falling back to the id. */
  function productName(id: string | null): string {
    if (!id) return "";
    return OFFICIAL_PRODUCTS.find((p) => p.id === id)?.name ?? id;
  }

  const canStamp = $derived(
    !template.busy && !template.previewing && template.preview !== null && template.preview.filesToAdd.length > 0,
  );
</script>

{#if template.report}
  <p class="body">{m.addcontent_report_added({ count: template.report.filesAdded })}</p>
  {#if template.report.productAdded}
    <p class="body">
      {template.report.productList === "optional"
        ? m.addcontent_report_product_optional({ product: productName(template.report.productAdded) })
        : m.addcontent_report_product_required({ product: productName(template.report.productAdded) })}
    </p>
  {/if}
  {#if template.report.filesSkipped.length > 0}
    <p class="body">{m.addcontent_report_skipped({ count: template.report.filesSkipped.length })}</p>
    <ul class="file-list">
      {#each template.report.filesSkipped as path}
        <li>{path}</li>
      {/each}
    </ul>
  {/if}
  <div class="actions">
    <button type="button" class="primary" onclick={() => flow.cancel()}>{m.addcontent_done()}</button>
  </div>
{:else}
  <p class="body">{m.addcontent_pick_template_lead()}</p>
  <label class="field">
    <span>{m.addcontent_pick_label()}</span>
    <select
      value={template.scaffoldBranch}
      onchange={(e) => template.selectScaffold(e.currentTarget.value)}
      disabled={template.busy}
    >
      {#each KNOWN_SCAFFOLDS as scaffold}
        <option value={scaffold.branch}>{scaffold.name}</option>
      {/each}
    </select>
  </label>

  {#if template.previewing}
    <div class="preview-loading"><Spinner label={m.addcontent_checking()} /></div>
  {:else if template.preview}
    {#if template.preview.filesToAdd.length > 0}
      <p class="body">{m.addcontent_preview_add({ count: template.preview.filesToAdd.length })}</p>
      <ul class="file-list">
        {#each template.preview.filesToAdd as path}
          <li>{path}</li>
        {/each}
      </ul>
    {:else}
      <p class="body">{m.addcontent_preview_none()}</p>
    {/if}
    {#if template.preview.filesToSkip.length > 0}
      <p class="body">{m.addcontent_preview_skip({ count: template.preview.filesToSkip.length })}</p>
      <ul class="file-list">
        {#each template.preview.filesToSkip as path}
          <li>{path}</li>
        {/each}
      </ul>
    {/if}
    {#if template.missingProduct}
      <fieldset class="product" disabled={template.busy}>
        <legend>{m.addcontent_product_legend({ product: productName(template.missingProduct) })}</legend>
        <label class="radio">
          <input type="radio" value="required" bind:group={template.productChoice} />
          <span>{m.addcontent_product_required()}</span>
        </label>
        <label class="radio">
          <input type="radio" value="optional" bind:group={template.productChoice} />
          <span>{m.addcontent_product_optional()}</span>
        </label>
        <label class="radio">
          <input type="radio" value="skip" bind:group={template.productChoice} />
          <span>{m.addcontent_product_skip()}</span>
        </label>
      </fieldset>
    {/if}
  {/if}

  {#if template.busy && template.progress}
    <p class="progress" aria-live="polite">{template.progress}</p>
  {/if}
  {#if template.errorCode}
    <p class="error-text" role="alert">
      {pick(ERROR_MESSAGES, template.errorCode)?.() ??
        m.addcontent_error_failed({ detail: template.errorDetail ?? "" })}
    </p>
  {/if}

  <div class="actions">
    {#if !template.busy}
      <button type="button" class="ghost" onclick={() => flow.back()}>
        {m.addcontent_back()}
      </button>
    {/if}
    <button type="button" class="primary" onclick={() => template.stamp()} disabled={!canStamp}>
      {template.busy ? m.addcontent_stamping() : m.addcontent_confirm()}
    </button>
  </div>
{/if}

<style>
  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .field span {
    font-size: 0.875rem;
    color: var(--color-text-muted);
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

  .progress {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
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
