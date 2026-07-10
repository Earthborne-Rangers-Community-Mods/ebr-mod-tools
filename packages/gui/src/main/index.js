import { app, BrowserWindow, session, shell } from "electron";
import { join } from "node:path";

/**
 * Create the main application window with a hardened webPreferences profile:
 * context isolation on, node integration off, sandbox on. The renderer reaches
 * the main process only through the preload contextBridge.
 */
function createWindow() {
  const window = new BrowserWindow({
    width: 1024,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  // Open external links in the user's browser, never inside an Electron window.
  // Only http(s) URLs are handed to the OS shell; any other scheme is dropped so
  // a compromised renderer cannot trigger arbitrary external protocol handlers.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
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
