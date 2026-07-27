/**
 * Pure type-gate for the "Add content" launcher: which content kinds a mod of a
 * given type can add. Kept free of Svelte runes (no `$state`) so it is unit-
 * testable and importable outside the reactive store.
 */

/** A kind of content the launcher can add. */
export type AddContentKind = "template";

/** Mod types for which the template (scaffold) kind is offered. */
const TEMPLATE_TYPES = new Set(["campaign", "expansion"]);

/**
 * The content kinds the launcher offers for a mod type, in menu order. Empty
 * when the type has no add-content options (so callers can hide the launcher).
 */
export function addContentKinds(modType: string | undefined): AddContentKind[] {
  const kinds: AddContentKind[] = [];
  if (modType && TEMPLATE_TYPES.has(modType)) kinds.push("template");
  return kinds;
}
