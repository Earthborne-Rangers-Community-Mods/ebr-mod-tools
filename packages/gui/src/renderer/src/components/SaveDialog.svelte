<script lang="ts">
  /**
   * Modal for the save flow (`ebr save` equivalent), driven by the shared
   * `saveFlow` store and mounted once in the app shell. For uncommitted work it
   * collects a version bump and commit message; for a clean-but-unpushed branch
   * it simply confirms the push.
   */
  import { saveFlow, type BumpType } from "../lib/save.svelte.js";
  import Modal from "./Modal.svelte";
  import * as m from "../lib/paraglide/messages.js";

  const BUMPS: BumpType[] = ["patch", "minor", "major"];

  function bumpLabel(type: BumpType) {
    if (type === "patch") return m.save_bump_patch();
    if (type === "minor") return m.save_bump_minor();
    return m.save_bump_major();
  }
</script>

<Modal onCancel={() => saveFlow.cancel()} labelledby="save-title">
  <p id="save-title" class="title">{m.save_dialog_title()}</p>

  {#if saveFlow.mode === "commit"}
    <fieldset class="bumps" disabled={saveFlow.busy}>
      <legend>{m.save_version_legend({ version: saveFlow.currentVersion })}</legend>
      {#each BUMPS as type}
        <label class="bump radio">
          <input
            type="radio"
            name="bump"
            checked={saveFlow.versionChoice === type}
            onchange={() => saveFlow.setVersionChoice(type)}
          />
          <span>{bumpLabel(type)}</span>
        </label>
      {/each}
      <label class="bump radio">
        <input
          type="radio"
          name="bump"
          checked={saveFlow.versionChoice === "custom"}
          onchange={() => saveFlow.setVersionChoice("custom")}
        />
        <span>{m.save_bump_custom()}</span>
      </label>
    </fieldset>

    {#if saveFlow.versionChoice === "custom"}
      <label class="field">
        <span>{m.save_custom_version_label()}</span>
        <input type="text" bind:value={saveFlow.customVersion} disabled={saveFlow.busy} />
        {#if saveFlow.customVersionInvalid}
          <small class="hint error-text">{m.save_version_invalid()}</small>
        {/if}
      </label>
    {:else}
      <p class="preview">{m.save_version_preview({ version: saveFlow.nextVersion })}</p>
    {/if}

    <label class="field">
      <span>{m.save_message_label()}</span>
      <input
        type="text"
        bind:value={saveFlow.commitMessage}
        disabled={saveFlow.busy}
        placeholder={m.save_message_label()}
      />
    </label>
  {:else}
    <p class="body">{m.save_push_body()}</p>
  {/if}

  {#if saveFlow.identityOverride}
    <div class="warnings identity-warning">
      <p class="warnings-title">{m.identity_override_title()}</p>
      <p class="identity-body">
        {m.identity_override_body({
          name: saveFlow.identityOverride.name,
          email: saveFlow.identityOverride.email,
          localName: saveFlow.identityOverride.localName ?? m.identity_override_unset(),
          localEmail: saveFlow.identityOverride.localEmail ?? m.identity_override_unset(),
        })}
      </p>
    </div>
  {/if}

  {#if saveFlow.busy && saveFlow.progress}
    <p class="progress" aria-live="polite">{saveFlow.progress}</p>
  {/if}
  {#if saveFlow.errorCode}
    <p class="error-text" role="alert">
      {saveFlow.errorCode === "nothing-to-commit"
        ? m.save_error_nothing()
        : m.save_error_failed({ detail: saveFlow.errorDetail ?? "" })}
    </p>
  {/if}

  <div class="actions">
    {#if !saveFlow.busy}
      <button type="button" class="ghost" onclick={() => saveFlow.cancel()}>
        {m.save_cancel()}
      </button>
    {/if}
    <button type="button" class="primary" onclick={() => saveFlow.submit()} disabled={saveFlow.busy}>
      {#if saveFlow.busy}
        {m.save_saving()}
      {:else if saveFlow.mode === "push"}
        {m.save_push_confirm()}
      {:else}
        {m.save_button()}
      {/if}
    </button>
  </div>
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

  .bumps {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-sm) var(--spacing-md);
    margin: 0;
    padding: var(--spacing-sm) 0 0;
    border: none;
  }

  .bumps legend {
    padding: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .bump {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    cursor: pointer;
  }

  .preview {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
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

  .hint {
    font-size: 0.8125rem;
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

  .identity-warning {
    border-color: var(--color-warning, var(--color-border));
  }

  .identity-body {
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
