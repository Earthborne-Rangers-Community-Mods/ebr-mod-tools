/**
 * Core library entry point.
 * The Creator GUI imports from 'ebr-mod-tools/core' to use these directly.
 */

export { scaffoldMod, scaffoldModIntoClone, saveMod, publishMod, getModBranchName } from "./workflows.js";
export { readManifest, writeManifest, validateManifest, formatValidationError, formatValidationErrors, VALIDATION_CODES, validateNonEmpty, validateName, validateId, validateVersion, validateLanguage, validateRepoUrl, bumpVersion, updateManifest, toId, buildManifest } from "./manifest.js";
export { isRepo, cloneRepo, createLocalBranch, checkout, setUpstreamBranch, initRepo, addRemote, hasRemote, getRemotes, stageAll, stageByExtensions, commit, push, getHeadCommit, getCurrentBranch, merge, abortMerge, getStatus, getAheadBehind, fetchRemote, getRemoteUrl, isAncestor, createTag } from "./git.js";
export { getAuthenticatedUser, getRepo, forkRepo, getFileContent, createOrUpdateFileContent, createBranch, deleteBranch, updateBranchRef, getRefSha, createPullRequest, listPullRequests, normalizeGithubUrl } from "./github.js";
export { MOD_TYPES, OFFICIAL_CAMPAIGNS, OFFICIAL_PRODUCTS } from "./catalogs.js";
export { getConfig, setConfig, getGithubToken, setGithubToken, clearGithubToken, getForkUrls, setForkUrls, clearForkUrls, getAuthorDefaults, setAuthorDefaults, clearAuthorDefaults, CONFIG_DIR } from "./config.js";
export { checkIncludedMods, buildRegistryEntry } from "./registry.js";
export { checkBaseUpdate, applyBaseUpdate } from "./workflows.js";
export { ManifestError, ManifestNotFoundError, ManifestParseError, GitError, NotARepoError, MergeConflictError, NothingToCommitError, UnpushedChangesError, ConfigError, GithubError, AuthenticationError, InsufficientScopeError, GithubFileNotFoundError, ValidationError, ModIdConflictError, BaseRemoteMissingError } from "./errors.js";
