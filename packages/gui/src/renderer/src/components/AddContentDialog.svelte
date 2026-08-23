<script lang="ts">
  /**
   * Modal for the "Add content" launcher. This shell owns the chooser and the
   * save-first gate; each content kind's screens live in their own panel
   * component.
   */
  import { addContentFlow } from "../lib/addcontent.svelte.js";
  import { addContentKinds } from "../lib/addcontent.js";
  import { advancedMode } from "../lib/advancedmode.svelte.js";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";
  import TemplatePanel from "./TemplatePanel.svelte";
  import IncludeCampaignPanel from "./IncludeCampaignPanel.svelte";
  import IncludeModPanel from "./IncludeModPanel.svelte";
  import * as m from "../lib/paraglide/messages.js";

  const flow = addContentFlow;
  const kinds = $derived(addContentKinds(flow.modType, advancedMode.enabled));
</script>

<Modal onCancel={() => flow.cancel()} title={m.addcontent_title()} labelledby="addcontent-title">

  {#if flow.kind === null}
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
          {:else if kind === "include-campaign"}
            <button type="button" class="option" onclick={() => flow.chooseKind("include-campaign")}>
              <span class="option-name">{m.addcontent_campaign_name()}</span>
              <span class="option-desc">{m.addcontent_campaign_desc()}</span>
            </button>
          {:else if kind === "include-mod"}
            <button type="button" class="option" onclick={() => flow.chooseKind("include-mod")}>
              <span class="option-name">{m.addcontent_mod_name()}</span>
              <span class="option-desc">{m.addcontent_mod_desc()}</span>
            </button>
          {/if}
        {/each}
      </div>
      <div class="actions">
        <button type="button" class="ghost" onclick={() => flow.cancel()}>{m.addcontent_cancel()}</button>
      </div>
    {/if}
  {:else if flow.kind === "include-campaign"}
    <IncludeCampaignPanel />
  {:else if flow.kind === "include-mod"}
    <IncludeModPanel />
  {:else}
    <TemplatePanel />
  {/if}
</Modal>

<style>
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
    font-weight: var(--font-weight-medium);
  }

  .option-desc {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .preview-loading {
    padding: var(--spacing-xs) 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }
</style>
