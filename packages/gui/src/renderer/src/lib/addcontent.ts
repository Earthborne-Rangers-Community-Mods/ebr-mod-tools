/**
 * Pure type-gate for the "Add content" launcher: which content kinds a mod of a
 * given type can add. Kept free of Svelte runes (no `$state`) so it is unit-
 * testable and importable outside the reactive store.
 */

/** A kind of content the launcher can add. */
export type AddContentKind = "template" | "include-campaign" | "include-mod";

/** Mod types for which the template (scaffold) kind is offered. */
const TEMPLATE_TYPES = new Set(["campaign", "expansion"]);

/** Mod types for which the include-campaign kind is offered. */
const INCLUDE_CAMPAIGN_TYPES = new Set(["enhancement", "expansion", "one-day-mission", "collection"]);

/** Mod types for which the include-mod kind is offered (Advanced mode only). */
const INCLUDE_MOD_TYPES = new Set(["enhancement", "expansion", "one-day-mission", "collection"]);

/**
 * The content kinds the launcher offers for a mod type, in menu order. Empty
 * when the type has no add-content options (so callers can hide the launcher).
 * @param advancedModeEnabled - Whether Advanced mode is on; gates the
 *   include-mod kind, which is hidden by default.
 */
export function addContentKinds(modType: string | undefined, advancedModeEnabled = false): AddContentKind[] {
  const kinds: AddContentKind[] = [];
  if (modType && TEMPLATE_TYPES.has(modType)) kinds.push("template");
  if (modType && INCLUDE_CAMPAIGN_TYPES.has(modType)) kinds.push("include-campaign");
  if (advancedModeEnabled && modType && INCLUDE_MOD_TYPES.has(modType)) kinds.push("include-mod");
  return kinds;
}
