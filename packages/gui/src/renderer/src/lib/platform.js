/**
 * Thin bridge to main-process capabilities the renderer cannot reach directly.
 */
import { ipcRenderer } from "electron";

/** Public Mod Manager website, opened in the user's external browser. */
export const MOD_MANAGER_URL =
  "https://earthborne-rangers-community-mods.github.io/ebr-mod-manager/";

/**
 * Open the native directory picker.
 * @param {string} [defaultPath] - Folder to open the picker in, if it still exists.
 * @returns {Promise<string|null>} The chosen absolute path, or null if cancelled.
 */
export function pickDirectory(defaultPath) {
  return ipcRenderer.invoke("dialog:pickDirectory", defaultPath);
}

/**
 * Hand a URL to the OS shell (browser or protocol handler). Main enforces a
 * scheme allowlist (http, https, obsidian); anything else is dropped.
 * @param {string} url
 * @returns {Promise<boolean>} Whether the URL was launched.
 */
export function openExternal(url) {
  return ipcRenderer.invoke("shell:openExternal", url);
}

/**
 * Open a mod's vault folder in Obsidian by its absolute path.
 * @param {string} dir - Absolute path to the mod directory.
 * @returns {Promise<boolean>}
 */
export function openInObsidian(dir) {
  return openExternal(`obsidian://open?path=${encodeURIComponent(dir)}`);
}

/**
 * Reveal a folder in the OS file browser.
 * @param {string} dir - Absolute path to the folder to open.
 * @returns {Promise<boolean>} Whether the folder was opened.
 */
export function openPath(dir) {
  return ipcRenderer.invoke("shell:openPath", dir);
}

/**
 * Tell the main process whether the app currently has unsaved edits, so it knows
 * whether to intercept a window-close attempt. Pushed whenever the state changes.
 * @param {boolean} isDirty
 */
export function sendDirty(isDirty) {
  ipcRenderer.send("app:dirty-changed", Boolean(isDirty));
}

/**
 * Register a handler for the main process's "confirm before closing" request
 * (only sent while there are unsaved edits). The handler prompts the user and
 * calls {@link confirmAppClose} to let the close proceed.
 * @param {() => void} handler
 * @returns {() => void} Unsubscribe function.
 */
export function onConfirmClose(handler) {
  ipcRenderer.on("app:confirm-close", handler);
  return () => ipcRenderer.removeListener("app:confirm-close", handler);
}

/** Tell the main process it may now close the window. */
export function confirmAppClose() {
  ipcRenderer.send("app:force-close");
}
