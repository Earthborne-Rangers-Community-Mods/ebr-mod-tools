/**
 * Reactive store for the creator's list of open mods. The list of mod
 * directories persists to localStorage so it survives between sessions; the
 * display fields (name, type, version, icon) are read fresh from each mod's
 * ebr-mod.json on disk. Only the directory path is durable - the manifest is the
 * source of truth for everything else.
 */
import { readManifest, ManifestNotFoundError } from "core";
import type { RawManifest } from "core/types.js";
import { dirname } from "node:path";

const STORAGE_KEY = "ebr-gui:open-mods";
const LAST_DIR_KEY = "ebr-gui:last-open-dir";

type ModEntry = {
  dir: string;
  status: "loading" | "ready" | "error";
  manifest: RawManifest | null;
  error: string | null;
};

/**
 * Read the persisted list of mod directories. Accepts both the current shape
 * (array of strings) and defends against anything malformed by returning [].
 */
function loadDirs(): string[] {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const item of parsed) {
    const dir = typeof item === "string" ? item : item?.dir;
    if (typeof dir === "string" && dir && !seen.has(dir)) {
      seen.add(dir);
      dirs.push(dir);
    }
  }
  return dirs;
}

/**
 * Persist the list of mod directories. Swallows storage failures (private mode,
 * disabled storage) - the list simply will not survive the session.
 */
function persistDirs(dirs: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dirs));
  } catch {
    // Storage unavailable - persistence is best-effort.
  }
}

/**
 * Read the persisted directory of the last opened mod (used to seed the open
 * picker at its parent folder). Returns null when unset or storage is
 * unavailable.
 */
function loadLastOpenDir(): string | null {
  try {
    const raw = localStorage.getItem(LAST_DIR_KEY);
    return typeof raw === "string" && raw ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Persist the last opened mod directory to seed the next open picker.
 * Best-effort.
 */
function persistLastOpenDir(dir: string): void {
  try {
    localStorage.setItem(LAST_DIR_KEY, dir);
  } catch {
    // Storage unavailable - persistence is best-effort.
  }
}

/**
 * A manifest is openable in the GUI only if it carries a non-empty string `id`:
 * the app keys mod navigation off `manifest.id` (`get(id)`, `navigation.go`). An
 * id-less manifest (hand-edited or a partial write) is surfaced as a broken
 * entry rather than a "ready" card that silently cannot be opened.
 */
function hasUsableId(manifest: RawManifest): boolean {
  return typeof manifest.id === "string" && manifest.id.length > 0;
}

class OpenMods {
  entries = $state<ModEntry[]>([]);
  /** Directory of the most recently opened mod; seeds the open picker. */
  lastOpenDir = $state(loadLastOpenDir());
  #initialized = false;

  /**
   * Folder the open picker should default to: the parent of the last opened mod,
   * so a fresh open starts alongside it rather than at the OS default. undefined
   * when nothing is remembered yet.
   */
  get pickerDefaultPath(): string | undefined {
    return this.lastOpenDir ? dirname(this.lastOpenDir) : undefined;
  }

  /** Load persisted directories and read each manifest. Runs once. */
  init() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.entries = loadDirs().map((dir) => ({
      dir,
      status: "loading",
      manifest: null,
      error: null,
    }));
    for (const entry of this.entries) {
      this.#loadEntry(entry);
    }
  }

  async #loadEntry(entry: ModEntry) {
    try {
      const manifest = await readManifest(entry.dir);
      entry.manifest = manifest;
      if (hasUsableId(manifest)) {
        entry.status = "ready";
        entry.error = null;
      } else {
        entry.status = "error";
        entry.error = null;
      }
    } catch (err) {
      entry.manifest = null;
      entry.status = "error";
      entry.error = (err as Error)?.message ?? null;
    }
  }

  #persist() {
    persistDirs(this.entries.map((entry) => entry.dir));
  }

  /**
   * Remember where a just-opened mod lives so the next open picker starts in its
   * parent folder.
   */
  #rememberOpenDir(dir: string) {
    if (typeof dir === "string" && dir) {
      this.lastOpenDir = dir;
      persistLastOpenDir(dir);
    }
  }

  /**
   * @returns Whether the directory is already in the list.
   */
  has(dir: string): boolean {
    return this.entries.some((entry) => entry.dir === dir);
  }

  /**
   * Add a mod directory to the list after confirming it holds a valid manifest.
   * @param dir - Absolute path to a mod directory.
   */
  async add(dir: string): Promise<{ ok: true; dir: string; already?: boolean; manifest?: RawManifest } | { ok: false; reason: string; message?: string }> {
    if (!dir) return { ok: false, reason: "no-dir" };
    if (this.has(dir)) {
      this.#rememberOpenDir(dir);
      return { ok: true, dir, already: true };
    }
    let manifest;
    try {
      manifest = await readManifest(dir);
    } catch (err) {
      const reason = err instanceof ManifestNotFoundError ? "not-found" : "unreadable";
      return { ok: false, reason, message: (err as Error)?.message };
    }
    // A readable but id-less manifest is added as a broken entry (it cannot be
    // opened, since navigation keys off the id), mirroring the hydration path.
    const entry: ModEntry = hasUsableId(manifest)
      ? { dir, status: "ready", manifest, error: null }
      : { dir, status: "error", manifest, error: null };
    this.entries = [...this.entries, entry];
    this.#persist();
    this.#rememberOpenDir(dir);
    return { ok: true, dir, manifest };
  }

  remove(dir: string) {
    this.entries = this.entries.filter((entry) => entry.dir !== dir);
    this.#persist();
  }

  /**
   * Look up a loaded mod by its manifest id.
   */
  get(id: string): ModEntry | null {
    return this.entries.find((entry) => entry.manifest?.id === id) ?? null;
  }
}

export const openMods = new OpenMods();
