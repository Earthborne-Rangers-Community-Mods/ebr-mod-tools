/**
 * Pure helpers behind the update flow: turning a mod's checked update state into
 * the ordered queue the flow walks. Kept free of Svelte runes so it is
 * unit-testable outside the reactive store.
 */
import type { IncludedCampaignUpdate, IncludedModUpdate } from "core/types.js";

/** One update the flow offers to apply. */
export type UpdateItem =
  | { kind: "base" }
  | { kind: "campaign"; id: string }
  | { kind: "mod"; id: string; name: string; fromVersion: string; toVersion: string | null };

/** A mod's checked update state, as the queue builder reads it. */
export interface UpdateSources {
  /** New commits are available on the shell base content. */
  baseUpdateAvailable: boolean;
  campaigns: IncludedCampaignUpdate[];
  mods: IncludedModUpdate[];
}

/**
 * The updates available for a mod, ordered base content first, then campaigns,
 * then included mods - the order `ebr update` walks its sources, so foundations
 * land before the content built on them. Sources with nothing to pull in are
 * left out, including the registry's warn-and-skip cases (a delisted mod, or one
 * recorded ahead of its published version).
 */
export function buildUpdateQueue(sources: UpdateSources | null | undefined): UpdateItem[] {
  if (!sources) return [];
  const items: UpdateItem[] = [];
  if (sources.baseUpdateAvailable) items.push({ kind: "base" });
  for (const campaign of sources.campaigns) {
    if (campaign.updateAvailable) items.push({ kind: "campaign", id: campaign.id });
  }
  for (const mod of sources.mods) {
    if (!mod.updateAvailable) continue;
    items.push({
      kind: "mod",
      id: mod.id,
      name: mod.name,
      fromVersion: mod.currentVersion,
      toVersion: mod.registryVersion,
    });
  }
  return items;
}

/** How many updates are available for a mod. Zero hides the update affordances. */
export function updateCount(sources: UpdateSources | null | undefined): number {
  return buildUpdateQueue(sources).length;
}
