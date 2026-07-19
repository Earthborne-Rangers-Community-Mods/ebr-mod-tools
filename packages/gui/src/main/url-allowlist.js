/**
 * Scheme allowlist for URLs the renderer asks the main process to launch in the
 * OS shell.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "obsidian:"]);

/**
 * @param {unknown} url
 * @returns {boolean} Whether the URL may be handed to `shell.openExternal`.
 */
export function isAllowedExternalUrl(url) {
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
