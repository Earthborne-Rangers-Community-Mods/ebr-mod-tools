<script lang="ts">
  /**
   * Modal for opening a mod, driven by the shared `openModFlow` store. The
   * initial screen offers "From this machine" (pick an existing local folder,
   * the pre-existing behavior) or "From my GitHub backup" (clone one of the
   * creator's mod branches from their fork). Mounted once in the app shell.
   */
  import { basename } from "node:path";
  import { openModFlow } from "../lib/openmod.svelte.js";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";
  import * as m from "../lib/paraglide/messages.js";

  let diskError = $state<string | null>(null);

  async function fromDisk() {
    diskError = null;
    const result = await openModFlow.openFromDisk();
    if (!result) return;
    if (!result.ok) {
      if (result.reason === "not-found") {
        diskError = m.mymods_error_not_a_mod({ folder: basename(result.dir) });
      } else if (result.reason === "unreadable") {
        diskError = m.mymods_error_unreadable_detail({
          folder: basename(result.dir),
          detail: result.message ?? m.mymods_invalid_manifest_fallback(),
        });
      } else {
        diskError = m.mymods_error_add_failed();
      }
    }
  }

  function fromBackup() {
    diskError = null;
    openModFlow.browseBackup();
  }

  function cancel() {
    diskError = null;
    openModFlow.close();
  }

  function back() {
    diskError = null;
    openModFlow.back();
  }
</script>

<Modal onCancel={cancel} title={m.openmod_dialog_title()} labelledby="openmod-title">

  {#if openModFlow.screen === "choice"}
    {#if openModFlow.errorCode === "setup-required"}
      <p class="error-text" role="alert">{m.openmod_error_setup_required()}</p>
    {/if}
    {#if diskError}
      <p class="error-text" role="alert">{diskError}</p>
    {/if}
    <div class="choice-actions">
      <button type="button" class="secondary" onclick={fromDisk}>
        {m.openmod_from_disk()}
      </button>
      <button type="button" class="secondary" onclick={fromBackup}>
        {m.openmod_from_backup()}
      </button>
    </div>
    <div class="actions">
      <button type="button" class="ghost" onclick={cancel}>{m.mymods_cancel()}</button>
    </div>
  {:else}
    <p class="body">{m.openmod_backup_lead()}</p>

    {#if openModFlow.loadingBranches}
      <p class="loading"><Spinner label={m.openmod_loading_branches()} /> {m.openmod_loading_branches()}</p>
    {:else if openModFlow.errorCode === "list-failed"}
      <p class="error-text" role="alert">{m.openmod_error_list_failed()}</p>
    {:else if openModFlow.branches.length === 0}
      <p class="body">{m.openmod_no_branches()}</p>
    {:else}
      <label class="field">
        <span>{m.openmod_branch_label()}</span>
        <select
          value={openModFlow.selected ?? ""}
          disabled={openModFlow.busy}
          onchange={(e) => openModFlow.select((e.target as HTMLSelectElement).value)}
        >
          <option value="" disabled>{m.openmod_branch_placeholder()}</option>
          {#each openModFlow.branches as modId (modId)}
            <option value={modId}>{modId}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if openModFlow.busy && openModFlow.progress}
      <p class="progress" aria-live="polite">{openModFlow.progress}</p>
    {/if}
    {#if openModFlow.errorCode === "clone-failed"}
      <p class="error-text" role="alert">
        {m.openmod_error_clone_failed({ detail: openModFlow.errorDetail ?? "" })}
      </p>
    {:else if openModFlow.errorCode === "clone-unreadable"}
      <p class="error-text" role="alert">
        {m.openmod_error_clone_unreadable({ detail: openModFlow.errorDetail ?? "" })}
      </p>
    {/if}

    <div class="actions">
      {#if !openModFlow.busy}
        <button type="button" class="ghost" onclick={back}>{m.openmod_back()}</button>
      {/if}
      <button
        type="button"
        class="primary"
        onclick={() => openModFlow.clone()}
        disabled={openModFlow.busy || !openModFlow.selected}
      >
        {openModFlow.busy ? m.openmod_cloning() : m.openmod_clone_button()}
      </button>
    </div>
  {/if}
</Modal>

<style>
  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .choice-actions {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .loading {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    color: var(--color-text-muted);
    margin: 0;
  }

  .progress {
    margin: 0;
    color: var(--color-text-muted);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }
</style>
