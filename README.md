# ebr-mod-tools

A Node.js CLI for Earthborne Rangers mod creators. Wraps native `git` with EBR-specific ergonomics so mod creators don't need to remember git incantations.

Each mod creator forks `ebr-mod-base-content` once - this is their **mod workspace**. Each mod is a **branch** within that fork (`mod/<mod-id>`). A second fork of `ebr-mod-registry` is used for publishing. One fine-grained PAT scoped to both forks covers all current and future mods.

## Installation

```bash
npm install
npm link
```

Requires: **Node.js** (LTS), **git**, **GitHub account** (for publishing).

## Commands

| Command | Description | Phase |
|---|---|---|
| `ebr setup` | Set up GitHub forks and fine-grained PAT for publishing | 1 |
| `ebr new` | Scaffold a new mod as a branch in your fork of `ebr-mod-base-content` | 1 |
| `ebr save` | Bump version, stage allowed files, commit, and push | 1 |
| `ebr publish` | Submit or update the mod in the registry via GitHub PR | 1 |
| `ebr include <source>` | Merge base campaign updates or another mod into the current mod | 2 |
| `ebr validate` | Check wikilink resolution, orphan files, manifest correctness | 3 |
| `ebr update` | Check included mods for newer versions and merge updates | 3 |

## Getting Started

1. **`ebr setup`** - One-time setup. Walks you through forking `ebr-mod-base-content` (your mod workspace) and `ebr-mod-registry` (for publishing), creating a fine-grained PAT scoped to those two forks, and setting your default author name and Discord handle.
2. **`ebr new my-mod`** - Clones your fork into `my-mod/`, creates a `mod/<mod-id>` branch, and scaffolds `ebr-mod.json`.
3. **Edit content in Obsidian.**
4. **`ebr save`** - Stages, commits, and pushes. Auto-sets the upstream tracking branch on first push.
5. **`ebr publish`** - Validates the manifest, checks mod ID ownership against the registry, and opens a PR to the registry.

## Documentation

- [Mod Manifest (`ebr-mod.json`)](docs/manifest.md) - field reference, examples, and validation rules

## Architecture

The codebase is split into two layers so the same logic could power both a CLI and a GUI:

```
src/
  core/             # Pure business logic - no process.exit, no console.log, no prompts
    workflows.js    # High-level mod lifecycle workflows (scaffold, save, publish)
    git.js          # Git operations wrapper (simple-git)
    github.js       # GitHub API wrapper (@octokit/rest)
    manifest.js     # Read/write/validate ebr-mod.json
    config.js       # Token, fork URL, and author defaults storage (~/.ebr/)
    catalogs.js     # Official campaign and product catalogs
    registry.js     # Registry entry building and validation
    errors.js       # Typed error classes
    index.js        # Barrel export for all core functions
  commands/         # CLI-only layer - prompts, output formatting, error display
    setup.js         # Guides fork setup, fine-grained PAT, and author defaults >> stores via core/config.js
    new.js          # Prompts user -> calls core/workflows.scaffoldMod -> clones fork, creates branch
    save.js         # Prompts for version/message -> calls core/workflows.saveMod
    publish.js      # Calls core/workflows.publishMod -> mod ID check, opens PR
    include.js
    validate.js
    update.js
  cli.js            # Commander setup and entry point
```

**Core functions** accept an options object and return results or throw typed errors. They never prompt for input, write to stdout, or call `process.exit()`. They accept an optional `onProgress` callback.

**CLI commands** are thin wrappers that collect input via prompts, call core functions, and format output.

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

3. **GitHub account** - required for `ebr publish` (token-based auth, guided on first run)

### Build & Run

```powershell
# Install dependencies
npm install

# Run any command directly
node src/cli.js --help

# Or link globally for the 'ebr' command
npm link
ebr --help
```

### Unlink

```powershell
npm unlink -g ebr-mod-tools
```

### Testing

Tests use [Vitest](https://vitest.dev/). Test driven development recommended for core files. Every `src/core/` module has a corresponding test in `tests/core/`.

```powershell
# Run all tests once
npm test

# Watch mode (re-runs on file changes)
npm run test:watch
```
