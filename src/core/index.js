/**
 * Core library entry point.
 * The Creator GUI imports from 'ebr-mod-tools/core' to use these directly.
 */

export { scaffoldMod, scaffoldModIntoClone, saveMod, publishMod, getModBranchName } from "./workflows.js";
export { readManifest, writeManifest, validateManifest, formatValidationError, formatValidationErrors, VALIDATION_CODES, validateNonEmpty, validateName, validateIcon, validateId, validateVersion, validateLanguage, validateRepoUrl, bumpVersion, compareVersions, updateManifest, toId, buildManifest, deriveOptionalProducts, applyMissingProductFix } from "./manifest.js";
export { isRepo, cloneRepo, cloneBranchShallow, createLocalBranch, checkout, setUpstreamBranch, initRepo, addRemote, hasRemote, getRemotes, stageAll, stageByExtensions, stageFile, unstageFile, commit, push, getHeadCommit, getCurrentBranch, merge, abortMerge, getStatus, getAheadBehind, fetchRemote, getRemoteUrl, isAncestor, createTag, revparseRef, mergeBase, undoLastCommit } from "./git.js";
export { getAuthenticatedUser, getRepo, forkRepo, getFileContent, createOrUpdateFileContent, createBranch, deleteBranch, updateBranchRef, getRefSha, createPullRequest, listPullRequests, normalizeGithubUrl, compareCommits } from "./github.js";
export { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS, SCAFFOLD_TYPES, SCAFFOLD_NAME_TOKEN, SCAFFOLD_SKIP_FILES, KNOWN_SCAFFOLDS } from "./catalogs.js";
export { getConfig, setConfig, getGithubToken, setGithubToken, clearGithubToken, getForkUrls, setForkUrls, clearForkUrls, getAuthorDefaults, setAuthorDefaults, clearAuthorDefaults, CONFIG_DIR } from "./config.js";
export { checkIncludedMods, buildRegistryEntry, fetchRegistry, checkModIdAvailability, REGISTRY_RAW_URL } from "./registry.js";
export { checkBaseUpdate, applyBaseUpdate, checkIncludedCampaignsUpdates } from "./workflows.js";
export { includeCampaign, resolveCampaignSource, upsertIncludedCampaign, includeScaffold, computeMissingScaffoldProduct } from "./workflows.js";
export { includeMod, resolveModSource, upsertIncludedMod, classifyIncludeSource, remoteNameForRepoUrl, checkIncludedModsUpdates } from "./workflows.js";
export { ManifestError, ManifestNotFoundError, ManifestParseError, GitError, NotARepoError, MergeConflictError, NothingToCommitError, DirtyWorkingTreeError, UnpushedChangesError, ConfigError, GithubError, AuthenticationError, InsufficientScopeError, GithubFileNotFoundError, ValidationError, ModIdConflictError, BaseRemoteMissingError, IncludeRefNotFoundError, IndexNotCleanError, ForkOutOfSyncError, ScaffoldRefNotFoundError, IncludeModNotFoundError, VersionNotHigherError } from "./errors.js";
