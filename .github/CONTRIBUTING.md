# Contributing to ebr-mod-tools

The mod tools help Earthborne Rangers mod creators scaffold, save, and publish
mods without needing to learn git. They ship in two forms that share the same
core logic: the `ebr` command-line tool and a cross-platform desktop app (the
creator GUI). Contributions that improve either are welcome.

## Architecture

The codebase is an npm workspaces monorepo split into layers:

```
packages/
  core/           # Pure business logic (shared by the CLI and the GUI)
    src/
    tests/
  cli/            # CLI published to npm as ebr-mod-tools (the 'ebr' bin)
    src/
      commands/   # CLI-only layer, one file per command
      cli.js      # Commander setup and entry point
  gui/            # Electron desktop app (electron-vite + Svelte 5)
    messages/     # UI strings (inlang message format, compiled by paraglide-js)
    src/
      main/       # Electron main process
      renderer/   # Plain Svelte SPA that imports core directly
    tests/        # Security-critical pure-function tests (no UI tests)
```

**Core functions** (`packages/core/src/`) take an options object, do work, and return a
result or throw a typed error. They never read from stdin, write to stdout, or
call `process.exit()`.

**CLI commands** (`packages/cli/src/commands/`) are thin wrappers that collect user input,
call core functions, and format terminal output.

**The GUI** (`packages/gui`) is an Electron desktop app whose Svelte renderer
imports `core` directly and calls the same functions the CLI does. No business
logic is duplicated in the GUI. Its user-facing strings are localized and not
hardcoded.

This split keeps the same business logic available to both the CLI and the
desktop GUI. Do not put terminal I/O in `packages/core/src/`.

## How to Contribute

1. Fork this repository
2. Create a feature branch from `main`
3. Make your changes
4. Run `npm test` and `npm run check` (type checking) and verify both pass
5. Open a pull request against `main`

### What We Accept

- Bug fixes
- Improvements to error messages and user guidance
- New catalog entries for official products or campaigns
- Translations of the GUI into new languages
- Documentation improvements

### What Requires Discussion First

Open an issue before working on:

- New commands or subcommands
- Changes to the core/commands architecture
- Dependency additions or upgrades
- Changes to manifest schema validation

## Testing

If you're changing anything in core logic, you probably need to add or change some tests as well.

- Core logic (`packages/core/src/`) is tested with Vitest; tests live in `packages/core/tests/`
- The GUI has Vitest coverage for security-critical, pure functions only (e.g. `packages/gui/tests/`); its Svelte components and Electron app shell are not unit tested (no UI tests)
- `npm test` at the repo root runs every workspace's tests (core and GUI)
- Watch mode: `npm run test:watch`
- Every core function should have corresponding test coverage
- CLI commands (`packages/cli/src/commands/`) are not unit tested

## Type Checking

The codebase is plain JavaScript, type-checked with TypeScript in `checkJs` mode
via JSDoc annotations - there are no authored `.ts` files. `packages/core` and
`packages/cli` are checked with `tsc --noEmit` (each has a `tsconfig.json` with
`allowJs`, `checkJs`, and `strict`); `packages/gui` is checked with `svelte-check`.

- `npm run check` at the repo root type-checks every workspace
- `npm run check --workspace packages/<name>` checks one package
- Keep JSDoc types accurate as you change code, and run `npm run check` before
  opening a PR - the check must be clean (0 errors)
- Shared domain types live in `packages/core/src/types.js` (JSDoc `@typedef`s,
  no runtime code)

## Code Style

- Plain JavaScript (ESM modules), type-checked with `checkJs` via JSDoc (no
  authored `.ts` files)
- Typed errors (`packages/core/src/errors.js`) for distinct failure modes - callers
  branch on error type, not message strings
- Core functions accept an optional `{ onProgress }` callback for status
  reporting
- No `process.exit()` in `packages/core/src/`
- GUI code is Svelte 5; the renderer imports `core` directly and must not
  duplicate business logic
- User-facing GUI strings live in `packages/gui/messages/*.json` (inlang message
  format), not hardcoded in components

## Commit Messages

Use clear, descriptive commit messages.

## Questions

Open a GitHub issue for questions about the codebase or contribution process.
