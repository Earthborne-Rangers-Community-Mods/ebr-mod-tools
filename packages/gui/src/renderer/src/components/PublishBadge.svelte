<script lang="ts">
  /**
   * Compact indicator of a mod's registry publish state: unpublished, published
   * at the on-disk version, or published at a different version.
   */
  import { untrack } from "svelte";
  import { publishStatus, publishedDiffers } from "../lib/publishstatus.svelte.js";
  import { openMods } from "../lib/mods.svelte.js";
  import * as m from "../lib/paraglide/messages.js";

  interface Props {
    /** Absolute path to the mod directory this badge reflects. */
    dir: string;
  }
  let { dir }: Props = $props();

  // Refresh whenever the directory changes. `refresh` mutates the cached status;
  // `untrack` keeps this effect depending on `dir` alone.
  $effect(() => {
    const d = dir;
    untrack(() => publishStatus.refresh(d));
  });

  const status = $derived(publishStatus.get(dir));
  const diskVersion = $derived(openMods.getByDir(dir)?.manifest?.version);
  const differs = $derived(publishedDiffers(status, diskVersion));
  // Show the published version when it differs from what is on disk, else a plain
  // "Published" chip.
  const label = $derived(
    differs
      ? m.publish_status_published_version({ version: status?.publishedVersion ?? "" })
      : m.publish_status_published(),
  );
</script>

{#if status?.loaded && status.published}
  <span class="publish-badge published">{label}</span>
{/if}

<style>
  .publish-badge {
    display: inline-block;
    font-size: var(--font-size-xs);
    padding: 2px var(--spacing-sm);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    white-space: nowrap;
  }

  .publish-badge.published {
    color: var(--color-success);
    border-color: var(--color-success);
  }
</style>
