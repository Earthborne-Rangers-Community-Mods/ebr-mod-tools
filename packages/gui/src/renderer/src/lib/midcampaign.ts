/**
 * Shared mid-campaign safety form rules, so the New Mod and Mod Details pages
 * offer the "safe to add" choice and its notes field on the same terms.
 */

/**
 * The mid-campaign safety value fixed by the type, or `null` when the creator
 * chooses it. `campaign` is never safe; `theme` and `one-day-mission` always
 * are.
 */
export function fixedSafety(type: string): boolean | null {
  if (type === "campaign") return false;
  if (type === "theme" || type === "one-day-mission") return true;
  return null;
}

/**
 * Whether the creator chooses the safe-to-add value for this type. For the types
 * whose value is fixed ({@link fixedSafety}) the choice is not offered.
 */
export function showSafeChoice(type: string): boolean {
  return fixedSafety(type) === null;
}

/**
 * Whether to show the "why not safe" notes field: for any type that offers the
 * safe choice (see {@link showSafeChoice}) once the mod is marked not safe. The
 * fixed-safety types never show it - a standalone `campaign` has no mid-campaign
 * install semantics, and `theme`/`one-day-mission` are always safe.
 */
export function showSafeNotes(type: string, safe: boolean): boolean {
  return showSafeChoice(type) && !safe;
}
