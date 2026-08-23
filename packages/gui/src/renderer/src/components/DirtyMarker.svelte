<script lang="ts">
  /**
   * Orange asterisk shown after a mod's name when it has work not backed up to
   * GitHub - uncommitted changes or unpushed commits. Hovering explains which.
   * Reads the shared git-status tracker and refreshes it on mount (the tracker
   * dedupes concurrent reads).
   */
  import { gitStatus, isDirty } from "../lib/gitstatus.svelte.js";
  import { untrack } from "svelte";
  import * as m from "../lib/paraglide/messages.js";

  interface Props {
    /** Absolute path to the mod directory. */
    dir: string;
  }
  let { dir }: Props = $props();

  // Refresh on mount / when `dir` changes; `untrack` keeps the effect depending
  // on `dir` alone (see gitstatus refresh notes).
  $effect(() => {
    const d = dir;
    untrack(() => gitStatus.refresh(d));
  });

  const status = $derived(gitStatus.get(dir));
  const dirty = $derived(isDirty(status));
  const tooltip = $derived(
    status?.hasUncommitted ? m.dirty_marker_changes() : m.dirty_marker_unbacked(),
  );
</script>

{#if dirty}
  <span class="dirty-marker" role="img" aria-label={tooltip} title={tooltip}>*</span>
{/if}

<style>
  .dirty-marker {
    display: inline-block;
    margin-left: 0.1em;
    color: var(--color-primary);
    font-weight: var(--font-weight-bold);
    font-size: 2em;
    /* line-height 0 keeps the enlarged glyph from stretching the line; the glyph
       still draws upward from its baseline, so translateY pulls it down to sit
       visually more centered with the text. */
    line-height: 0;
    vertical-align: middle;
    transform: translateY(0.12em);
    cursor: default;
  }
</style>
