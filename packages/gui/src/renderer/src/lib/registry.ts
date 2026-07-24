/**
 * Session-scoped cache of the public mod registry for the creator GUI.
 *
 * `fetchRegistry` (core) hits raw.githubusercontent on every call. This module
 * fetches it once and reuses the parsed result for a short TTL.
 */
import { fetchRegistry } from "core";
import type { Registry, RegistryEntry } from "core/types.js";

/** How long a fetched registry stays fresh before the next access refetches. */
const TTL_MS = 15 * 60 * 1000;

let cached: { registry: Registry; fetchedAt: number } | null = null;
/** Shared in-flight fetch, deduping concurrent callers. */
let inflight: Promise<Registry> | null = null;
/** Monotonic id of the most recent fetch; only it may write the cache. */
let latestRequestId = 0;

/**
 * Get the parsed registry, served from the cache when still fresh. Concurrent
 * callers share a single in-flight fetch. Throws on fetch/parse failure, the
 * same as `fetchRegistry`.
 * @param options.force - Bypass the freshness check and refetch.
 * @returns The parsed registry (`{ mods: [...] }`).
 */
export async function getRegistry({ force = false }: { force?: boolean } = {}): Promise<Registry> {
  if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.registry;
  }
  if (!force && inflight) return inflight;

  const requestId = ++latestRequestId;
  const request = fetchRegistry().then((registry) => {
    // Only the most recent request writes the cache, so an older request (one a
    // forced refresh or a cache-clear has since superseded) settling late
    // cannot pin a stale snapshot for the full TTL.
    if (requestId === latestRequestId) {
      cached = { registry, fetchedAt: Date.now() };
    }
    return registry;
  });
  inflight = request;
  // Clear the in-flight handle once settled, but only if a newer request has
  // not already replaced it.
  request.finally(() => {
    if (inflight === request) inflight = null;
  });
  return request;
}

/**
 * Courtesy uniqueness check for a proposed mod id against the cached registry.
 * Never throws: a fetch failure degrades to `unverified` so the caller can proceed.
 * @param id - Proposed kebab-case mod id.
 */
export async function checkModId(id: string): Promise<{ status: "available" | "claimed" | "unverified"; entry?: RegistryEntry; error?: unknown }> {
  let registry;
  try {
    registry = await getRegistry();
  } catch (error) {
    return { status: "unverified", error };
  }
  const entry = registry?.mods?.find((mod) => mod.id === id);
  return entry ? { status: "claimed", entry } : { status: "available" };
}

/** Drop the cached registry so the next `getRegistry()` refetches. */
export function clearRegistryCache(): void {
  cached = null;
  inflight = null;
  // Bump the generation so any request still in flight will not repopulate the
  // cache; the next getRegistry() then starts a fresh fetch.
  latestRequestId++;
}
