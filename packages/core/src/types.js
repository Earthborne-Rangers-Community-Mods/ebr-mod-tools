/**
 * Shared JSDoc typedefs for core data shapes.
 *
 * This module contains no runtime code. It exists only to hold the `@typedef`
 * declarations that other modules reference via `import('./types.js').TypeName`,
 * so the manifest, registry, and config shapes are documented in one place.
 */

/**
 * A mod's included-mod credit entry.
 * @typedef {object} IncludedMod
 * @property {string} id
 * @property {string} name
 * @property {string} author
 * @property {string} version
 * @property {string} repoUrl
 */

/**
 * A mod's included official-campaign entry.
 * @typedef {object} IncludedCampaign
 * @property {string} id
 * @property {string} branch
 * @property {string} commitHash
 */

/**
 * The parsed `ebr-mod.json` manifest. Fields marked required here are the
 * manifest's required fields (enforced at authoring time by `validateManifest`
 * and by `buildManifest`, which always writes them); the optional fields are
 * genuinely optional in the schema.
 * @typedef {object} Manifest
 * @property {number} schemaVersion
 * @property {string} name
 * @property {string} id
 * @property {string} version
 * @property {string} type
 * @property {string} description
 * @property {string} author
 * @property {string[]} campaigns
 * @property {string[]} requiredProducts
 * @property {boolean} safeToAddMidCampaign
 * @property {string} language
 * @property {string} repoUrl
 * @property {string} [authorDiscord]
 * @property {string[]} [tags]
 * @property {string[]} [optionalProducts]
 * @property {IncludedCampaign[]} [includedCampaigns]
 * @property {IncludedMod[]} [includedMods]
 * @property {string} [midCampaignNotes]
 * @property {string} [icon]
 */

/**
 * The raw, unvalidated shape of a parsed `ebr-mod.json` as it comes off disk:
 * every field is optional because nothing has vouched for it yet. `readManifest`
 * returns this. Turn it into a validated `Manifest` with `assertValidManifest`
 * (or `validateManifest` followed by a guarded narrow) before relying on the
 * required fields; callers that only touch a field or two can stay on this shape.
 * @typedef {Partial<Manifest>} RawManifest
 */

/**
 * Input contract for `buildManifest`: the field values a creator supplies (via
 * CLI prompts or the GUI form) before a manifest is assembled. The fields
 * `buildManifest` needs are required here; the rest are optional and receive
 * sensible defaults.
 * @typedef {object} ModValues
 * @property {string} name
 * @property {string} author
 * @property {string} description
 * @property {string} type
 * @property {string[]} campaigns
 * @property {string[]} requiredProducts
 * @property {boolean} safeToAddMidCampaign
 * @property {string} language
 * @property {string} [id]
 * @property {string} [version]
 * @property {string} [authorDiscord]
 * @property {string[]} [tags]
 * @property {string[]} [optionalProducts]
 * @property {string} [midCampaignNotes]
 * @property {string} [icon]
 * @property {string} [repoUrl]
 * @property {IncludedMod[]} [includedMods]
 */

/**
 * A single mod's entry in the registry (`mods/<id>.json`), also the shape
 * mirrored into the built browse-tier `registry.json`.
 * @typedef {object} RegistryEntry
 * @property {string} id
 * @property {string} name
 * @property {string} author
 * @property {string} [authorDiscord]
 * @property {string} description
 * @property {string} repoUrl
 * @property {string} type
 * @property {string[]} [tags]
 * @property {string[]} campaigns
 * @property {string[]} requiredProducts
 * @property {string[]} [optionalProducts]
 * @property {IncludedMod[]} [includedMods]
 * @property {boolean} safeToAddMidCampaign
 * @property {string} [midCampaignNotes]
 * @property {string} [icon]
 * @property {string} language
 * @property {string} latestVersion
 * @property {string} updatedAt
 * @property {string} commitHash
 */

/**
 * The parsed browse-tier registry (`registry.json`).
 * @typedef {object} Registry
 * @property {number} [schemaVersion]
 * @property {RegistryEntry[]} mods
 */

/**
 * A structured manifest validation error (from `validateManifest`).
 * @typedef {object} ValidationErrorInfo
 * @property {string} code - One of `VALIDATION_CODES`.
 * @property {string} [field]
 * @property {*} [value]
 * @property {number} [index]
 * @property {string} [campaign]
 */

/**
 * A progress event passed to `onProgress` callbacks.
 * @typedef {object} ProgressEvent
 * @property {string} step
 * @property {string} [message]
 * @property {string} [stage]
 * @property {number} [percent]
 * @property {string[]} [paths]
 */

/**
 * @typedef {(event: ProgressEvent) => void} ProgressCallback
 */

/**
 * The result of asking the PR worker to open a registry PR.
 * @typedef {object} PrResult
 * @property {number} [number]
 * @property {string} [url]
 * @property {boolean} [alreadyExists]
 */

export {};
