# ebr-mod-tools

A Node.js CLI for Earthborne Rangers mod creators. Wraps native `git` with EBR-specific ergonomics so mod creators don't need to remember git incantations.

This documentation is primarily for folks interested in the *codebase* for the EBR mod tools. If you want to make your own mod, see the [modding guide](https://github.com/Earthborne-Rangers-Community-Mods/ebr-mod-manager/blob/main/src/lib/docs/en/modding-guide.md) instead.

## Installation

```bash
npm install
npm run build --workspace packages/cli
npm link --workspace packages/cli
```

Requires: **Node.js** (LTS), **git**, **GitHub account** (for publishing).

## How it works

Under the hood, mods are just git **branches** off of the `ebr-mod-base-content` repository. Each mod creator forks `ebr-mod-base-content` once - this is their **mod workspace**. A fork of `ebr-mod-registry` is used for publishing. The tool uses your existing git credentials on your machine for all content operations.

Mods are published with a manifest file which describes which commit the mod manager should download, along with all the other metadata needed to show the mod details.

## Commands

| Command | Description |
|---|---|
| `ebr setup` | Verify your git credentials and set up your creator forks |
| `ebr new` | Create a new mod as a branch in your fork of `ebr-mod-base-content` |
| `ebr save` | Bump version, stage allowed files, commit, and push. Auto-sets upstream tracking branch on first push. |
| `ebr publish` | Validate manifest, check mod ID ownership against the registry, and open a PR. |
| `ebr include [source...]` | Merge a base campaign or another mod into the current mod. Interactive multi-select picker when source omitted. |
| `ebr scaffold [branch]` | Stamp a reusable template (stubs for map locations + pivotal cards, path sets, etc.) into the current mod. Interactive picker when branch omitted. |
| `ebr validate` | (Not implemented yet.) Check wikilink resolution, orphan files, manifest correctness |
| `ebr update` | Check included mods for newer versions and merge updates |

## Manifest File

The docs on the [Mod Manifest (`ebr-mod.json`)](docs/manifest.md) for details.

## Architecture

`ebr-mod-tools` is an npm workspaces monorepo holding three packages:

- **`packages/core`** - pure business logic (private, never published to npm on its own)
- **`packages/cli`** - the CLI published to npm as `ebr-mod-tools` (the `ebr` bin); esbuild inlines `core` code into `dist/cli.js`, propagates `core`'s dependencies into a generated `dist/package.json`, and publishes from `dist/`
- **`packages/gui`** - the Electron desktop app; imports the workspace `core` package directly

```
packages/
  core/             # Pure business logic - no process.exit, no console.log, no prompts
    src/
      workflows.js  # High-level mod lifecycle workflows (scaffold, save, publish)
      git.js        # Git operations wrapper (simple-git)
      github.js     # GitHub API wrapper (@octokit/rest)
      manifest.js   # Read/write/validate ebr-mod.json
      config.js     # Fork URLs and author defaults storage (~/.ebr/)
      catalogs.js   # Official campaign and product catalogs
      registry.js   # Registry entry building and validation
      errors.js     # Typed error classes
      index.js      # Barrel export for all core functions
  cli/              # CLI-only layer, one script per command
    src/
      commands/
        setup.js
        new.js
        save.js
        publish.js
        include.js
        validate.js
        update.js
      cli.js        # Commander setup and entry point
  gui/              # Electron desktop app (Phase 3)
    src/            # Plain Svelte SPA renderer
```

**Core functions** accept an options object and return results or throw typed errors. They never prompt for input, write to stdout, or call `process.exit()`. They accept an optional `onProgress` callback.

**CLI commands** collect input via prompts, call core functions, and format output.

**The GUI** imports the workspace `core` package directly in the Svelte renderer.

## Tech stack

| Component | Choice |
|---|---|
| Runtime | Node.js |
| CLI framework | commander |
| Git operations | simple-git |
| GitHub API | @octokit/rest |
| CLI prompts | @inquirer/prompts |
| Config storage | Plain JSON in `~/.ebr/` |

## Development Setup

### Prerequisites

1. **Node.js (LTS)**
   - `winget install OpenJS.NodeJS.LTS`
   - After install, restart your terminal and verify: `node --version` and `npm --version`

2. **git**
   - `winget install Git.Git`
   - After install, restart your terminal and verify: `git --version`

3. **GitHub account** - required for `ebr publish`

### Build & Run

```powershell
# Install dependencies
npm install

# Run any command directly from source (no build needed)
node packages/cli/src/cli.js --help

# Or build the self-contained bundle and link the 'ebr' command globally
npm run build --workspace packages/cli
npm link --workspace packages/cli
ebr --help
```

### Unlink

```powershell
npm unlink -g ebr-mod-tools
```

### Testing

Tests use [Vitest](https://vitest.dev/). Test driven development recommended for core files. Every `packages/core/src/` module has a corresponding test in `packages/core/tests/`.

```powershell
# Run all tests once
npm test

# Watch mode (re-runs on file changes)
npm run test:watch
```

### Type checking

The codebase is plain JavaScript, type-checked with TypeScript in `checkJs` mode
(`svelte-check` for the GUI). Types are expressed with JSDoc; there are no
authored `.ts` files. `packages/core` and `packages/cli` are checked with
`tsc --noEmit` (via each package's `tsconfig.json` with `allowJs`, `checkJs`, and
`strict`); `packages/gui` is checked with `svelte-check`.

```powershell
# Type-check every package (core, cli, gui)
npm run check

# Type-check a single package
npm run check --workspace packages/core
npm run check --workspace packages/gui
```
