/**
 * Core library entry point.
 * Consumed within the monorepo via the `core` workspace package
 * (the CLI and the GUI import from it directly).
 */

export { scaffoldMod, scaffoldModIntoClone, saveMod, pushMod, publishMod, findOpenRegistryPrs, getModBranchName, publishBranchName, forkOwnerFromUrl, forkUrlFor, resolveCredentialLogin, resolveCredentialIdentity, previewIdentityOverride, ensureFork, classifyCommitIdentity } from "./workflows.js";
export { readManifest, writeManifest, validateManifest, formatValidationError, formatValidationErrors, assertValidManifest, VALIDATION_CODES, validateNonEmpty, validateName, validateIcon, validateId, validateVersion, validateLanguage, validateRepoUrl, bumpVersion, compareVersions, isBelowStable, STABLE_VERSION, updateManifest, toId, buildManifest, deriveOptionalProducts, applyMissingProductFix, DEFAULT_MOD_ICON } from "./manifest.js";
export { isRepo, cloneRepo, cloneBranchShallow, createLocalBranch, checkout, checkoutResetBranch, setRemoteUrl, resetHardAndClean, setUpstreamBranch, initRepo, addRemote, hasRemote, getRemotes, stageAll, stageByExtensions, stageFile, unstageFile, commit, push, getHeadCommit, getCurrentBranch, merge, abortMerge, predictMerge, checkoutConflictSide, readConflictSide, commitMerge, isMerging, getStatus, getAheadBehind, fetchRemote, getRemoteUrl, remoteExists, isAncestor, isGitAuthError, createTag, revparseRef, mergeBase, undoLastCommit, getCommitAuthorEmail, getLocalGitIdentity } from "./git.js";
export { getAuthenticatedUser, forkRepo, normalizeGithubUrl, runCommand, parseCredentialFill, borrowCredentialToken, clearCredential, deriveNoReplyEmail } from "./github.js";
export { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS, SCAFFOLD_TYPES, SCAFFOLD_NAME_TOKEN, SCAFFOLD_SKIP_FILES, KNOWN_SCAFFOLDS, impliedProductsForCampaigns, impliedProductsForScaffolds } from "./catalogs.js";
export { getConfig, setConfig, getForkUrls, setForkUrls, clearForkUrls, getAuthorDefaults, setAuthorDefaults, clearAuthorDefaults, getGithubIdentity, setGithubIdentity, clearGithubIdentity, CONFIG_DIR } from "./config.js";
export { checkIncludedMods, buildRegistryEntry, fetchRegistry, checkModIdAvailability, REGISTRY_RAW_URL } from "./registry.js";
export { checkBaseUpdate, applyBaseUpdate, checkIncludedCampaignsUpdates } from "./workflows.js";
export { includeCampaign, predictCampaignInclude, finishMerge, resolveCampaignSource, upsertCampaignTarget, computeMissingCampaignProducts, includeScaffold, planScaffold, addScaffoldProduct, computeMissingScaffoldProduct } from "./workflows.js";
export { includeMod, resolveModSource, upsertIncludedMod, classifyIncludeSource, remoteNameForRepoUrl, checkIncludedModsUpdates } from "./workflows.js";
export { ManifestError, ManifestNotFoundError, ManifestParseError, GitError, NotARepoError, GitAuthenticationError, MergeConflictError, NothingToCommitError, DirtyWorkingTreeError, UnpushedChangesError, ConfigError, GithubError, AuthenticationError, ValidationError, ModIdConflictError, BaseRemoteMissingError, IncludeRefNotFoundError, IndexNotCleanError, ForkOutOfSyncError, ScaffoldRefNotFoundError, IncludeModNotFoundError, VersionNotHigherError } from "./errors.js";
