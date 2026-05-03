import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Octokit mock (hoisted so vi.mock factory can reference it) ---

const mocks = vi.hoisted(() => ({
  getAuthenticated: vi.fn(),
  createFork: vi.fn(),
  getContent: vi.fn(),
  createOrUpdateFileContents: vi.fn(),
  createRef: vi.fn(),
  deleteRef: vi.fn(),
  updateRef: vi.fn(),
  request: vi.fn(),
  pullsCreate: vi.fn(),
  pullsList: vi.fn(),
  reposGet: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    this.request = mocks.request;
    this.rest = {
      users: { getAuthenticated: mocks.getAuthenticated },
      repos: {
        createFork: mocks.createFork,
        getContent: mocks.getContent,
        createOrUpdateFileContents: mocks.createOrUpdateFileContents,
        get: mocks.reposGet,
      },
      git: { createRef: mocks.createRef, deleteRef: mocks.deleteRef, updateRef: mocks.updateRef },
      pulls: { create: mocks.pullsCreate, list: mocks.pullsList },
    };
  }),
}));

import {
  getAuthenticatedUser,
  getRepo,
  forkRepo,
  getFileContent,
  createOrUpdateFileContent,
  createBranch,
  deleteBranch,
  updateBranchRef,
  getRefSha,
  createPullRequest,
  listPullRequests,
  syncFork,
  normalizeGithubUrl,
} from "../../src/core/github.js";
import {
  GithubError,
  GithubFileNotFoundError,
  AuthenticationError,
  InsufficientScopeError,
} from "../../src/core/errors.js";

// --- Helpers ---

/** Simulate an Octokit API error with an HTTP status code. */
function makeApiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const TOKEN = "ghp_test_token_123";

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
});

// --- getAuthenticatedUser ---

describe("getAuthenticatedUser", () => {
  it("returns login and name on success", async () => {
    mocks.getAuthenticated.mockResolvedValue({
      data: { login: "test-user", name: "Test User" },
    });

    const result = await getAuthenticatedUser(TOKEN);
    expect(result).toEqual({ login: "test-user", name: "Test User" });
  });

  it("throws AuthenticationError on 401", async () => {
    mocks.getAuthenticated.mockRejectedValue(
      makeApiError("Bad credentials", 401)
    );

    await expect(getAuthenticatedUser(TOKEN)).rejects.toThrow(
      AuthenticationError
    );
  });

  it("throws GithubError (not AuthenticationError) on other errors", async () => {
    mocks.getAuthenticated.mockRejectedValue(
      makeApiError("Server error", 500)
    );

    const err = await getAuthenticatedUser(TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err).not.toBeInstanceOf(AuthenticationError);
  });
});

// --- getRepo ---

describe("getRepo", () => {
  it("returns repo metadata for a regular repo", async () => {
    mocks.reposGet.mockResolvedValue({
      data: {
        owner: { login: "test-user" },
        name: "ebr-mod-base-content",
        clone_url: "https://github.com/test-user/ebr-mod-base-content.git",
        fork: false,
        parent: null,
      },
    });

    const result = await getRepo(TOKEN, { owner: "test-user", repo: "ebr-mod-base-content" });
    expect(result).toEqual({
      owner: "test-user",
      repo: "ebr-mod-base-content",
      cloneUrl: "https://github.com/test-user/ebr-mod-base-content.git",
      isFork: false,
      parentOwner: null,
      parentRepo: null,
      permissions: { admin: false, push: false, pull: false },
    });
  });

  it("returns fork metadata with parent info", async () => {
    mocks.reposGet.mockResolvedValue({
      data: {
        owner: { login: "test-user" },
        name: "ebr-mod-base-content",
        clone_url: "https://github.com/test-user/ebr-mod-base-content.git",
        fork: true,
        parent: {
          owner: { login: "upstream-org" },
          name: "ebr-mod-base-content",
        },
      },
    });

    const result = await getRepo(TOKEN, { owner: "test-user", repo: "ebr-mod-base-content" });
    expect(result).toEqual({
      owner: "test-user",
      repo: "ebr-mod-base-content",
      cloneUrl: "https://github.com/test-user/ebr-mod-base-content.git",
      isFork: true,
      parentOwner: "upstream-org",
      parentRepo: "ebr-mod-base-content",
      permissions: { admin: false, push: false, pull: false },
    });
  });

  it("throws AuthenticationError on 401", async () => {
    mocks.reposGet.mockRejectedValue(makeApiError("Bad credentials", 401));
    await expect(getRepo(TOKEN, { owner: "x", repo: "y" })).rejects.toThrow(AuthenticationError);
  });

  it("throws GithubError on 404", async () => {
    mocks.reposGet.mockRejectedValue(makeApiError("Not Found", 404));
    const err = await getRepo(TOKEN, { owner: "x", repo: "y" }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("getRepo");
  });
});

// --- forkRepo ---

describe("forkRepo", () => {
  it("creates a fork and returns owner, repo, cloneUrl", async () => {
    mocks.createFork.mockResolvedValue({
      data: {
        owner: { login: "test-user" },
        name: "ebr-mod-registry",
        clone_url: "https://github.com/test-user/ebr-mod-registry.git",
      },
    });

    const result = await forkRepo(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
    });
    expect(result).toEqual({
      owner: "test-user",
      repo: "ebr-mod-registry",
      cloneUrl: "https://github.com/test-user/ebr-mod-registry.git",
    });
    expect(mocks.createFork).toHaveBeenCalledWith({
      owner: "ebr-project",
      repo: "ebr-mod-registry",
    });
  });

  it("passes custom name to allow multiple forks per account", async () => {
    mocks.createFork.mockResolvedValue({
      data: {
        owner: { login: "test-user" },
        name: "my-cool-mod",
        clone_url: "https://github.com/test-user/my-cool-mod.git",
      },
    });

    const result = await forkRepo(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-base-content",
      name: "my-cool-mod",
    });
    expect(result).toEqual({
      owner: "test-user",
      repo: "my-cool-mod",
      cloneUrl: "https://github.com/test-user/my-cool-mod.git",
    });
    expect(mocks.createFork).toHaveBeenCalledWith({
      owner: "ebr-project",
      repo: "ebr-mod-base-content",
      name: "my-cool-mod",
    });
  });

  it("returns existing fork without error (idempotent)", async () => {
    // GitHub returns the existing fork info when you call createFork
    // on a repo you've already forked.
    mocks.createFork.mockResolvedValue({
      data: {
        owner: { login: "test-user" },
        name: "ebr-mod-registry",
        clone_url: "https://github.com/test-user/ebr-mod-registry.git",
      },
    });

    const result = await forkRepo(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
    });
    expect(result.owner).toBe("test-user");
    expect(result.repo).toBe("ebr-mod-registry");
  });

  it("throws AuthenticationError on 401", async () => {
    mocks.createFork.mockRejectedValue(
      makeApiError("Bad credentials", 401)
    );

    await expect(
      forkRepo(TOKEN, { owner: "x", repo: "y" })
    ).rejects.toThrow(AuthenticationError);
  });

  it("throws GithubError on other errors", async () => {
    mocks.createFork.mockRejectedValue(makeApiError("Not Found", 404));

    const err = await forkRepo(TOKEN, { owner: "x", repo: "y" }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("forkRepo");
  });
});

// --- syncFork ---

describe("syncFork", () => {
  it("calls merge-upstream API", async () => {
    mocks.request.mockResolvedValue({ data: { merge_type: "fast-forward" } });

    await syncFork(TOKEN, { owner: "test-user", repo: "ebr-mod-registry", branch: "main" });

    expect(mocks.request).toHaveBeenCalledWith("POST /repos/{owner}/{repo}/merge-upstream", {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "main",
    });
  });

  it("throws GithubError on failure", async () => {
    mocks.request.mockRejectedValue(makeApiError("Conflict", 409));

    const err = await syncFork(TOKEN, { owner: "x", repo: "y", branch: "main" }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("syncFork");
  });

  it("throws InsufficientScopeError on 403 with token message", async () => {
    mocks.request.mockRejectedValue(
      makeApiError("Resource not accessible by personal access token", 403),
    );

    const err = await syncFork(TOKEN, { owner: "x", repo: "y", branch: "main" }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientScopeError);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.httpStatus).toBe(403);
  });
});

// --- getFileContent ---

describe("getFileContent", () => {
  it("returns decoded content and sha", async () => {
    const jsonContent = JSON.stringify({ schemaVersion: 1, mods: [] });
    mocks.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(jsonContent).toString("base64"),
        sha: "abc123def456",
      },
    });

    const result = await getFileContent(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      path: "registry.json",
    });
    expect(result.content).toBe(jsonContent);
    expect(result.sha).toBe("abc123def456");
  });

  it("passes ref when specified", async () => {
    mocks.getContent.mockResolvedValue({
      data: {
        content: Buffer.from("{}").toString("base64"),
        sha: "abc",
      },
    });

    await getFileContent(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      path: "registry.json",
      ref: "v1.0.0",
    });

    expect(mocks.getContent).toHaveBeenCalledWith({
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      path: "registry.json",
      ref: "v1.0.0",
    });
  });

  it("omits ref from params when not specified", async () => {
    mocks.getContent.mockResolvedValue({
      data: {
        content: Buffer.from("{}").toString("base64"),
        sha: "abc",
      },
    });

    await getFileContent(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      path: "registry.json",
    });

    expect(mocks.getContent).toHaveBeenCalledWith({
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      path: "registry.json",
    });
  });

  it("throws GithubFileNotFoundError on 404", async () => {
    mocks.getContent.mockRejectedValue(makeApiError("Not Found", 404));

    const err = await getFileContent(TOKEN, {
      owner: "x",
      repo: "y",
      path: "missing.json",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubFileNotFoundError);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("getFileContent");
    expect(err.path).toBe("missing.json");
  });
});

// --- createOrUpdateFileContent ---

describe("createOrUpdateFileContent", () => {
  it("creates a new file (no sha)", async () => {
    mocks.createOrUpdateFileContents.mockResolvedValue({
      data: { commit: { sha: "new-commit-sha" } },
    });

    const result = await createOrUpdateFileContent(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      path: "registry.json",
      content: '{"schemaVersion": 1}',
      message: "Update registry",
    });

    expect(result).toEqual({ commitSha: "new-commit-sha" });
    const call = mocks.createOrUpdateFileContents.mock.calls[0][0];
    expect(call.owner).toBe("test-user");
    expect(call.repo).toBe("ebr-mod-registry");
    expect(call.path).toBe("registry.json");
    expect(call.message).toBe("Update registry");
    // Content should be base64-encoded
    expect(Buffer.from(call.content, "base64").toString("utf-8")).toBe(
      '{"schemaVersion": 1}'
    );
    expect(call).not.toHaveProperty("sha");
  });

  it("updates an existing file with sha", async () => {
    mocks.createOrUpdateFileContents.mockResolvedValue({
      data: { commit: { sha: "updated-sha" } },
    });

    await createOrUpdateFileContent(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      path: "registry.json",
      content: "updated content",
      message: "Update",
      sha: "old-file-sha",
    });

    const call = mocks.createOrUpdateFileContents.mock.calls[0][0];
    expect(call.sha).toBe("old-file-sha");
  });

  it("includes branch when specified", async () => {
    mocks.createOrUpdateFileContents.mockResolvedValue({
      data: { commit: { sha: "commit-sha" } },
    });

    await createOrUpdateFileContent(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      path: "registry.json",
      content: "content",
      message: "Update",
      branch: "publish/my-mod",
    });

    const call = mocks.createOrUpdateFileContents.mock.calls[0][0];
    expect(call.branch).toBe("publish/my-mod");
  });

  it("throws GithubError on failure", async () => {
    mocks.createOrUpdateFileContents.mockRejectedValue(
      makeApiError("Conflict", 409)
    );

    const err = await createOrUpdateFileContent(TOKEN, {
      owner: "x",
      repo: "y",
      path: "f.json",
      content: "c",
      message: "m",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("createOrUpdateFileContent");
  });
});

// --- createBranch ---

describe("createBranch", () => {
  it("creates a git ref from a sha", async () => {
    mocks.createRef.mockResolvedValue({ data: {} });

    await createBranch(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "publish/my-mod",
      sha: "abc123",
    });

    expect(mocks.createRef).toHaveBeenCalledWith({
      owner: "test-user",
      repo: "ebr-mod-registry",
      ref: "refs/heads/publish/my-mod",
      sha: "abc123",
    });
  });

  it("throws GithubError if branch already exists", async () => {
    mocks.createRef.mockRejectedValue(
      makeApiError("Reference already exists", 422)
    );

    const err = await createBranch(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "publish/my-mod",
      sha: "abc123",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("createBranch");
  });
});

// --- deleteBranch ---

describe("deleteBranch", () => {
  it("deletes a git ref", async () => {
    mocks.request.mockResolvedValue({ data: {} });

    await deleteBranch(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "publish/my-mod",
    });

    expect(mocks.request).toHaveBeenCalledWith("DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}", {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "publish/my-mod",
    });
  });

  it("throws GithubError on failure", async () => {
    mocks.request.mockRejectedValue(makeApiError("Not Found", 404));

    const err = await deleteBranch(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "nonexistent",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("deleteBranch");
  });
});

// --- updateBranchRef ---

describe("updateBranchRef", () => {
  it("force-updates a git ref to a new SHA", async () => {
    mocks.request.mockResolvedValue({ data: {} });

    await updateBranchRef(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "publish/my-mod",
      sha: "abc123def456",
    });

    expect(mocks.request).toHaveBeenCalledWith("PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}", {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "publish/my-mod",
      sha: "abc123def456",
      force: true,
    });
  });

  it("throws GithubError on failure", async () => {
    mocks.request.mockRejectedValue(makeApiError("Not Found", 404));

    const err = await updateBranchRef(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "nonexistent",
      sha: "abc123",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("updateBranchRef");
  });

  it("throws InsufficientScopeError on 403 with token message", async () => {
    mocks.request.mockRejectedValue(
      makeApiError("Resource not accessible by personal access token - https://docs.github.com/rest/git/refs#update-a-reference", 403),
    );

    const err = await updateBranchRef(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      branch: "main",
      sha: "abc123",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientScopeError);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.httpStatus).toBe(403);
  });
});

// --- getRefSha ---

describe("getRefSha", () => {
  it("returns the sha for a branch", async () => {
    mocks.request.mockResolvedValue({
      data: { object: { sha: "head-sha-123" } },
    });

    const sha = await getRefSha(TOKEN, {
      owner: "test-user",
      repo: "ebr-mod-registry",
      ref: "main",
    });

    expect(sha).toBe("head-sha-123");
    expect(mocks.request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/git/ref/heads/{branch}",
      { owner: "test-user", repo: "ebr-mod-registry", branch: "main" },
    );
  });

  it("throws GithubError for unknown ref", async () => {
    mocks.request.mockRejectedValue(makeApiError("Not Found", 404));

    await expect(
      getRefSha(TOKEN, { owner: "x", repo: "y", ref: "nonexistent" })
    ).rejects.toThrow(GithubError);
  });
});

// --- createPullRequest ---

describe("createPullRequest", () => {
  it("creates a PR and returns number and url", async () => {
    mocks.pullsCreate.mockResolvedValue({
      data: {
        number: 42,
        html_url:
          "https://github.com/ebr-project/ebr-mod-registry/pull/42",
      },
    });

    const result = await createPullRequest(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      title: "Publish: my-cool-mod v1.0.0",
      body: "Adds my-cool-mod to the registry.",
      head: "test-user:publish/my-cool-mod",
      base: "main",
    });

    expect(result).toEqual({
      number: 42,
      url: "https://github.com/ebr-project/ebr-mod-registry/pull/42",
    });
  });

  it("passes all parameters to the API", async () => {
    mocks.pullsCreate.mockResolvedValue({
      data: { number: 1, html_url: "https://example.com" },
    });

    await createPullRequest(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      title: "Publish: my-mod v2.0.0",
      body: "Updated my-mod.",
      head: "test-user:publish/my-mod",
      base: "main",
    });

    expect(mocks.pullsCreate).toHaveBeenCalledWith({
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      title: "Publish: my-mod v2.0.0",
      body: "Updated my-mod.",
      head: "test-user:publish/my-mod",
      base: "main",
    });
  });

  it("throws GithubError on failure", async () => {
    mocks.pullsCreate.mockRejectedValue(
      makeApiError("Validation Failed", 422)
    );

    const err = await createPullRequest(TOKEN, {
      owner: "x",
      repo: "y",
      title: "t",
      body: "b",
      head: "h",
      base: "main",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("createPullRequest");
  });
});

// --- listPullRequests ---

describe("listPullRequests", () => {
  it("returns matching PRs", async () => {
    mocks.pullsList.mockResolvedValue({
      data: [
        {
          number: 42,
          title: "Publish: my-mod v1.0.0",
          html_url:
            "https://github.com/ebr-project/ebr-mod-registry/pull/42",
          state: "open",
        },
      ],
    });

    const result = await listPullRequests(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      head: "test-user:publish/my-mod",
      state: "open",
    });

    expect(result).toEqual([
      {
        number: 42,
        title: "Publish: my-mod v1.0.0",
        url: "https://github.com/ebr-project/ebr-mod-registry/pull/42",
        state: "open",
      },
    ]);
  });

  it("returns empty array when no PRs match", async () => {
    mocks.pullsList.mockResolvedValue({ data: [] });

    const result = await listPullRequests(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
    });
    expect(result).toEqual([]);
  });

  it("passes filters to the API", async () => {
    mocks.pullsList.mockResolvedValue({ data: [] });

    await listPullRequests(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      head: "test-user:publish/my-mod",
      state: "open",
    });

    expect(mocks.pullsList).toHaveBeenCalledWith({
      owner: "ebr-project",
      repo: "ebr-mod-registry",
      head: "test-user:publish/my-mod",
      state: "open",
    });
  });

  it("omits optional filters when not provided", async () => {
    mocks.pullsList.mockResolvedValue({ data: [] });

    await listPullRequests(TOKEN, {
      owner: "ebr-project",
      repo: "ebr-mod-registry",
    });

    expect(mocks.pullsList).toHaveBeenCalledWith({
      owner: "ebr-project",
      repo: "ebr-mod-registry",
    });
  });
});

// --- Octokit token passing ---

describe("Octokit token passing", () => {
  it("passes the token to the Octokit constructor", async () => {
    const { Octokit } = await import("@octokit/rest");
    mocks.getAuthenticated.mockResolvedValue({
      data: { login: "test", name: "Test" },
    });

    await getAuthenticatedUser("ghp_my_secret_token");

    expect(Octokit).toHaveBeenCalledWith(expect.objectContaining({ auth: "ghp_my_secret_token" }));
  });
});

// --- Error wrapping ---

describe("error wrapping", () => {
  it("wraps 401 as AuthenticationError for any operation", async () => {
    mocks.pullsList.mockRejectedValue(
      makeApiError("Bad credentials", 401)
    );

    await expect(
      listPullRequests(TOKEN, { owner: "x", repo: "y" })
    ).rejects.toThrow(AuthenticationError);
  });

  it("preserves the operation name on GithubError", async () => {
    mocks.request.mockRejectedValue(makeApiError("Server Error", 500));

    const err = await getRefSha(TOKEN, {
      owner: "x",
      repo: "y",
      ref: "main",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("getRefSha");
  });

  it("includes the path in GithubFileNotFoundError message", async () => {
    mocks.getContent.mockRejectedValue(
      makeApiError("Not Found", 404)
    );

    const err = await getFileContent(TOKEN, {
      owner: "x",
      repo: "y",
      path: "f.json",
    }).catch((e) => e);
    expect(err.message).toContain("f.json");
  });
});

// --- normalizeGithubUrl ---

describe("normalizeGithubUrl", () => {
  it("normalizes HTTPS URL with .git suffix", () => {
    expect(normalizeGithubUrl("https://github.com/user/repo.git"))
      .toBe("https://github.com/user/repo");
  });

  it("passes through HTTPS URL without .git suffix", () => {
    expect(normalizeGithubUrl("https://github.com/user/repo"))
      .toBe("https://github.com/user/repo");
  });

  it("converts SSH URL to HTTPS", () => {
    expect(normalizeGithubUrl("git@github.com:user/repo.git"))
      .toBe("https://github.com/user/repo");
  });

  it("converts SSH URL without .git suffix", () => {
    expect(normalizeGithubUrl("git@github.com:user/repo"))
      .toBe("https://github.com/user/repo");
  });

  it("returns null for non-GitHub URLs", () => {
    expect(normalizeGithubUrl("https://gitlab.com/user/repo.git")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizeGithubUrl(null)).toBeNull();
  });

  it("returns null for local paths", () => {
    expect(normalizeGithubUrl("/tmp/bare-repo")).toBeNull();
  });
});
