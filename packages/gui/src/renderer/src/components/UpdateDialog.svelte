<script lang="ts">
  /**
   * Modal for the update flow: walks the mod's available updates one at a time,
   * offering accept or skip for each, then summarizes what landed. A conflicting
   * merge leaves for the Conflict Resolution page.
   */
  import { updateFlow } from "../lib/update.svelte.js";
  import type { UpdateItem } from "../lib/updatequeue.js";
  import { OFFICIAL_CAMPAIGNS } from "core";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";
  import { pick } from "../lib/pick.js";
  import * as m from "../lib/paraglide/messages.js";

  const flow = updateFlow;

  const ERROR_MESSAGES = {
    "dirty-tree": m.update_error_dirty_tree,
    "index-not-clean": m.update_error_index_not_clean,
    "no-base": m.update_error_no_base,
    "ref-not-found": m.update_error_ref_not_found,
    "mod-not-found": m.update_error_mod_not_found,
    "registry-unreachable": m.update_error_registry_unreachable,
    "not-a-repo": m.update_error_not_a_repo,
  };

  /** What to call an update in the heading and the summary. */
  function itemName(item: UpdateItem): string {
    if (item.kind === "base") return m.update_base_name();
    if (item.kind === "campaign") {
      return OFFICIAL_CAMPAIGNS.find((c) => c.id === item.id)?.name ?? item.id;
    }
    return item.name;
  }

  /** One line explaining what the update brings in. */
  function itemDescription(item: UpdateItem): string {
    if (item.kind === "base") return m.update_base_desc();
    if (item.kind === "campaign") return m.update_campaign_desc();
    return item.toVersion
      ? m.update_mod_desc({ from: item.fromVersion, to: item.toVersion })
      : m.update_mod_desc_unknown({ from: item.fromVersion });
  }

  const current = $derived(flow.current);
</script>

<Modal onCancel={() => flow.close()} labelledby="update-title">
  <p id="update-title" class="title">{m.update_title()}</p>

  {#if flow.statusPending}
    <div class="loading"><Spinner label={m.update_checking()} /></div>
  {:else if flow.needsSave}
    <p class="body">{m.update_save_first_notice()}</p>
    <div class="actions">
      <button type="button" class="ghost" onclick={() => flow.close()}>{m.update_cancel()}</button>
      <button type="button" class="primary" onclick={() => flow.saveFirst()}>{m.update_save_first_action()}</button>
    </div>
  {:else if current}
    <p class="step">{m.update_step({ position: flow.index + 1, total: flow.items.length })}</p>
    <p class="item-name">{itemName(current)}</p>
    <p class="body">{itemDescription(current)}</p>

    {#if flow.errorCode}
      <p class="error-text" role="alert">
        {pick(ERROR_MESSAGES, flow.errorCode)?.() ?? m.update_error_failed()}
      </p>
    {/if}

    <div class="actions">
      {#if !flow.busy}
        <button type="button" class="ghost" onclick={() => flow.close()}>{m.update_cancel()}</button>
        <button type="button" class="secondary" onclick={() => flow.skip()}>{m.update_skip()}</button>
      {/if}
      <button type="button" class="primary" onclick={() => flow.accept()} disabled={flow.busy}>
        {flow.busy ? m.update_updating() : m.update_confirm()}
      </button>
    </div>
  {:else}
    <p class="body">{m.update_report_lead()}</p>
    {#if flow.results.length === 0}
      <p class="body">{m.update_report_none()}</p>
    {:else}
      <ul class="summary">
        {#each flow.results as result}
          <li>
            {#if result.outcome === "updated"}
              {m.update_report_updated({ name: itemName(result.item) })}
            {:else if result.outcome === "already-up-to-date"}
              {m.update_report_uptodate({ name: itemName(result.item) })}
            {:else}
              {m.update_report_skipped({ name: itemName(result.item) })}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if flow.incomplete}
      <p class="body">{m.update_incomplete_notice()}</p>
    {/if}
    <div class="actions">
      <button type="button" class="primary" onclick={() => flow.close()}>{m.update_done()}</button>
    </div>
  {/if}
</Modal>

<style>
  .title {
    margin: 0;
    font-weight: 700;
    font-size: var(--font-size-md);
  }

  .step {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .item-name {
    margin: 0;
    font-weight: 600;
  }

  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .summary {
    margin: 0;
    padding-left: var(--spacing-lg);
    max-height: 12rem;
    overflow-y: auto;
    color: var(--color-text-muted);
  }

  .loading {
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
