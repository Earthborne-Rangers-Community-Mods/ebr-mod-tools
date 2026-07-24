/**
 * Scheme allowlist for URLs the renderer asks the main process to launch in the
 * OS shell.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "obsidian:"]);

/**
 * @returns Whether the URL may be handed to `shell.openExternal`.
 */
export function isAllowedExternalUrl(url: unknown): boolean {
  if (typeof url !== "string") {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}
