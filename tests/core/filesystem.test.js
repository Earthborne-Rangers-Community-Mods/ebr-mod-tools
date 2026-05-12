import { describe, it, expect, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { tmpdir } from "node:os";

import {
  isPathInside,
  listFilesRecursive,
  realPathOfDestination,
  realPathSafe,
  sanitizePathSegment,
} from "../../src/core/filesystem.js";

// --- sanitizePathSegment ---
//
// Security-critical: sanitizes user-supplied strings before they are used as
// path segments.

describe("sanitizePathSegment", () => {
  it("returns normal strings unchanged", () => {
    expect(sanitizePathSegment("My Custom Campaign")).toBe("My Custom Campaign");
    expect(sanitizePathSegment("river-valley")).toBe("river-valley");
    expect(sanitizePathSegment("Spire in Bloom")).toBe("Spire in Bloom");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizePathSegment("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizePathSegment("   ")).toBe("");
  });

  it("returns empty string for non-string inputs", () => {
    expect(sanitizePathSegment(null)).toBe("");
    expect(sanitizePathSegment(undefined)).toBe("");
    expect(sanitizePathSegment(42)).toBe("");
    expect(sanitizePathSegment({})).toBe("");
  });

  it("returns empty string for '.' and '..'", () => {
    expect(sanitizePathSegment(".")).toBe("");
    expect(sanitizePathSegment("..")).toBe("");
  });

  it("returns empty string for strings starting with '..'", () => {
    // '../escape' -> replace '/' -> '..-escape' -> starts with '..' -> rejected.
    expect(sanitizePathSegment("../escape")).toBe("");
    expect(sanitizePathSegment("..foo")).toBe("");
    expect(sanitizePathSegment("..-escape")).toBe("");
    expect(sanitizePathSegment("..\\escape")).toBe("");
  });

  it("replaces forward slashes with dashes", () => {
    expect(sanitizePathSegment("foo/bar")).toBe("foo-bar");
    expect(sanitizePathSegment("a/b/c")).toBe("a-b-c");
  });

  it("replaces backslashes with dashes", () => {
    expect(sanitizePathSegment("foo\\bar")).toBe("foo-bar");
    expect(sanitizePathSegment("C:\\Users\\name")).toBe("C:-Users-name");
  });

  it("replaces NUL characters with dashes", () => {
    expect(sanitizePathSegment("foo\0bar")).toBe("foo-bar");
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizePathSegment("  spaced  ")).toBe("spaced");
  });

  it("preserves internal spaces and standard punctuation", () => {
    expect(sanitizePathSegment("Mon Mod")).toBe("Mon Mod");
    expect(sanitizePathSegment("Garn's Quest")).toBe("Garn's Quest");
  });

  it("preserves unicode characters", () => {
    expect(sanitizePathSegment("Refuge des \u00d4urs")).toBe("Refuge des \u00d4urs");
    expect(sanitizePathSegment("\u5c71\u306e\u5bbf")).toBe("\u5c71\u306e\u5bbf");
    expect(sanitizePathSegment("caf\u00e9 na\u00efve")).toBe("caf\u00e9 na\u00efve");
  });
});

// --- isPathInside ---
//
// Security-critical: guards against a stamped destination escaping the mod
// repo root via symlinks or path traversal.

describe("isPathInside", () => {
  // Use a fixed-looking absolute path as the anchor; isPathInside only
  // calls path.relative, so the directories do not need to exist.
  const base = join(tmpdir(), "ebr-is-path-inside-base");

  it("returns true when child equals parent", () => {
    expect(isPathInside(base, base)).toBe(true);
  });

  it("returns true for a direct child", () => {
    expect(isPathInside(join(base, "child"), base)).toBe(true);
  });

  it("returns true for a deeply nested path", () => {
    expect(isPathInside(join(base, "a", "b", "c"), base)).toBe(true);
  });

  it("returns false for the parent's own parent", () => {
    expect(isPathInside(dirname(base), base)).toBe(false);
  });

  it("returns false for a sibling path that shares a prefix with parent", () => {
    // A naive prefix-string check would mistake '/foo/bar' for being inside
    // '/foo' even when the child is actually '/foobar'. path.relative avoids
    // this, but the test keeps it explicit.
    expect(isPathInside(base + "-sibling", base)).toBe(false);
    expect(isPathInside(join(base + "-sibling", "nested"), base)).toBe(false);
  });

  it("returns false for a path that escapes via '..'", () => {
    // join() normalises away the '..', placing the result outside base.
    const outside = join(base, "..", "escape");
    expect(isPathInside(outside, base)).toBe(false);
  });

  it("returns false for a path two levels above parent", () => {
    const way_out = join(base, "..", "..", "escape");
    expect(isPathInside(way_out, base)).toBe(false);
  });

  it("returns true for a child whose name legitimately starts with '..' (Round 3 fix)", () => {
    // '..-escape' is a valid directory name inside base. The old buggy check
    // (rel.startsWith("..") without separator) would have returned false here.
    // The corrected check (rel === ".." || rel.startsWith(".." + sep)) must
    // NOT reject it.
    expect(isPathInside(join(base, "..-escape"), base)).toBe(true);
    expect(isPathInside(join(base, "..-escape", "deep"), base)).toBe(true);
  });
});

// --- listFilesRecursive ---
//
// Walks a directory tree and returns POSIX-relative paths. The most important
// direct-test value over the integration tests is confirming the POSIX
// separator guarantee on Windows and the nested-dir skip boundary.

describe("listFilesRecursive", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const dir = cleanup.pop();
      try { await rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  async function makeDir() {
    const dir = await mkdtemp(join(tmpdir(), "ebr-lfs-"));
    cleanup.push(dir);
    return dir;
  }

  it("returns an empty array for an empty directory", async () => {
    const dir = await makeDir();
    expect(await listFilesRecursive(dir)).toEqual([]);
  });

  it("returns a top-level file as a bare name", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "file.md"), "x");
    expect(await listFilesRecursive(dir)).toEqual(["file.md"]);
  });

  it("returns nested files with POSIX separators regardless of platform", async () => {
    const dir = await makeDir();
    await mkdir(join(dir, "subdir"));
    await writeFile(join(dir, "subdir", "nested.md"), "x");
    const files = await listFilesRecursive(dir);
    expect(files).toContain("subdir/nested.md");
    // On Windows, path.sep is '\\'. Confirm no backslash leaks into results.
    if (sep === "\\") {
      expect(files.every((f) => !f.includes("\\"))).toBe(true);
    }
  });

  it("skips top-level dirs named in skipTopLevelDirs", async () => {
    const dir = await makeDir();
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(dir, "real.md"), "x");
    const files = await listFilesRecursive(dir, { skipTopLevelDirs: [".git"] });
    expect(files).toEqual(["real.md"]);
  });

  it("does NOT skip a same-named dir nested below the top level", async () => {
    // skipTopLevelDirs matches only immediate children of root; a '.git'
    // folder inside 'src' must pass through.
    const dir = await makeDir();
    await mkdir(join(dir, "src", ".git"), { recursive: true });
    await writeFile(join(dir, "src", ".git", "config"), "x");
    await writeFile(join(dir, "src", "module.md"), "x");
    const files = await listFilesRecursive(dir, { skipTopLevelDirs: [".git"] });
    expect(files).toContain("src/.git/config");
    expect(files).toContain("src/module.md");
  });

  it("skips files matching skipFiles at any depth", async () => {
    const dir = await makeDir();
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "README.md"), "top readme");
    await writeFile(join(dir, "sub", "README.md"), "nested readme");
    await writeFile(join(dir, "sub", "content.md"), "real");
    const files = await listFilesRecursive(dir, { skipFiles: ["README.md"] });
    expect(files).toEqual(["sub/content.md"]);
  });

  it("handles multiple files at multiple depths with both skip options", async () => {
    const dir = await makeDir();
    await mkdir(join(dir, ".git"));
    await mkdir(join(dir, "a"));
    await writeFile(join(dir, ".git", "HEAD"), "x");
    await writeFile(join(dir, ".gitkeep"), "x");
    await writeFile(join(dir, "a", ".gitkeep"), "x");
    await writeFile(join(dir, "a", "real.md"), "x");
    const files = await listFilesRecursive(dir, {
      skipTopLevelDirs: [".git"],
      skipFiles: [".gitkeep"],
    });
    expect(files).toEqual(["a/real.md"]);
  });
});

// --- realPathSafe ---
//
// Falls back to the input when realpath fails. The integration tests cover the
// "dir exists" path; this covers the "dir does not exist" fallback.

describe("realPathSafe", () => {
  it("falls back to the input path for a non-existent directory", async () => {
    const nonExistent = join(tmpdir(), "ebr-does-not-exist-" + Date.now());
    const result = await realPathSafe(nonExistent);
    expect(result).toBe(nonExistent);
  });
});

// --- realPathOfDestination ---
//
// Walks up to the nearest existing ancestor and re-joins the missing tail.
// The symlink escape case is impractical to test portably (Windows requires
// elevated privileges for symlinks); the integration tests cover the live
// path. This test confirms the function resolves correctly when only the
// parent exists.

describe("realPathOfDestination", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const dir = cleanup.pop();
      try { await rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("resolves a path whose parent exists but the file itself does not", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ebr-rpd-"));
    cleanup.push(dir);
    const dest = join(dir, "missing.md");
    const result = await realPathOfDestination(dest);
    expect(basename(result)).toBe("missing.md");
  });

  it("resolves a path whose parent directories do not yet exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ebr-rpd-"));
    cleanup.push(dir);
    const dest = join(dir, "new", "deep", "file.md");
    const result = await realPathOfDestination(dest);
    expect(basename(result)).toBe("file.md");
  });
});
