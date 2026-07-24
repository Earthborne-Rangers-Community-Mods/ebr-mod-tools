/**
 * Shared type declarations for core data shapes.
 *
 * This module contains no runtime code. It exists only to hold the type
 * declarations that other modules import, so the manifest, registry, and
 * config shapes are documented in one place.
 */

/** A mod's included-mod credit entry. */
export interface IncludedMod {
  id: string;
  name: string;
  author: string;
  version: string;
  repoUrl: string;
}

/** A mod's included official-campaign entry. */
export interface IncludedCampaign {
  id: string;
  branch: string;
  commitHash: string;
}

/**
 * The parsed `ebr-mod.json` manifest. Fields marked required here are the
 * manifest's required fields (enforced at authoring time by `validateManifest`
 * and by `buildManifest`, which always writes them); the optional fields are
 * genuinely optional in the schema.
 */
export interface Manifest {
  schemaVersion: number;
  name: string;
  id: string;
  version: string;
  type: string;
  description: string;
  author: string;
  campaigns: string[];
  requiredProducts: string[];
  safeToAddMidCampaign: boolean;
  language: string;
  repoUrl: string;
  authorDiscord?: string;
  tags?: string[];
  optionalProducts?: string[];
  includedCampaigns?: IncludedCampaign[];
  includedMods?: IncludedMod[];
  midCampaignNotes?: string;
  icon?: string;
}

/**
 * The raw, unvalidated shape of a parsed `ebr-mod.json` as it comes off disk:
 * every field is optional because nothing has vouched for it yet. `readManifest`
 * returns this. Turn it into a validated `Manifest` with `assertValidManifest`
 * (or `validateManifest` followed by a guarded narrow) before relying on the
 * required fields; callers that only touch a field or two can stay on this shape.
 */
export type RawManifest = Partial<Manifest>;

/**
 * Input contract for `buildManifest`: the field values a creator supplies (via
 * CLI prompts or the GUI form) before a manifest is assembled. The fields
 * `buildManifest` needs are required here; the rest are optional and receive
 * sensible defaults.
 */
export interface ModValues {
  name: string;
  author: string;
  description: string;
  type: string;
  campaigns: string[];
  requiredProducts: string[];
  safeToAddMidCampaign: boolean;
  language: string;
  id?: string;
  version?: string;
  authorDiscord?: string;
  tags?: string[];
  optionalProducts?: string[];
  midCampaignNotes?: string;
  icon?: string;
  repoUrl?: string;
  includedMods?: IncludedMod[];
}

/**
 * A single mod's entry in the registry (`mods/<id>.json`), also the shape
 * mirrored into the built browse-tier `registry.json`.
 */
export interface RegistryEntry {
  id: string;
  name: string;
  author: string;
  authorDiscord?: string;
  description: string;
  repoUrl: string;
  type: string;
  tags?: string[];
  campaigns: string[];
  requiredProducts: string[];
  optionalProducts?: string[];
  includedMods?: IncludedMod[];
  safeToAddMidCampaign: boolean;
  midCampaignNotes?: string;
  icon?: string;
  language: string;
  latestVersion: string;
  updatedAt: string;
  commitHash: string;
}

/** The parsed browse-tier registry (`registry.json`). */
export interface Registry {
  schemaVersion?: number;
  mods: RegistryEntry[];
}

/** A single field change recorded by `updateManifest`. */
export interface ManifestChange {
  field: string;
  oldValue: any;
  newValue: any;
}

/** A warning about an `includedMods` entry that is not in the registry. */
export interface IncludedModWarning {
  modId: string;
  modName: string;
  message: string;
}

/** Per-entry result of `checkIncludedCampaignsUpdates`. */
export interface IncludedCampaignUpdate {
  id: string;
  branch: string;
  oldCommitHash: string;
  newCommitHash: string | null;
  updateAvailable: boolean;
  missing: boolean;
}

/** Per-entry result of `checkIncludedModsUpdates`. */
export interface IncludedModUpdate {
  id: string;
  name: string;
  missing: boolean;
  manifestAhead: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  registryVersion: string | null;
  repoUrl: string;
  commitHash: string | null;
}

/** A progress event passed to `onProgress` callbacks. */
export interface ProgressEvent {
  step: string;
  message?: string;
  stage?: string;
  percent?: number;
  paths?: string[];
}

export type ProgressCallback = (event: ProgressEvent) => void;

/** Options bag carrying a progress callback, shared by long-running operations. */
export interface ProgressOptions {
  onProgress?: ProgressCallback;
}

/** The result of asking the PR worker to open a registry PR. */
export interface PrResult {
  number?: number;
  url?: string;
  alreadyExists?: boolean;
}
