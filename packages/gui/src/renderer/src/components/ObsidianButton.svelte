<script lang="ts">
  /**
   * Icon button that opens a mod's folder as a vault in Obsidian. If Obsidian
   * hasn't registered this folder as a vault yet (no `.obsidian/workspace.json`),
   * shows a small dialog guiding the creator through registering it.
   */
  import { existsSync } from "node:fs";
  import { join } from "node:path";
  import { openInObsidian, openExternal } from "../lib/platform.js";
  import { helpDialog } from "../lib/helpdialog.svelte.js";
  import Modal from "./Modal.svelte";
  import ObsidianDownloadButton from "./ObsidianDownloadButton.svelte";
  import * as m from "../lib/paraglide/messages.js";
  import obsidianLogo from "../assets/icons/obsidian-logo.svg";

  interface Props {
    /** Absolute path to the mod directory to open. */
    dir: string;
  }
  let { dir }: Props = $props();

  let showUnregistered = $state(false);

  function isVaultRegistered(): boolean {
    try {
      return existsSync(join(dir, ".obsidian", "workspace.json"));
    } catch {
      return false;
    }
  }

  function handleClick() {
    if (isVaultRegistered()) {
      openInObsidian(dir);
    } else {
      showUnregistered = true;
    }
  }

  function launchChooseVault() {
    showUnregistered = false;
    openExternal("obsidian://choose-vault");
  }

  function learnMore() {
    showUnregistered = false;
    helpDialog.open();
  }
</script>

<button
  type="button"
  class="icon-button secondary"
  onclick={handleClick}
  aria-label={m.obsidian_open_label()}
  title={m.obsidian_open_label()}
>
  <img src={obsidianLogo} alt="" class="obsidian-logo" aria-hidden="true" />
</button>

{#if showUnregistered}
  <Modal onCancel={() => (showUnregistered = false)} labelledby="unregistered-vault-title">
    <p id="unregistered-vault-title" class="unregistered-title">{m.obsidian_unregistered_title()}</p>
    <p class="unregistered-body">{m.obsidian_unregistered_body({ open_command: m.obsidian_unregistered_choose_vault(), dir })}</p>
    <div class="unregistered-actions">
      <button type="button" class="ghost" onclick={() => (showUnregistered = false)}>
        {m.obsidian_unregistered_cancel()}
      </button>
      <ObsidianDownloadButton />
      <button type="button" class="primary" onclick={launchChooseVault}>
        {m.obsidian_unregistered_choose_vault()}
      </button>
    </div>
  </Modal>
{/if}

<style>
  .obsidian-logo {
    width: 1.25rem;
    height: 1.25rem;
    display: block;
  }

  .unregistered-title {
    margin: 0;
    font-weight: 700;
    font-size: var(--font-size-md);
  }

  .unregistered-body {
    margin: 0;
    color: var(--color-text-muted);
  }

  .unregistered-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--spacing-xs);
    margin-top: var(--spacing-xs);
  }
</style>

