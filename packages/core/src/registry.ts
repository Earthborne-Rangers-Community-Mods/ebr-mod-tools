/**
 * Registry query and entry-building utilities.
 */

import { GithubError } from "./errors.js";
import type { Manifest, RegistryEntry, Registry, IncludedModWarning } from "./types.js";

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
  { key: "authorDiscord", test: (v: unknown) => typeof v === "string" && v.length > 0 },
  { key: "tags", test: (v: unknown) => Array.isArray(v) && v.length > 0 },
  { key: "icon", test: (v: unknown) => typeof v === "string" && v.length > 0 },
  { key: "optionalProducts", test: (v: unknown) => Array.isArray(v) && v.length > 0 },
  { key: "includedMods", test: (v: unknown) => Array.isArray(v) && v.length > 0 },
  { key: "midCampaignNotes", test: (v: unknown) => typeof v === "string" && v.length > 0 },
];

/**
 * Check includedMods entries against the registry.
 * Returns an array of warning objects for mods not found in the registry.
 * @param registry - Parsed registry.json.
 */
export function checkIncludedMods(
  includedMods: Array<{ id: string; name?: string }>,
  registry: { mods: Array<{ id: string }> },
): IncludedModWarning[] {
  if (!includedMods || !registry?.mods) return [];

  const registryIds = new Set(registry.mods.map((m) => m.id));
  const warnings: IncludedModWarning[] = [];

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
 * @param manifest - Validated mod manifest.
 * @param commitHash - Full SHA-1 of the published commit.
 * @returns Registry entry ready for insertion.
 */
export function buildRegistryEntry(manifest: Manifest, commitHash: string): RegistryEntry {
  const entry: Record<string, any> = {};

  for (const field of REQUIRED_MIRROR_FIELDS) {
    entry[field] = manifest[field as keyof Manifest];
  }

  for (const { key, test } of OPTIONAL_MIRROR_FIELDS) {
    const value = manifest[key as keyof Manifest];
    if (value !== undefined && test(value)) {
      entry[key] = value;
    }
  }

  // Registry-specific fields
  entry.latestVersion = manifest.version;
  entry.updatedAt = new Date().toISOString().split("T")[0];
  entry.commitHash = commitHash;

  return entry as RegistryEntry;
}

/**
 * Fetch the public browse-tier registry over anonymous HTTPS.
 *
 * This is the same fetch path the mod manager app uses: an unauthenticated
 * GET of `registry.json` from raw.githubusercontent. Throws on network
 * failure, non-OK response, or invalid JSON so callers can decide how to
 * degrade.
 *
 * @param options.url - Override the registry URL (tests).
 * @param options.fetchImpl - Injected fetch implementation (tests).
 * @returns Parsed registry.
 * @throws {GithubError} On a non-OK HTTP response or invalid JSON body.
 */
export async function fetchRegistry({ url = REGISTRY_RAW_URL, fetchImpl = fetch }: { url?: string; fetchImpl?: typeof fetch } = {}): Promise<Registry> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new GithubError(
      "registry-fetch",
      `Registry fetch failed with status ${response.status}.`,
      response.status,
    );
  }
  try {
    return (await response.json()) as Registry;
  } catch {
    throw new GithubError("registry-fetch", "Registry response was not valid JSON.");
  }
}

/**
 * Courtesy check of whether a proposed mod id is already claimed in the
 * public registry. Never throws: a network or parse failure degrades to
 * `{ status: "unverified" }` so the caller can proceed rather than block.
 *
 * @param modId - The proposed mod id (kebab-case).
 * @param options.url - Override the registry URL (tests).
 * @param options.fetchImpl - Injected fetch implementation (tests).
 */
export async function checkModIdAvailability(
  modId: string,
  { url, fetchImpl }: { url?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ status: "available" | "claimed" | "unverified"; entry?: RegistryEntry; error?: Error }> {
  let registry;
  try {
    registry = await fetchRegistry({ url, fetchImpl });
  } catch (error) {
    return { status: "unverified", error: error as Error };
  }

  const entry = registry?.mods?.find((mod) => mod.id === modId);
  return entry ? { status: "claimed", entry } : { status: "available" };
}
