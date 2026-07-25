<script lang="ts">
  /**
   * Shared save control: shows a mod's dirty state and, when dirty, a button
   * that opens the save to GitHub flow.
   */
  import { gitStatus, isDirty } from "../lib/gitstatus.svelte.js";
  import { saveFlow } from "../lib/save.svelte.js";
  import { openMods } from "../lib/mods.svelte.js";
  import { untrack } from "svelte";
  import * as m from "../lib/paraglide/messages.js";
  import uploadIcon from "../assets/icons/upload.svg";
  import Spinner from "./Spinner.svelte";

  interface Props {
    /** Absolute path to the mod directory this control acts on. */
    dir: string;
  }
  let { dir }: Props = $props();

  // Refresh whenever the directory this control shows changes (mount or reuse).
  // `refresh` mutates the cached status; `untrack` keeps this effect depending on
  // `dir` alone, so its own writes cannot re-trigger it.
  $effect(() => {
    const d = dir;
    untrack(() => gitStatus.refresh(d));
  });

  const status = $derived(gitStatus.get(dir));
  const dirty = $derived(isDirty(status));
  const busyHere = $derived(saveFlow.busy && saveFlow.dir === dir);

  function onSave() {
    if (!status) return;
    const mode = status.hasUncommitted ? "commit" : "push";
    const currentVersion = openMods.getByDir(dir)?.manifest?.version ?? "0.0.0";
    saveFlow.start(dir, { currentVersion, mode });
  }
</script>

{#if status?.checking}
  <div class="save-control">
    <Spinner label={m.save_checking()} />
  </div>
{:else if dirty}
  <div class="save-control">
    <button
      type="button"
      class="primary save-button"
      onclick={onSave}
      disabled={busyHere}
      aria-label={busyHere ? m.save_saving() : m.save_action()}
      title={busyHere ? m.save_saving() : m.save_action()}
    >
      <span class="save-icon" style={`--save-mask: url("${uploadIcon}")`} aria-hidden="true"></span>
    </button>
  </div>
{/if}

<style>
  .save-control {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .save-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    flex-shrink: 0;
  }

  .save-icon {
    display: block;
    width: 1.15rem;
    height: 1.15rem;
    flex-shrink: 0;
    background-color: currentColor;
    mask-image: var(--save-mask);
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
    -webkit-mask-image: var(--save-mask);
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
  }
</style>
