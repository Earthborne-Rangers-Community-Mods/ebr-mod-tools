<script lang="ts">
  /**
   * Conflict Resolution page: a simple per-file merge resolver for a merge
   * that stopped on conflicts. For each file the user keeps their version or
   * takes the incoming one, then finishes the merge. A one-click "Undo this
   * merge" aborts it entirely. Intentionally not a full mergetool.
   */
  import { conflictFlow } from "../lib/conflict.svelte.js";
  import BackButton from "../components/BackButton.svelte";
  import Modal from "../components/Modal.svelte";
  import { advancedMode } from "../lib/advancedmode.svelte.js";
  import { openTerminal } from "../lib/platform.js";
  import * as m from "../lib/paraglide/messages.js";

  const flow = conflictFlow;
</script>

<section class="page">
  <BackButton />

  {#if !flow.dir}
    <h1>{m.conflict_title()}</h1>
    <p class="lead">{m.conflict_none()}</p>
  {:else}
    <div class="heading">
      <h1>{m.conflict_title()}</h1>
      <button type="button" class="help" onclick={() => flow.openExplainer()}>
        {m.conflict_help()}
      </button>
    </div>

    {#if flow.errorCode === "status-failed"}
      <p class="lead error-text" role="alert">{m.conflict_status_failed()}</p>
    {:else if flow.files.length === 0}
      <p class="lead">{m.conflict_all_resolved()}</p>
    {:else}
      <p class="lead">{m.conflict_lead()}</p>

      <ul class="conflict-list">
        {#each flow.files as file (file.path)}
          <li class="conflict">
            <p class="path">{file.path}</p>
            <div class="choices">
              <label class="choice radio">
                <input
                  type="radio"
                  name={file.path}
                  checked={file.choice === "ours"}
                  disabled={flow.busy}
                  onchange={() => flow.setChoice(file.path, "ours")}
                />
                {m.conflict_keep_mine()}
              </label>
              <label class="choice radio">
                <input
                  type="radio"
                  name={file.path}
                  checked={file.choice === "theirs"}
                  disabled={flow.busy}
                  onchange={() => flow.setChoice(file.path, "theirs")}
                />
                {m.conflict_use_incoming()}
              </label>
            </div>
            {#if file.choice}
              {@const content = file.preview[file.choice]}
              {#if content === undefined}
                <p class="preview-note">{m.conflict_preview_loading()}</p>
              {:else if content === null}
                <p class="preview-note">{m.conflict_preview_unavailable()}</p>
              {:else}
                <textarea class="preview" readonly aria-label={m.conflict_preview_label()} value={content}
                ></textarea>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if flow.errorCode === "unresolved"}
      <p class="error-text" role="alert">{m.conflict_error_unresolved()}</p>
    {:else if flow.errorCode === "finish-failed"}
      <p class="error-text" role="alert">{m.conflict_error_finish()}</p>
    {:else if flow.errorCode === "undo-failed"}
      <p class="error-text" role="alert">{m.conflict_error_undo()}</p>
    {/if}

    <div class="footer">
      <button type="button" class="danger" onclick={() => flow.undo()} disabled={flow.busy}>
        {m.conflict_undo()}
      </button>
      <div class="footer-right">
        {#if advancedMode.enabled}
          <button type="button" class="ghost" onclick={() => openTerminal(flow.dir ?? "")}>
            {m.conflict_open_terminal()}
          </button>
        {/if}
        <button type="button" class="primary" onclick={() => flow.finish()} disabled={flow.busy}>
          {flow.busy ? m.conflict_finishing() : m.conflict_finish()}
        </button>
      </div>
    </div>
  {/if}
</section>

{#if flow.showExplainer}
  <Modal onCancel={() => flow.dismissExplainer()} labelledby="merge-explainer-title">
    <p id="merge-explainer-title" class="title">{m.conflict_explainer_title()}</p>
    <p class="body">{m.conflict_explainer_body_1()}</p>
    <p class="body">{m.conflict_explainer_body_2()}</p>
    <div class="explainer-actions">
      <button type="button" class="primary" onclick={() => flow.dismissExplainer()}>
        {m.conflict_explainer_dismiss()}
      </button>
    </div>
  </Modal>
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-md);
  }

  .help {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0;
  }

  .help:hover {
    text-decoration: underline;
  }

  .lead {
    color: var(--color-text-muted);
  }

  .conflict-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .conflict {
    padding: var(--spacing-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .path {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    word-break: break-all;
    margin: 0;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing-md);
  }

  .choice {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-size: 0.9rem;
  }

  .preview {
    width: 100%;
    min-height: 6rem;
    max-height: 20rem;
    resize: vertical;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    line-height: 1.5;
    white-space: pre;
    overflow: auto;
    color: var(--color-text-muted);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: var(--spacing-sm);
  }

  .preview-note {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--color-border);
    padding-top: var(--spacing-md);
  }

  .footer-right {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .title {
    margin: 0;
    font-weight: 700;
    font-size: var(--font-size-md);
  }

  .body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .explainer-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }
</style>

