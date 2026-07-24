import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { join } from "node:path";
import { isAllowedExternalUrl } from "./url-allowlist.js";

/** The single main window. */
let mainWindow: BrowserWindow | null = null;
/** Latest unsaved-edits state pushed from the renderer; gates the close guard. */
let hasUnsavedChanges = false;
/** Windows cleared to close programmatically, bypassing the unsaved-edits guard. */
const closeAllowed = new WeakSet();

/**
 * Create the main application window. The renderer runs with nodeIntegration on,
 * contextIsolation off, and sandbox off so it shares a Node.js context and can
 * import the workspace `core` package directly. This is safe because the window
 * loads only first-party, bundled content and blocks navigation; external or
 * untrusted markup must never be rendered here without sanitization and
 * isolation. The main process handles window creation, navigation blocking, and
 * external-link-to-shell handling only.
 */
function createWindow() {
  const window = new BrowserWindow({
    width: 1024,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  mainWindow = window;
  // A fresh window starts with nothing unsaved; only its renderer can raise the
  // flag again. Resetting here means a recreated window (e.g. macOS re-activate)
  // never inherits a stale `true` from the window that closed before it.
  hasUnsavedChanges = false;

  // Guard unsaved edits. We only intercept when the renderer has told us there
  // are unsaved changes, so a broken or not-yet-loaded renderer can never trap
  // the window. When we do intercept, the renderer prompts and calls back via
  // `app:force-close`; membership in `closeAllowed` lets that programmatic close
  // through.
  window.on("close", (event) => {
    if (closeAllowed.has(window) || !hasUnsavedChanges) return;
    event.preventDefault();
    window.webContents.send("app:confirm-close");
  });

  // A crashed renderer can no longer answer the confirm-close prompt, so drop the
  // guard to keep the window closeable.
  window.webContents.on("render-process-gone", () => {
    hasUnsavedChanges = false;
  });

  // Clear per-window state on teardown so nothing leaks into the next window.
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    hasUnsavedChanges = false;
  });

  // Open external links in the user's browser, never inside an Electron window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // electron-vite exposes the dev server URL here in development; the packaged
  // app loads the built renderer from disk.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// Block navigation to any origin other than the app's own dev server. The
// packaged app has no dev URL, so every navigation is blocked there.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL;
    if (!allowed || !sameOrigin(url, allowed)) {
      event.preventDefault();
    }
  });
});

function sameOrigin(a: string, b: string) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

// Renderer-privileged capabilities the node-integrated renderer cannot reach
// directly.
ipcMain.handle("dialog:pickDirectory", async (_event, defaultPath) => {
  const parent = BrowserWindow.getFocusedWindow();
  const options: OpenDialogOptions = { properties: ["openDirectory"] };
  if (typeof defaultPath === "string" && defaultPath) {
    options.defaultPath = defaultPath;
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("shell:openExternal", async (_event, url) => {
  if (!isAllowedExternalUrl(url)) {
    return false;
  }
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    // No registered handler for the scheme (e.g. Obsidian not installed)
    return false;
  }
});

// Reveal a local folder in the OS file browser. Unlike openExternal this takes a
// filesystem path (not a URL), so there is no scheme to allowlist; shell.openPath
// only ever opens the given path in the platform file manager.
ipcMain.handle("shell:openPath", async (_event, dirPath) => {
  if (typeof dirPath !== "string" || !dirPath) {
    return false;
  }
  // shell.openPath resolves to "" on success or an error message on failure.
  const result = await shell.openPath(dirPath);
  return result === "";
});

// The renderer reports whether there are unsaved edits, so the close guard only
// intercepts when there is something to lose.
ipcMain.on("app:dirty-changed", (_event, dirty) => {
  hasUnsavedChanges = Boolean(dirty);
});

// The renderer has finished guarding (saved/discarded) and the window may close.
ipcMain.on("app:force-close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    closeAllowed.add(mainWindow);
    mainWindow.close();
  }
});

app.whenReady().then(() => {
  // Deny every renderer permission request (camera, microphone, geolocation,
  // notifications, etc.); the app needs none of them.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
