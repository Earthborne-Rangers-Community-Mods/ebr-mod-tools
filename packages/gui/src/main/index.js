import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { join } from "node:path";
import { isAllowedExternalUrl } from "./url-allowlist.js";

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

function sameOrigin(a, b) {
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
  const options = { properties: ["openDirectory"] };
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
