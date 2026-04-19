/**
 * Canonical lists of known campaigns and products.
 *
 * Used by `ebr new` for prompts, by the registry browser for filter dropdowns,
 * and by documentation. Products are validated in the manifest validator;
 * campaigns are NOT validated (custom campaign mods define their own IDs).
 *
 * Update these lists when Earthborne Games releases new content.
 */

/**
 * Allowed file extensions for mod content.
 * Only files with these extensions are staged during `ebr save` and extracted
 * during mod download. Everything else is silently skipped.
 */
export const ALLOWED_EXTENSIONS = Object.freeze([
  ".md", ".css", ".json",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".txt", ".pdf",
]);

export const MOD_TYPES = Object.freeze([
  { id: "enhancement", name: "Enhancement", description: "Modify existing campaign content" },
  { id: "expansion", name: "Expansion", description: "Add new content to a campaign" },
  { id: "one-day-mission", name: "One-Day Mission", description: "A single-session mission" },
  { id: "campaign", name: "Campaign", description: "An entire custom campaign" },
  { id: "collection", name: "Collection", description: "Combine multiple mods into one" },
  { id: "theme", name: "Theme", description: "CSS-only visual reskin" },
]);

/**
 * Known campaign identifiers and their display names.
 * Campaigns are the playable story arcs. One-day missions are treated the same way.
 */
export const OFFICIAL_CAMPAIGNS = Object.freeze([
  { id: "lure-of-the-valley", name: "Lure of the Valley", requiredProducts: ["core-set"] },
  { id: "legacy-of-the-ancestors", name: "Legacy of the Ancestors", requiredProducts: ["legacy-of-the-ancestors"] },
  { id: "spire-in-bloom", name: "Spire in Bloom", requiredProducts: ["core-set", "spire-in-bloom"] },
  { id: "shadow-of-the-storm", name: "Shadow of the Storm", requiredProducts: ["core-set", "shadow-of-the-storm"] },
  { id: "animal-rescue", name: "Animal Rescue", oneDayMission: true, requiredProducts: ["core-set"] },
  { id: "missing-person", name: "Missing Person", oneDayMission: true, requiredProducts: ["core-set"] },
  { id: "predatory-instincts", name: "Predatory Instincts", oneDayMission: true, requiredProducts: ["core-set"] },
  { id: "incandescent-sky", name: "Incandescent Sky", oneDayMission: true, requiredProducts: ["incandescent-sky"] },
]);

/**
 * Known product identifiers and their display names.
 * Products are the physical/digital items players purchase.
 * A mod's `requiredProducts` lists what the player must own to use it.
 */
export const OFFICIAL_PRODUCTS = Object.freeze([
  { id: "core-set", name: "Core Set" },
  { id: "legacy-of-the-ancestors", name: "Legacy of the Ancestors" },
  { id: "spire-in-bloom", name: "Spire in Bloom" },
  { id: "shadow-of-the-storm", name: "Shadow of the Storm" },
  { id: "moments-in-the-valley", name: "Moments in the Valley" },
  { id: "stewards-of-the-valley", name: "Stewards of the Valley" },
  { id: "moments-on-the-path", name: "Moments on the Path" },
  { id: "ranger-card-doubler", name: "Ranger Card Doubler" },
  { id: "incandescent-sky", name: "Incandescent Sky" },
]);
