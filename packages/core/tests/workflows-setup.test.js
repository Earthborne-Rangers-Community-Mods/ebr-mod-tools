import { describe, it, expect, vi } from "vitest";
import { forkOwnerFromUrl, forkUrlFor, resolveCredentialLogin, ensureFork } from "../src/workflows.js";

// --- forkOwnerFromUrl ---

describe("forkOwnerFromUrl", () => {
  it("extracts the owner from an HTTPS fork URL", () => {
    expect(forkOwnerFromUrl("https://github.com/SunberryKeeper/ebr-mod-registry")).toBe("SunberryKeeper");
  });

  it("handles a trailing .git suffix", () => {
    expect(forkOwnerFromUrl("https://github.com/user/ebr-mod-registry.git")).toBe("user");
  });

  it("handles an SSH URL", () => {
    expect(forkOwnerFromUrl("git@github.com:user/ebr-mod-registry.git")).toBe("user");
  });

  it("returns null for a non-GitHub URL", () => {
    expect(forkOwnerFromUrl("https://gitlab.com/user/repo")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(forkOwnerFromUrl(null)).toBeNull();
  });
});

// --- forkUrlFor ---

describe("forkUrlFor", () => {
  it("builds an HTTPS fork URL", () => {
    expect(forkUrlFor("user", "ebr-mod-registry")).toBe("https://github.com/user/ebr-mod-registry");
  });
});

// --- resolveCredentialLogin ---

describe("resolveCredentialLogin", () => {
  it("returns the login of the borrowed credential", async () => {
    const borrowTokenImpl = vi.fn(async () => "ghs_borrowed");
    const getUserImpl = vi.fn(async () => ({ login: "CredUser" }));

    const login = await resolveCredentialLogin({ borrowTokenImpl, getUserImpl });

    expect(login).toBe("CredUser");
    expect(getUserImpl).toHaveBeenCalledWith("ghs_borrowed");
  });

  it("returns null when no credential can be borrowed", async () => {
    const borrowTokenImpl = vi.fn(async () => null);
    const getUserImpl = vi.fn();

    const login = await resolveCredentialLogin({ borrowTokenImpl, getUserImpl });

    expect(login).toBeNull();
    expect(getUserImpl).not.toHaveBeenCalled();
  });

  it("returns null when the borrowed token cannot resolve a login", async () => {
    const borrowTokenImpl = vi.fn(async () => "ghs_borrowed");
    const getUserImpl = vi.fn(async () => { throw new Error("bad credentials"); });

    const login = await resolveCredentialLogin({ borrowTokenImpl, getUserImpl });

    expect(login).toBeNull();
  });

  it("returns null when GET /user resolves without a login field", async () => {
    const borrowTokenImpl = vi.fn(async () => "ghs_borrowed");
    const getUserImpl = vi.fn(async () => ({}));

    const login = await resolveCredentialLogin({ borrowTokenImpl, getUserImpl });

    expect(login).toBeNull();
  });

  it("is a passive probe by default and threads the interactive flag through", async () => {
    const borrowTokenImpl = vi.fn(async () => "ghs_borrowed");
    const getUserImpl = vi.fn(async () => ({ login: "CredUser" }));

    // Default: passive - never prompts.
    await resolveCredentialLogin({ borrowTokenImpl, getUserImpl });
    expect(borrowTokenImpl).toHaveBeenLastCalledWith(expect.objectContaining({ interactive: false }));

    // Opt-in: interactive - allow the helper to prompt for a sign-in.
    await resolveCredentialLogin({ interactive: true, borrowTokenImpl, getUserImpl });
    expect(borrowTokenImpl).toHaveBeenLastCalledWith(expect.objectContaining({ interactive: true }));
  });
});

// --- ensureFork ---

describe("ensureFork", () => {
  const base = { owner: "org", repo: "ebr-mod-registry", login: "user" };

  it("short-circuits when the fork already exists", async () => {
    const remoteExistsImpl = vi.fn(async () => true);
    const borrowTokenImpl = vi.fn();
    const forkRepoImpl = vi.fn();

    const result = await ensureFork({
      ...base,
      deps: { remoteExistsImpl, borrowTokenImpl, forkRepoImpl },
    });

    expect(result).toEqual({ forkUrl: "https://github.com/user/ebr-mod-registry", status: "exists" });
    expect(borrowTokenImpl).not.toHaveBeenCalled();
  });

  it("creates the fork via the borrowed credential", async () => {
    const remoteExistsImpl = vi.fn(async () => false);
    const borrowTokenImpl = vi.fn(async () => "ghs_borrowed");
    const forkRepoImpl = vi.fn(async () => ({ owner: "user", repo: "ebr-mod-registry" }));

    const result = await ensureFork({
      ...base,
      deps: { remoteExistsImpl, borrowTokenImpl, forkRepoImpl },
    });

    expect(result).toEqual({ forkUrl: "https://github.com/user/ebr-mod-registry", status: "created" });
    expect(forkRepoImpl).toHaveBeenCalledWith("ghs_borrowed", { owner: "org", repo: "ebr-mod-registry" });
  });

  it("reports manual status when no credential can be borrowed", async () => {
    const remoteExistsImpl = vi.fn(async () => false);
    const borrowTokenImpl = vi.fn(async () => null);
    const forkRepoImpl = vi.fn();

    const result = await ensureFork({
      ...base,
      deps: { remoteExistsImpl, borrowTokenImpl, forkRepoImpl },
    });

    expect(result).toEqual({ forkUrl: "https://github.com/user/ebr-mod-registry", status: "manual" });
    expect(forkRepoImpl).not.toHaveBeenCalled();
  });

  it("reports manual status when the borrowed-credential fork fails", async () => {
    const remoteExistsImpl = vi.fn(async () => false);
    const borrowTokenImpl = vi.fn(async () => "ghs_borrowed");
    const forkRepoImpl = vi.fn(async () => { throw new Error("no repo-creation scope"); });

    const result = await ensureFork({
      ...base,
      deps: { remoteExistsImpl, borrowTokenImpl, forkRepoImpl },
    });

    // The credential path was attempted; its failure falls through to manual.
    expect(forkRepoImpl).toHaveBeenCalledWith("ghs_borrowed", { owner: "org", repo: "ebr-mod-registry" });
    expect(result).toEqual({ forkUrl: "https://github.com/user/ebr-mod-registry", status: "manual" });
  });
});
