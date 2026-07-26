<script lang="ts">
  /**
   * Modal for the publish flow (`ebr publish` equivalent), driven by the shared
   * `publishFlow` store and mounted once in the app shell. It confirms the
   * submission, runs the publish, and then shows the result with a link to the
   * open pull request (or a fallback link to create it on GitHub).
   */
  import { publishFlow } from "../lib/publish.svelte.js";
  import { publishStatus } from "../lib/publishstatus.svelte.js";
  import { openExternal } from "../lib/platform.js";
  import { pick } from "../lib/pick.js";
  import Modal from "./Modal.svelte";
  import * as m from "../lib/paraglide/messages.js";

  // On the result screen, show every open PR for this mod (the one the publish
  // just opened, plus any others surfaced by the post-publish lookup - usually
  // none). A label carries the PR number only when there is more than one.
  const prs = $derived(publishFlow.dir ? publishStatus.get(publishFlow.dir)?.prs ?? [] : []);

  /** Error code -> message builder. Unmapped codes fall back to the generic message. */
  const ERROR_MESSAGES: Record<string, (detail: string) => string> = {
    "setup-required": () => m.publish_error_setup_required(),
    "unsaved-changes": () => m.publish_error_unsaved(),
    "id-conflict": () => m.publish_error_id_conflict(),
    "version-not-higher": () => m.publish_error_version(),
    "auth-failed": () => m.publish_error_auth(),
    "invalid-manifest": (detail) => m.publish_error_invalid({ detail }),
  };

  function errorText(): string {
    const detail = publishFlow.errorDetail ?? "";
    const build = pick(ERROR_MESSAGES, publishFlow.errorCode ?? "");
    return build ? build(detail) : m.publish_error_failed({ detail });
  }
</script>

<Modal onCancel={() => publishFlow.cancel()} labelledby="publish-title">
  <p id="publish-title" class="title">{m.publish_dialog_title()}</p>

  {#if publishFlow.done}
    {#if publishFlow.identityWarning}
      <div class="warnings identity-warning">
        <p class="warnings-title">{m.publish_identity_title()}</p>
        <p class="identity-body">{m.publish_identity_body({ email: publishFlow.identityWarning.email, login: publishFlow.identityWarning.login })}</p>
      </div>
    {/if}
    {#if publishFlow.warnings.length > 0}
      <div class="warnings">
        <p class="warnings-title">{m.publish_warnings_title()}</p>
        <ul>
          {#each publishFlow.warnings as warning}
            <li>{warning}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if prs.length > 0}
      <p class="body">{m.publish_done_pr_open()}</p>
      {#each prs as pr}
        <button type="button" class="link" onclick={() => openExternal(pr.url)}>
          {prs.length > 1 && pr.number != null ? m.publish_view_pr_numbered({ number: pr.number }) : m.publish_view_pr()}
        </button>
      {/each}
    {:else if publishFlow.result?.prAlreadyExists}
      <p class="body">{m.publish_done_pr_exists()}</p>
    {:else if publishFlow.result}
      <p class="body">{m.publish_done_pr_fallback()}</p>
      <button type="button" class="link" onclick={() => openExternal(publishFlow.result?.compareUrl ?? "")}>
        {m.publish_open_compare()}
      </button>
    {/if}

    <p class="note">{m.publish_done_review_note()}</p>

    <div class="actions">
      <button type="button" class="primary" onclick={() => publishFlow.cancel()}>
        {m.publish_done_close()}
      </button>
    </div>
  {:else}
    <p class="body">{m.publish_confirm_body({ version: publishFlow.publishVersion })}</p>

    {#if publishFlow.needsBump}
      <label class="bump-offer check">
        <input type="checkbox" bind:checked={publishFlow.bumpToStable} disabled={publishFlow.busy} />
        <span>{m.publish_bump_offer({ version: publishFlow.currentVersion })}</span>
      </label>
    {/if}

    {#if publishFlow.busy && publishFlow.progress}
      <p class="progress" aria-live="polite">{publishFlow.progress}</p>
    {/if}
    {#if publishFlow.errorCode}
      <p class="error-text" role="alert">{errorText()}</p>
    {/if}

    <div class="actions">
      <button type="button" class="ghost" onclick={() => publishFlow.cancel()} disabled={publishFlow.busy}>
        {m.publish_cancel()}
      </button>
      {#if publishFlow.errorCode === "unsaved-changes"}
        <button type="button" class="primary" onclick={() => publishFlow.saveFirst()} disabled={publishFlow.busy}>
          {m.publish_save_first()}
        </button>
      {:else if publishFlow.errorCode === "auth-failed" || publishFlow.errorCode === "setup-required"}
        <button type="button" class="primary" onclick={() => publishFlow.goToSetup()} disabled={publishFlow.busy}>
          {m.publish_go_to_setup()}
        </button>
      {:else}
        <button type="button" class="primary" onclick={() => publishFlow.submit()} disabled={publishFlow.busy}>
          {publishFlow.busy ? m.publish_publishing() : m.publish_action()}
        </button>
      {/if}
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
    color: var(--color-text);
  }

  .bump-offer {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .note {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .progress {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .warnings {
    margin: 0;
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-alt, var(--color-surface));
  }

  .warnings-title {
    margin: 0 0 var(--spacing-xs);
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .warnings ul {
    margin: 0;
    padding-left: var(--spacing-lg);
    font-size: 0.875rem;
  }

  .identity-warning {
    border-color: var(--color-warning, var(--color-border));
  }

  .identity-body {
    margin: 0;
    font-size: 0.875rem;
  }

  .link {
    /* Layout only; visual style comes from the global .link utility. */
    align-self: flex-start;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }
</style>
