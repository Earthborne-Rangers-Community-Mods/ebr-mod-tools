/**
 * GitHub API wrapper using @octokit/rest.
 */

import { Octokit } from "@octokit/rest";
import { GithubError, AuthenticationError, GithubFileNotFoundError, InsufficientScopeError } from "./errors.js";

/**
 * Normalize a git remote URL to a GitHub HTTPS URL.
 * Handles HTTPS (with or without .git) and SSH formats.
 * Returns null if the URL is not a GitHub URL.
 * @param {string|null} url
 * @returns {string|null}
 */
export function normalizeGithubUrl(url) {
  if (!url) return null;

  // SSH: git@github.com:user/repo.git
  const sshMatch = url.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;

  // HTTPS: https://github.com/user/repo.git
  const httpsMatch = url.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;

  return null;
}

const noopLog = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Create an authenticated Octokit instance.
 * @param {string} token - GitHub personal access token.
 */
function octokit(token) {
  return new Octokit({ auth: token, log: noopLog });
}

/**
 * Wrap an Octokit error into a typed GithubError (or subclass).
 * Checks HTTP status for known failure modes.
 */
function wrapError(operation, err, context) {
  if (err instanceof GithubError) return err;
  if (err.status === 401) {
    return new AuthenticationError();
  }
  if (err.status === 403 && /resource not accessible by personal access token/i.test(err.message)) {
    return new InsufficientScopeError(operation);
  }
  if (err.status === 404 && context?.path) {
    return new GithubFileNotFoundError(operation, context.path);
  }
  return new GithubError(operation, err.message || String(err), err.status);
}

/**
 * Get a repository's metadata.
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner - Repo owner.
 * @param {string} options.repo - Repo name.
 * @returns {Promise<{owner: string, repo: string, cloneUrl: string, isFork: boolean, parentOwner: string|null, parentRepo: string|null, permissions: {admin: boolean, push: boolean, pull: boolean}}>}
 */
export async function getRepo(token, { owner, repo }) {
  try {
    const { data } = await octokit(token).rest.repos.get({ owner, repo });
    return {
      owner: data.owner.login,
      repo: data.name,
      cloneUrl: data.clone_url,
      isFork: data.fork,
      parentOwner: data.parent?.owner?.login ?? null,
      parentRepo: data.parent?.name ?? null,
      permissions: {
        admin: data.permissions?.admin ?? false,
        push: data.permissions?.push ?? false,
        pull: data.permissions?.pull ?? false,
      },
    };
  } catch (err) {
    throw wrapError("getRepo", err);
  }
}

/**
 * Verify the token and return the authenticated user's info.
 * @param {string} token
 * @returns {Promise<{login: string, name: string|null}>}
 */
export async function getAuthenticatedUser(token) {
  try {
    const { data } = await octokit(token).rest.users.getAuthenticated();
    return { login: data.login, name: data.name };
  } catch (err) {
    throw wrapError("getAuthenticatedUser", err);
  }
}

/**
 * Fork a repository. Idempotent - returns the existing fork if one exists
 * (unless a custom `name` is provided, which allows multiple forks per account).
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner - Upstream repo owner.
 * @param {string} options.repo - Upstream repo name.
 * @param {string} [options.name] - Custom name for the fork (allows multiple forks of the same repo).
 * @returns {Promise<{owner: string, repo: string, cloneUrl: string}>}
 */
export async function forkRepo(token, { owner, repo, name }) {
  try {
    const params = { owner, repo };
    if (name) params.name = name;
    const { data } = await octokit(token).rest.repos.createFork(params);
    return {
      owner: data.owner.login,
      repo: data.name,
      cloneUrl: data.clone_url,
    };
  } catch (err) {
    throw wrapError("forkRepo", err);
  }
}

/**
 * Sync a fork's branch with its upstream parent.
 * Uses GitHub's merge-upstream API endpoint.
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner - Fork owner.
 * @param {string} options.repo - Fork repo name.
 * @param {string} options.branch - Branch to sync (e.g., "main").
 */
export async function syncFork(token, { owner, repo, branch }) {
  try {
    await octokit(token).request("POST /repos/{owner}/{repo}/merge-upstream", {
      owner,
      repo,
      branch,
    });
  } catch (err) {
    throw wrapError("syncFork", err);
  }
}

/**
 * Get a file's content and SHA from a repository.
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.path - File path within the repo.
 * @param {string} [options.ref] - Branch, tag, or commit SHA to read from.
 * @returns {Promise<{content: string, sha: string}>}
 */
export async function getFileContent(token, { owner, repo, path, ref }) {
  try {
    const params = { owner, repo, path };
    if (ref) params.ref = ref;
    const { data } = await octokit(token).rest.repos.getContent(params);
    return {
      content: Buffer.from(data.content, "base64").toString("utf-8"),
      sha: data.sha,
    };
  } catch (err) {
    throw wrapError("getFileContent", err, { path });
  }
}

/**
 * Create or update a file via the Contents API (creates a commit).
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.path
 * @param {string} options.content - UTF-8 file content (will be base64-encoded).
 * @param {string} options.message - Commit message.
 * @param {string} [options.sha] - Current file SHA (required for updates, omit for creates).
 * @param {string} [options.branch] - Target branch (defaults to repo's default branch).
 * @returns {Promise<{commitSha: string}>}
 */
export async function createOrUpdateFileContent(token, { owner, repo, path, content, message, sha, branch }) {
  try {
    const params = {
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString("base64"),
    };
    if (sha) params.sha = sha;
    if (branch) params.branch = branch;
    const { data } = await octokit(token).rest.repos.createOrUpdateFileContents(params);
    return { commitSha: data.commit.sha };
  } catch (err) {
    throw wrapError("createOrUpdateFileContent", err);
  }
}

/**
 * Create a branch (git ref) from a SHA.
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.branch - New branch name (without refs/heads/ prefix).
 * @param {string} options.sha - Commit SHA to branch from.
 */
export async function createBranch(token, { owner, repo, branch, sha }) {
  try {
    await octokit(token).rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha,
    });
  } catch (err) {
    throw wrapError("createBranch", err);
  }
}

/**
 * Get the SHA for a branch ref.
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.ref - Branch name (without refs/heads/ prefix).
 * @returns {Promise<string>} Commit SHA.
 */
export async function getRefSha(token, { owner, repo, ref }) {
  try {
    // Embed "heads/" in the URL template so only the branch name is a
    // parameter. Octokit encodes all {param} values with encodeURIComponent,
    // which turns "heads/main" into "heads%2Fmain" and causes a 404.
    const { data } = await octokit(token).request(
      "GET /repos/{owner}/{repo}/git/ref/heads/{branch}",
      { owner, repo, branch: ref },
    );
    return data.object.sha;
  } catch (err) {
    throw wrapError("getRefSha", err);
  }
}

/**
 * Create a pull request.
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner - Base repo owner.
 * @param {string} options.repo - Base repo name.
 * @param {string} options.title
 * @param {string} options.body
 * @param {string} options.head - Source (e.g., "username:branch-name" for cross-repo PRs).
 * @param {string} options.base - Target branch (e.g., "main").
 * @returns {Promise<{number: number, url: string}>}
 */
export async function createPullRequest(token, { owner, repo, title, body, head, base }) {
  try {
    const { data } = await octokit(token).rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });
    return { number: data.number, url: data.html_url };
  } catch (err) {
    throw wrapError("createPullRequest", err);
  }
}

/**
 * Delete a branch (git ref).
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.branch - Branch name (without refs/heads/ prefix).
 */
export async function deleteBranch(token, { owner, repo, branch }) {
  try {
    await octokit(token).request("DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}", {
      owner,
      repo,
      branch,
    });
  } catch (err) {
    throw wrapError("deleteBranch", err);
  }
}

/**
 * Force-update a branch ref to a new SHA.
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.branch - Branch name (without refs/heads/ prefix).
 * @param {string} options.sha - New commit SHA to point the branch at.
 */
export async function updateBranchRef(token, { owner, repo, branch, sha }) {
  try {
    await octokit(token).request("PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}", {
      owner,
      repo,
      branch,
      sha,
      force: true,
    });
  } catch (err) {
    throw wrapError("updateBranchRef", err);
  }
}

/**
 * List pull requests with optional filters.
 * @param {string} token
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} [options.head] - Filter by head ref (e.g., "username:branch").
 * @param {string} [options.state] - Filter by state ("open", "closed", "all").
 * @returns {Promise<Array<{number: number, title: string, url: string, state: string}>>}
 */
export async function listPullRequests(token, { owner, repo, head, state }) {
  try {
    const params = { owner, repo };
    if (head) params.head = head;
    if (state) params.state = state;
    const { data } = await octokit(token).rest.pulls.list(params);
    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.state,
    }));
  } catch (err) {
    throw wrapError("listPullRequests", err);
  }
}
