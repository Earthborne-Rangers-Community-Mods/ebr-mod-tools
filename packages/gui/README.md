# ebr-mod-tools-gui

The desktop app for Earthborne Rangers mod creators. It is an Electron GUI front
end over the workspace `core` package.

## Architecture

- **Build tool:** electron-vite (main and renderer built to `out/`).
- **Renderer:** a plain Svelte SPA. Runs with `nodeIntegration: true`,
  `contextIsolation: false`, and `sandbox: false`, so it shares a Node.js
  context and imports the workspace `core` package directly, calling core
  functions inline. There is no preload bridge. This is safe because the window
  loads only first-party, bundled content and blocks navigation; external or
  untrusted markup must never be rendered here without sanitization and
  isolation.
- **Main process:** creates the window and handles window creation, navigation
  blocking, and external-link-to-shell handling only - no core logic.
- **Renderer dependency interop:** electron-vite inlines core's source into the
  renderer bundle, but core's Node runtime deps and Node built-ins stay external.
  Because Chromium's module loader cannot resolve bare specifiers from an ES
  module, `vite-plugin-electron-renderer` rewrites those external imports into
  CommonJS `require()` calls, which the node-integrated renderer resolves at runtime.
- **Packaging:** electron-builder targets Windows (NSIS) and macOS (dmg). The
  GUI declares a runtime dependency on the private `core` workspace package, so
  electron-builder's production-dependency collection copies core and its
  transitive runtime deps into the packaged app, where the renderer's `require()`
  calls resolve them.

```
packages/gui/
  electron.vite.config.mjs   # electron-vite build config (+ renderer CSP)
  electron-builder.yml       # Windows + macOS packaging config
  src/
    main/index.js            # Electron main process entry (window + guards)
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

# Build main and renderer into out/
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
