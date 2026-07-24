/**
 * Registry query and entry-building utilities.
 */

import { GithubError } from "./errors.js";

/** @typedef {import('./types.js').Manifest} Manifest */
/** @typedef {import('./types.js').RegistryEntry} RegistryEntry */
/** @typedef {import('./types.js').Registry} Registry */

// Public registry location. Mirrors the mod manager app's anonymous
// raw.githubusercontent fetch path (see ebr-mod-manager src/lib/registry.ts).
const REGISTRY_OWNER = "Earthborne-Rangers-Community-Mods";
const REGISTRY_REPO = "ebr-mod-registry";
const REGISTRY_BRANCH = "main";

/** Anonymous, CDN-backed URL of the built browse-tier registry. */
export const REGISTRY_RAW_URL =
  `https://raw.githubusercontent.com/${REGISTRY_OWNER}/${REGISTRY_REPO}/${REGISTRY_BRANCH}/registry.json`;

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
  { key: "authorDiscord", test: (/** @type {unknown} */ v) => typeof v === "string" && v.length > 0 },
  { key: "tags", test: (/** @type {unknown} */ v) => Array.isArray(v) && v.length > 0 },
  { key: "icon", test: (/** @type {unknown} */ v) => typeof v === "string" && v.length > 0 },
  { key: "optionalProducts", test: (/** @type {unknown} */ v) => Array.isArray(v) && v.length > 0 },
  { key: "includedMods", test: (/** @type {unknown} */ v) => Array.isArray(v) && v.length > 0 },
  { key: "midCampaignNotes", test: (/** @type {unknown} */ v) => typeof v === "string" && v.length > 0 },
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
 * @param {Manifest} manifest - Validated mod manifest.
 * @param {string} commitHash - Full SHA-1 of the published commit.
 * @returns {RegistryEntry} Registry entry ready for insertion.
 */
export function buildRegistryEntry(manifest, commitHash) {
  /** @type {Record<string, any>} */
  const entry = {};

  for (const field of REQUIRED_MIRROR_FIELDS) {
    entry[field] = manifest[/** @type {keyof Manifest} */ (field)];
  }

  for (const { key, test } of OPTIONAL_MIRROR_FIELDS) {
    const value = manifest[/** @type {keyof Manifest} */ (key)];
    if (value !== undefined && test(value)) {
      entry[key] = value;
    }
  }

  // Registry-specific fields
  entry.latestVersion = manifest.version;
  entry.updatedAt = new Date().toISOString().split("T")[0];
  entry.commitHash = commitHash;

  return /** @type {RegistryEntry} */ (entry);
}

/**
 * Fetch the public browse-tier registry over anonymous HTTPS.
 *
 * This is the same fetch path the mod manager app uses: an unauthenticated
 * GET of `registry.json` from raw.githubusercontent. Throws on network
 * failure, non-OK response, or invalid JSON so callers can decide how to
 * degrade.
 *
 * @param {object} [options]
 * @param {string} [options.url] - Override the registry URL (tests).
 * @param {typeof fetch} [options.fetchImpl] - Injected fetch implementation (tests).
 * @returns {Promise<Registry>} Parsed registry.
 * @throws {GithubError} On a non-OK HTTP response or invalid JSON body.
 */
export async function fetchRegistry({ url = REGISTRY_RAW_URL, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new GithubError(
      "registry-fetch",
      `Registry fetch failed with status ${response.status}.`,
      response.status,
    );
  }
  try {
    return /** @type {Registry} */ (await response.json());
  } catch {
    throw new GithubError("registry-fetch", "Registry response was not valid JSON.");
  }
}

/**
 * Courtesy check of whether a proposed mod id is already claimed in the
 * public registry. Never throws: a network or parse failure degrades to
 * `{ status: "unverified" }` so the caller can proceed rather than block.
 *
 * @param {string} modId - The proposed mod id (kebab-case).
 * @param {object} [options]
 * @param {string} [options.url] - Override the registry URL (tests).
 * @param {typeof fetch} [options.fetchImpl] - Injected fetch implementation (tests).
 * @returns {Promise<{status: "available"|"claimed"|"unverified", entry?: RegistryEntry, error?: Error}>}
 */
export async function checkModIdAvailability(modId, { url, fetchImpl } = {}) {
  let registry;
  try {
    registry = await fetchRegistry({ url, fetchImpl });
  } catch (error) {
    return { status: "unverified", error: /** @type {Error} */ (error) };
  }

  const entry = registry?.mods?.find((mod) => mod.id === modId);
  return entry ? { status: "claimed", entry } : { status: "available" };
}
