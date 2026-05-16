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

| Command | Description |
|---|---|
| `ebr setup` | Set up GitHub forks and fine-grained PAT for publishing |
| `ebr new` | Scaffold a new mod as a branch in your fork of `ebr-mod-base-content` |
| `ebr save` | Bump version, stage allowed files, commit, and push |
| `ebr publish` | Submit or update the mod in the registry via GitHub PR |
| `ebr include <source>` | Merge base campaign updates or another mod into the current mod |
| `ebr scaffold [branch]` | Stamp a reusable template (map locations + pivotal cards, path sets, etc.) into the current mod. Interactive picker when branch omitted. |
| `ebr validate` | Check wikilink resolution, orphan files, manifest correctness |
| `ebr update` | Check included mods for newer versions and merge updates |

## Getting Started

1. **`ebr setup`** - One-time setup. Walks you through forking `ebr-mod-base-content` (your mod workspace) and `ebr-mod-registry` (for publishing), creating a fine-grained PAT scoped to those two forks, and setting your default author name and Discord handle.
2. **`ebr new`** - Type-aware scaffolding. Prompts for universal fields (name, id, author, optional Discord/description/icon/language), asks what type of mod you're creating, then guides you through type-specific questions and auto-stamps relevant scaffolds (see per-type details below).
3. **Edit content in Obsidian.**
4. **`ebr save`** - Stages, commits, and pushes. Auto-sets the upstream tracking branch on first push.
5. **`ebr publish`** - Validates the manifest, checks mod ID ownership against the registry, and opens a PR to the registry.

### `ebr new` by Type

When you run `ebr new`, the tool asks what type of mod you're creating. Each type sets you up differently:

**`campaign`:** Creating a custom campaign from scratch. Pick which official maps you want to support (e.g., Lure of the Valley, Spire in Bloom) and which path sets (The Valley, The Arcology, etc.). The tool scaffolds all the content folders and structure you need for those choices.

**`expansion`:** Adding new content to one or more existing campaigns (e.g., new content on top of Lure of the Valley, like Spire in Bloom does). Tell the tool which campaign(s) you're expanding, and it merges them into your mod so you have their content to build on.

**`enhancement`:** Modifying a campaign directly (e.g., a difficulty modifier, variant rules, or restructuring the mission flow). Pick which campaign(s) you want to enhance (or none if you'll add them later). The tool asks whether your enhancement is safe to add to a campaign in progress. If you say no, it prompts you to write safety notes for players.

**`one-day-mission`:** Creating a one-off session that plays on top of an existing campaign (usually Lure of the Valley). Pick which campaign(s) it pairs with.

**`collection`:** Bundling multiple mods together as a single package (e.g., a creator's complete suite of expansions, or a collaboration with another creator). Add each mod you want to include by id or repo URL. The tool merges them all, combines their campaigns and required products, and asks if you want to include any additional campaigns on top. Players download this one collection and get everything at once.

**`theme`:** Creating a visual reskin (e.g., dark mode, custom color palette). No campaign or product selection needed, just metadata. You'll modify the existing `ebr-symbols.css` and `ebr-styles.css` files directly to customize the look and feel.

## Documentation

- [Mod Manifest (`ebr-mod.json`)](docs/manifest.md) - field reference, examples, and validation rules

## Architecture

The codebase is split into two layers: pure core logic and a CLI wrapper.

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
