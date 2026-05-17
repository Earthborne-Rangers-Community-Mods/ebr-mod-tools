/**
 * Registry query and entry-building utilities.
 *
 * Pure functions for checking includedMods and building registry entries.
 */

/**
 * Fields always mirrored from the manifest into the registry entry.
 */
const REQUIRED_MIRROR_FIELDS = [
  "id", "name", "author", "description", "repoUrl", "type",
  "campaigns", "requiredProducts", "safeToAddMidCampaign", "language",
];

/**
 * Optional fields mirrored only when present and non-empty.
 */
const OPTIONAL_MIRROR_FIELDS = [
  { key: "authorDiscord", test: (v) => typeof v === "string" && v.length > 0 },
  { key: "tags", test: (v) => Array.isArray(v) && v.length > 0 },
  { key: "icon", test: (v) => typeof v === "string" && v.length > 0 },
  { key: "optionalProducts", test: (v) => Array.isArray(v) && v.length > 0 },
  { key: "includedMods", test: (v) => Array.isArray(v) && v.length > 0 },
  { key: "midCampaignNotes", test: (v) => typeof v === "string" && v.length > 0 },
];

/**
 * Check includedMods entries against the registry.
 * Returns an array of warning objects for mods not found in the registry.
 * @param {Array<{id: string, name?: string}>} includedMods
 * @param {{mods: Array<{id: string}>}} registry - Parsed registry.json.
 * @returns {Array<{modId: string, modName: string, message: string}>}
 */
export function checkIncludedMods(includedMods, registry) {
  if (!includedMods || !registry?.mods) return [];

  const registryIds = new Set(registry.mods.map((m) => m.id));
  const warnings = [];

  for (const mod of includedMods) {
    if (!registryIds.has(mod.id)) {
      warnings.push({
        modId: mod.id,
        modName: mod.name || mod.id,
        message: `Included mod "${mod.name || mod.id}" (${mod.id}) was not found in the registry. It may have been delisted.`,
      });
    }
  }

  return warnings;
}

/**
 * Build a registry entry from a manifest and commit hash.
 * @param {object} manifest - Validated mod manifest.
 * @param {string} commitHash - Full SHA-1 of the published commit.
 * @returns {object} Registry entry ready for insertion.
 */
export function buildRegistryEntry(manifest, commitHash) {
  const entry = {};

  for (const field of REQUIRED_MIRROR_FIELDS) {
    entry[field] = manifest[field];
  }

  for (const { key, test } of OPTIONAL_MIRROR_FIELDS) {
    if (manifest[key] !== undefined && test(manifest[key])) {
      entry[key] = manifest[key];
    }
  }

  // Registry-specific fields
  entry.latestVersion = manifest.version;
  entry.updatedAt = new Date().toISOString().split("T")[0];
  entry.commitHash = commitHash;

  return entry;
}
