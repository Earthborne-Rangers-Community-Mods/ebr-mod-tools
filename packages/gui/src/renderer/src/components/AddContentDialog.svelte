<script lang="ts">
  /**
   * Modal for the "Add content" launcher, driven by the shared `addContentFlow`
   * store and mounted once in the app shell. It walks three screens: a chooser
   * that names the kinds available for the mod's type (gated behind a clean
   * working tree), a template pick screen that previews the changelist for the
   * selected template before committing, and a report screen summarizing the
   * stamp.
   */
  import { addContentFlow } from "../lib/addcontent.svelte.js";
  import { addContentKinds } from "../lib/addcontent.js";
  import { KNOWN_SCAFFOLDS, OFFICIAL_PRODUCTS } from "core";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";
  import * as m from "../lib/paraglide/messages.js";

  const flow = addContentFlow;
  const kinds = $derived(addContentKinds(flow.modType));

  /** Display name for a product id, falling back to the id. */
  function productName(id: string | null): string {
    if (!id) return "";
    return OFFICIAL_PRODUCTS.find((p) => p.id === id)?.name ?? id;
  }

  const canStamp = $derived(
    !flow.busy && !flow.previewing && flow.preview !== null && flow.preview.filesToAdd.length > 0,
  );
</script>

<Modal onCancel={() => flow.cancel()} labelledby="addcontent-title">
  <p id="addcontent-title" class="title">{m.addcontent_title()}</p>

  {#if flow.report}
    <p class="body">{m.addcontent_report_added({ count: flow.report.filesAdded })}</p>
    {#if flow.report.productAdded}
      <p class="body">
        {flow.report.productList === "optional"
          ? m.addcontent_report_product_optional({ product: productName(flow.report.productAdded) })
          : m.addcontent_report_product_required({ product: productName(flow.report.productAdded) })}
      </p>
    {/if}
    {#if flow.report.filesSkipped.length > 0}
      <p class="body">{m.addcontent_report_skipped({ count: flow.report.filesSkipped.length })}</p>
      <ul class="file-list">
        {#each flow.report.filesSkipped as path}
          <li>{path}</li>
        {/each}
      </ul>
    {/if}
    <div class="actions">
      <button type="button" class="primary" onclick={() => flow.cancel()}>{m.addcontent_done()}</button>
    </div>
  {:else if flow.kind === null}
    {#if flow.statusPending}
      <div class="preview-loading"><Spinner label={m.addcontent_checking()} /></div>
    {:else if flow.needsSave}
      <p class="body">{m.addcontent_save_first_notice()}</p>
      <div class="actions">
        <button type="button" class="ghost" onclick={() => flow.cancel()}>{m.addcontent_cancel()}</button>
        <button type="button" class="primary" onclick={() => flow.saveFirst()}>{m.addcontent_save_first_action()}</button>
      </div>
    {:else}
      <p class="body">{m.addcontent_chooser_lead()}</p>
      <div class="options">
        {#each kinds as kind}
          {#if kind === "template"}
            <button type="button" class="option" onclick={() => flow.chooseKind("template")}>
              <span class="option-name">{m.addcontent_template_name()}</span>
              <span class="option-desc">{m.addcontent_template_desc()}</span>
            </button>
          {/if}
        {/each}
      </div>
      <div class="actions">
        <button type="button" class="ghost" onclick={() => flow.cancel()}>{m.addcontent_cancel()}</button>
      </div>
    {/if}
  {:else}
    <p class="body">{m.addcontent_pick_template_lead()}</p>
    <label class="field">
      <span>{m.addcontent_pick_label()}</span>
      <select
        value={flow.scaffoldBranch}
        onchange={(e) => flow.selectScaffold(e.currentTarget.value)}
        disabled={flow.busy}
      >
        {#each KNOWN_SCAFFOLDS as scaffold}
          <option value={scaffold.branch}>{scaffold.name}</option>
        {/each}
      </select>
    </label>

    {#if flow.previewing}
      <div class="preview-loading"><Spinner label={m.addcontent_checking()} /></div>
    {:else if flow.preview}
      {#if flow.preview.filesToAdd.length > 0}
        <p class="body">{m.addcontent_preview_add({ count: flow.preview.filesToAdd.length })}</p>
        <ul class="file-list">
          {#each flow.preview.filesToAdd as path}
            <li>{path}</li>
          {/each}
        </ul>
      {:else}
        <p class="body">{m.addcontent_preview_none()}</p>
      {/if}
      {#if flow.preview.filesToSkip.length > 0}
        <p class="body">{m.addcontent_preview_skip({ count: flow.preview.filesToSkip.length })}</p>
        <ul class="file-list">
          {#each flow.preview.filesToSkip as path}
            <li>{path}</li>
          {/each}
        </ul>
      {/if}
      {#if flow.missingProduct}
        <fieldset class="product" disabled={flow.busy}>
          <legend>{m.addcontent_product_legend({ product: productName(flow.missingProduct) })}</legend>
          <label class="radio">
            <input type="radio" value="required" bind:group={flow.productChoice} />
            <span>{m.addcontent_product_required()}</span>
          </label>
          <label class="radio">
            <input type="radio" value="optional" bind:group={flow.productChoice} />
            <span>{m.addcontent_product_optional()}</span>
          </label>
          <label class="radio">
            <input type="radio" value="skip" bind:group={flow.productChoice} />
            <span>{m.addcontent_product_skip()}</span>
          </label>
        </fieldset>
      {/if}
    {/if}

    {#if flow.busy && flow.progress}
      <p class="progress" aria-live="polite">{flow.progress}</p>
    {/if}
    {#if flow.errorCode}
      <p class="error-text" role="alert">
        {#if flow.errorCode === "nothing-to-add"}
          {m.addcontent_error_nothing()}
        {:else if flow.errorCode === "not-found"}
          {m.addcontent_error_not_found()}
        {:else if flow.errorCode === "not-a-repo"}
          {m.addcontent_error_not_a_repo()}
        {:else if flow.errorCode === "invalid"}
          {m.addcontent_error_invalid()}
        {:else}
          {m.addcontent_error_failed({ detail: flow.errorDetail ?? "" })}
        {/if}
      </p>
    {/if}

    <div class="actions">
      {#if !flow.busy}
        <button type="button" class="ghost" onclick={() => flow.back()}>
          {m.addcontent_back()}
        </button>
      {/if}
      <button type="button" class="primary" onclick={() => flow.stampTemplate()} disabled={!canStamp}>
        {flow.busy ? m.addcontent_stamping() : m.addcontent_confirm()}
      </button>
    </div>
  {/if}
</Modal>

<style>
  .title {
    margin: 0;
    font-weight: 700;
    font-size: var(--font-size-md);
  }

  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .option:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-primary);
  }

  .option-name {
    font-weight: 600;
  }

  .option-desc {
    font-size: 0.875rem;
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
