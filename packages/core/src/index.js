/**
 * Core library entry point.
 * Consumed within the monorepo via the `core` workspace package
 * (the CLI and the GUI import from it directly).
 */

export { scaffoldMod, scaffoldModIntoClone, saveMod, publishMod, getModBranchName, forkOwnerFromUrl, forkUrlFor, resolveCredentialLogin, ensureFork } from "./workflows.js";
export { readManifest, writeManifest, validateManifest, formatValidationError, formatValidationErrors, VALIDATION_CODES, validateNonEmpty, validateName, validateIcon, validateId, validateVersion, validateLanguage, validateRepoUrl, bumpVersion, compareVersions, updateManifest, toId, buildManifest, deriveOptionalProducts, applyMissingProductFix } from "./manifest.js";
export { isRepo, cloneRepo, cloneBranchShallow, createLocalBranch, checkout, checkoutResetBranch, setRemoteUrl, resetHardAndClean, setUpstreamBranch, initRepo, addRemote, hasRemote, getRemotes, stageAll, stageByExtensions, stageFile, unstageFile, commit, push, getHeadCommit, getCurrentBranch, merge, abortMerge, getStatus, getAheadBehind, fetchRemote, getRemoteUrl, remoteExists, isAncestor, isGitAuthError, createTag, revparseRef, mergeBase, undoLastCommit } from "./git.js";
export { getAuthenticatedUser, forkRepo, normalizeGithubUrl, runCommand, parseCredentialFill, borrowCredentialToken, clearCredential } from "./github.js";
export { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS, SCAFFOLD_TYPES, SCAFFOLD_NAME_TOKEN, SCAFFOLD_SKIP_FILES, KNOWN_SCAFFOLDS } from "./catalogs.js";
export { getConfig, setConfig, getForkUrls, setForkUrls, clearForkUrls, getAuthorDefaults, setAuthorDefaults, clearAuthorDefaults, CONFIG_DIR } from "./config.js";
export { checkIncludedMods, buildRegistryEntry, fetchRegistry, checkModIdAvailability, REGISTRY_RAW_URL } from "./registry.js";
export { checkBaseUpdate, applyBaseUpdate, checkIncludedCampaignsUpdates } from "./workflows.js";
export { includeCampaign, resolveCampaignSource, upsertIncludedCampaign, includeScaffold, computeMissingScaffoldProduct } from "./workflows.js";
export { includeMod, resolveModSource, upsertIncludedMod, classifyIncludeSource, remoteNameForRepoUrl, checkIncludedModsUpdates } from "./workflows.js";
export { ManifestError, ManifestNotFoundError, ManifestParseError, GitError, NotARepoError, GitAuthenticationError, MergeConflictError, NothingToCommitError, DirtyWorkingTreeError, UnpushedChangesError, ConfigError, GithubError, AuthenticationError, ValidationError, ModIdConflictError, BaseRemoteMissingError, IncludeRefNotFoundError, IndexNotCleanError, ForkOutOfSyncError, ScaffoldRefNotFoundError, IncludeModNotFoundError, VersionNotHigherError } from "./errors.js";
