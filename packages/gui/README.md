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
  blocking, and external-link-to-shell handling. It also exposes a minimal IPC
  surface for native tasks the node-integrated renderer cannot reach directly.
- **Design system:** `src/renderer/src/app.css` holds the shared visual language
  ported from `ebr-mod-manager` - CSS design tokens, the light and dark palettes
  (`data-theme` plus a `prefers-color-scheme` fallback), and base component
  styles. The self-hosted fonts (Josefin Sans, Inter) and icon set live under
  `src/renderer/src/assets/` and are bundled by Vite (fingerprinted, referenced
  with relative paths so they resolve under `file://` in the packaged app).
- **Renderer dependency interop:** electron-vite inlines core's source into the
  renderer bundle, but core's Node runtime deps and Node built-ins stay external.
  Because Chromium's module loader cannot resolve bare specifiers from an ES
  module, `vite-plugin-electron-renderer` rewrites those external imports into
  CommonJS `require()` calls, which the node-integrated renderer resolves at runtime.
- **Localization:** user-facing strings come from `messages/en.json` (inlang
  message format). The `@inlang/paraglide-js` Vite plugin compiles them into
  typed message functions under `src/renderer/src/lib/paraglide/` at build and dev time.
  Components import them as `import * as m from "../lib/paraglide/messages.js"` and call
  `m.key()` (or `m.key({ param })` for interpolated strings). At present, the app only
  ships the `en` locale.
- **Packaging:** electron-builder targets Windows (NSIS) and macOS (dmg). The
  GUI declares a runtime dependency on the private `core` workspace package, so
  electron-builder's production-dependency collection copies core and its
  transitive runtime deps into the packaged app, where the renderer's `require()`
  calls resolve them.

```
packages/gui/
  electron.vite.config.mjs   # electron-vite build config
  electron-builder.yml       # Windows + macOS packaging config
  svelte.config.mjs          # Svelte config (preprocess) - used by svelte-check
  tsconfig.json              # TypeScript config for svelte-check
  messages/
    en.json                  # UI strings (inlang message format)
  project.inlang/
    settings.json            # inlang project config (baseLocale en)
  src/
    main/index.ts            # Electron main process entry (window + guards)
    renderer/
      index.html             # Renderer entry (SPA)
      src/
        main.ts              # Svelte mount (imports app.css)
        app.css              # Portable design system: tokens, fonts, base styles
        App.svelte           # Shell: renders the active page full-width
        assets/
          fonts/             # Self-hosted Josefin Sans + Inter (woff2)
          icons/             # Shared icon set (app icon, favicon, logos)
        components/          # Shared controls used by multiple pages
        lib/
          navigation.svelte.ts  # In-memory route state
          mods.svelte.ts        # Open-mods store (localStorage + on-disk manifests)
          platform.ts           # Main-process bridge (picker, external launch, reveal folder)
          paraglide/            # Generated message functions
        pages/
          MyMods.svelte           # Mod list + account header
          Setup.svelte            # Credential/fork/author setup
          NewMod.svelte           # New-mod creation form
          ModDetails.svelte       # Manifest field editor
          ConflictResolution.svelte  # Per-file merge resolver
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

# Type-check the renderer + main with svelte-check
npm run check --workspace packages/gui

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
| Localization | inlang message format + `@inlang/paraglide-js` |

## Troubleshooting

**`npm run dev` fails with `Error: Electron uninstall` (from `getElectronPath`).**
electron-vite cannot find Electron's binary: `node_modules/electron/dist/` and
`node_modules/electron/path.txt` are missing. This means Electron's `postinstall`
(which downloads the ~100 MB platform binary) did not complete during
`npm install`. Re-run the download:

```powershell
npm rebuild electron
```
