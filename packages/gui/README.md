# ebr-mod-tools-gui

The desktop app for Earthborne Rangers mod creators. It is an Electron GUI front
end over the workspace `core` package.

## Architecture

- **Build tool:** electron-vite (main, preload, and renderer built to `out/`).
- **Renderer:** a plain Svelte SPA. Runs with `contextIsolation: true`,
  `nodeIntegration: false`, and `sandbox: true`.
- **Main process:** creates the hardened application window (context isolation,
  sandbox, external-link and navigation guards).
- **IPC:** a preload `contextBridge` exposes the renderer-facing API surface on
  `window.ebr`.
- **Packaging:** electron-builder targets Windows (NSIS) and macOS (dmg). The
  GUI declares a runtime dependency on the private `core` workspace package, so
  electron-builder's production-dependency collection copies core and its
  transitive runtime deps into the packaged app, so the main process resolves
  them at runtime.

```
packages/gui/
  electron.vite.config.mjs   # electron-vite build config (+ renderer CSP)
  electron-builder.yml       # Windows + macOS packaging config
  src/
    main/index.js            # Electron main process entry (hardened window)
    preload/index.js         # contextBridge bridge (renderer <-> main)
    renderer/
      index.html             # Renderer entry (SPA)
      src/
        main.js              # Svelte mount
        App.svelte           # Root component
```

## Commands

Run from the repo root or with `-w packages/gui`.

```powershell
# Run the app in development (HMR)
npm run dev --workspace packages/gui

# Build main, preload, and renderer into out/
npm run build --workspace packages/gui

# Preview the production build
npm run preview --workspace packages/gui

# Build installers (electron-vite build, then electron-builder)
npm run package --workspace packages/gui        # current platform
npm run package:win --workspace packages/gui    # Windows (NSIS)
npm run package:mac --workspace packages/gui     # macOS (dmg)
```

## Tech stack

| Component | Choice |
|---|---|
| Build tool | electron-vite |
| UI framework | Svelte 5 (plain SPA) |
| Runtime | Electron |
| Packaging | electron-builder |

## Troubleshooting

**`npm run dev` fails with `Error: Electron uninstall` (from `getElectronPath`).**
electron-vite cannot find Electron's binary: `node_modules/electron/dist/` and
`node_modules/electron/path.txt` are missing. This means Electron's `postinstall`
(which downloads the ~100 MB platform binary) did not complete during
`npm install`. Re-run the download:

```powershell
npm rebuild electron
```
