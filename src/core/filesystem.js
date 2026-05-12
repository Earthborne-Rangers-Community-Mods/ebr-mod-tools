/**
 * Path and filesystem helpers shared across workflows.
 *
 * Pure utilities.
 * Anything that's specific to a single workflow (e.g. scaffold name token
 * substitution) belongs in that workflow's module instead.
 */

import { readdir, realpath } from "node:fs/promises";
import { join, dirname, posix, relative, isAbsolute, sep } from "node:path";

/**
 * Recursively list files in a directory, returning POSIX paths relative
 * to `root`. Filters out:
 *   - immediate children of `root` whose name is in `skipTopLevelDirs`
 *     (used to exclude `.git`),
 *   - any file whose basename is in `skipFiles` (at any depth).
 *
 * @param {string} root - Directory to walk.
 * @param {object} [options]
 * @param {string[]} [options.skipTopLevelDirs] - Top-level dir names to drop.
 * @param {string[]} [options.skipFiles] - File basenames to drop at any depth.
 * @returns {Promise<string[]>} Repo-relative POSIX paths.
 */
export async function listFilesRecursive(root, { skipTopLevelDirs = [], skipFiles = [] } = {}) {
  const skipDirSet = new Set(skipTopLevelDirs);
  const skipFileSet = new Set(skipFiles);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (skipFileSet.has(entry.name)) continue;
    // `parentPath` is the absolute directory containing the entry. Convert
    // to a POSIX path relative to `root` so the result is platform-stable.
    const relDir = relative(root, entry.parentPath);
    if (relDir) {
      const segments = relDir.split(sep);
      // Drop entries under any top-level dir we were told to skip.
      if (skipDirSet.has(segments[0])) continue;
      out.push(posix.join(...segments, entry.name));
    } else {
      out.push(entry.name);
    }
  }
  return out;
}

/**
 * Strip path-traversal characters from a string so it's safe to use as a
 * single path segment after substitution. Replaces `/`, `\\`, and NUL with
 * `-`, then rejects names that resolve to `.`, `..`, or any string that
 * would still be interpreted as a parent reference (e.g. `..foo`, which
 * `path.relative` treats as starting with `..`).
 *
 * @param {string} raw
 * @returns {string} - The sanitized segment, or "" if no safe value remains.
 */
export function sanitizePathSegment(raw) {
  if (typeof raw !== "string") return "";
  // Replace separators and NUL with dashes so the segment can't escape its
  // intended folder, but otherwise preserve user characters (spaces,
  // unicode, punctuation) for legibility in the file tree.
  const cleaned = raw.replace(/[\\/\0]/g, "-").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  // Reject anything that *starts* with `..` -- the input may have been
  // `../escape` (collapsed to `..-escape`), and even though `..-escape` is
  // technically a valid directory name, accepting it here would couple the
  // safety guarantee to whatever `path.relative` does with the result.
  if (cleaned.startsWith("..")) return "";
  return cleaned;
}

/**
 * Resolve a directory's real path; falls back to the input on failure so
 * callers don't have to special-case missing dirs.
 */
export async function realPathSafe(dir) {
  try {
    return await realpath(dir);
  } catch {
    return dir;
  }
}

/**
 * Resolve a destination path's real location for containment checks, even
 * when the destination itself does not exist yet. Walks up to the nearest
 * existing ancestor, calls `realpath` on it, then re-joins the missing
 * tail. This catches the case where an intermediate directory is a symlink
 * pointing outside the intended root.
 */
export async function realPathOfDestination(absDest) {
  const segments = [];
  let current = absDest;
  // Climb until `realpath` succeeds (or we hit the filesystem root).
  while (true) {
    try {
      const real = await realpath(current);
      return segments.length === 0 ? real : join(real, ...segments);
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // Reached the root with nothing resolvable; fall back to the
        // lexical path. The downstream `isPathInside` check still
        // refuses anything outside the intended root.
        return absDest;
      }
      segments.unshift(current.slice(parent.length).replace(/^[\\/]/, ""));
      current = parent;
    }
  }
}

/**
 * Test whether `child` resolves to a path inside `parent`. Both paths must
 * be absolute. Uses `path.relative` plus a separator-aware `..` check to
 * avoid prefix-string false positives in either direction (e.g. `/foo` vs
 * `/foobar`, or a child whose first segment legitimately starts with `..`).
 */
export function isPathInside(child, parent) {
  const rel = relative(parent, child);
  if (!rel) return true; // child === parent
  if (rel === "..") return false;
  if (rel.startsWith(".." + sep)) return false;
  // On Windows, `path.relative` may return forward-slash mixed output for
  // some inputs; cover that too.
  if (sep !== "/" && rel.startsWith("../")) return false;
  if (isAbsolute(rel)) return false;
  return true;
}
