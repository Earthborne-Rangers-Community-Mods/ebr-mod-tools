import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Octokit mock (hoisted so vi.mock factory can reference it) ---

const mocks = vi.hoisted(() => ({
  getAuthenticated: vi.fn(),
  createFork: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    this.rest = {
      users: { getAuthenticated: mocks.getAuthenticated },
      repos: { createFork: mocks.createFork },
    };
  }),
}));

import {
  getAuthenticatedUser,
  forkRepo,
  normalizeGithubUrl,
  parseCredentialFill,
  borrowCredentialToken,
  clearCredential,
} from "../src/github.js";
import {
  GithubError,
  AuthenticationError,
} from "../src/errors.js";

// --- Helpers ---

/** Simulate an Octokit API error with an HTTP status code. */
function makeApiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Build a runImpl mock that returns a fixed subprocess result. */
function fakeRun(result) {
  return vi.fn(async () => result);
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
    mocks.createFork.mockRejectedValue(
      makeApiError("Bad credentials", 401)
    );

    await expect(
      forkRepo(TOKEN, { owner: "x", repo: "y" })
    ).rejects.toThrow(AuthenticationError);
  });

  it("preserves the operation name on GithubError", async () => {
    mocks.createFork.mockRejectedValue(makeApiError("Server Error", 500));

    const err = await forkRepo(TOKEN, { owner: "x", repo: "y" }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.operation).toBe("forkRepo");
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

// --- Local git credential helpers ---

describe("parseCredentialFill", () => {
  it("parses key=value lines", () => {
    const out = parseCredentialFill("protocol=https\nhost=github.com\nusername=x\npassword=ghs_secret\n");
    expect(out).toEqual({
      protocol: "https",
      host: "github.com",
      username: "x",
      password: "ghs_secret",
    });
  });

  it("keeps '=' characters in the value", () => {
    const out = parseCredentialFill("password=a=b=c\n");
    expect(out.password).toBe("a=b=c");
  });

  it("ignores blank lines and lines without '='", () => {
    const out = parseCredentialFill("\nhost=github.com\ngarbage\n\n");
    expect(out).toEqual({ host: "github.com" });
  });
});

describe("borrowCredentialToken", () => {
  it("returns the password field from a successful credential fill", async () => {
    const runImpl = fakeRun({ code: 0, stdout: "username=x\npassword=ghs_borrowed\n", stderr: "" });
    const token = await borrowCredentialToken({ runImpl });
    expect(token).toBe("ghs_borrowed");
  });

  it("feeds a read-only fill request to git credential", async () => {
    const runImpl = fakeRun({ code: 0, stdout: "password=t\n", stderr: "" });
    await borrowCredentialToken({ runImpl, host: "github.com" });
    expect(runImpl).toHaveBeenCalledWith("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
    });
    // Read-only contract: exactly one `git credential fill`, never approve/reject.
    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(runImpl).not.toHaveBeenCalledWith("git", ["credential", "approve"], expect.anything());
    expect(runImpl).not.toHaveBeenCalledWith("git", ["credential", "reject"], expect.anything());
  });

  it("runs a non-interactive fill in passive mode", async () => {
    const runImpl = fakeRun({ code: 0, stdout: "password=t\n", stderr: "" });
    await borrowCredentialToken({ runImpl, host: "github.com", interactive: false });
    // Passive probe: tell the helper not to prompt (no sign-in dialog).
    expect(runImpl).toHaveBeenCalledWith("git", ["-c", "credential.interactive=false", "credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
    });
    // Still read-only: exactly one fill, never approve/reject.
    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(runImpl).not.toHaveBeenCalledWith("git", ["credential", "approve"], expect.anything());
    expect(runImpl).not.toHaveBeenCalledWith("git", ["credential", "reject"], expect.anything());
  });

  it("returns null when the fill exits non-zero", async () => {
    const runImpl = fakeRun({ code: 1, stdout: "", stderr: "no helper" });
    expect(await borrowCredentialToken({ runImpl })).toBeNull();
  });

  it("returns null when no password is present", async () => {
    const runImpl = fakeRun({ code: 0, stdout: "username=x\n", stderr: "" });
    expect(await borrowCredentialToken({ runImpl })).toBeNull();
  });

  it("returns null when the runner throws", async () => {
    const runImpl = vi.fn(async () => { throw new Error("spawn failed"); });
    expect(await borrowCredentialToken({ runImpl })).toBeNull();
  });
});

describe("clearCredential", () => {
  it("erases the credential with git credential reject", async () => {
    const runImpl = fakeRun({ code: 0, stdout: "", stderr: "" });
    const ok = await clearCredential({ runImpl, host: "github.com" });
    expect(ok).toBe(true);
    expect(runImpl).toHaveBeenCalledWith("git", ["credential", "reject"], {
      input: "protocol=https\nhost=github.com\n\n",
    });
    // Clearing never reads the credential back (no fill).
    expect(runImpl).not.toHaveBeenCalledWith("git", ["credential", "fill"], expect.anything());
  });

  it("returns false when reject exits non-zero", async () => {
    const runImpl = fakeRun({ code: 1, stdout: "", stderr: "no helper" });
    expect(await clearCredential({ runImpl })).toBe(false);
  });

  it("returns false when the runner throws", async () => {
    const runImpl = vi.fn(async () => { throw new Error("spawn failed"); });
    expect(await clearCredential({ runImpl })).toBe(false);
  });
});
