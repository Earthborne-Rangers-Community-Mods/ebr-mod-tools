# Contributing to ebr-mod-tools

The mod tools CLI (`ebr`) helps Earthborne Rangers mod creators scaffold, save,
and publish mods without needing to learn git. Contributions that improve the
tooling are welcome.

## Architecture

The codebase is an npm workspaces monorepo split into two layers:

```
packages/
  core/           # Pure business logic
    src/
    tests/
  cli/            # CLI published to npm as ebr-mod-tools (the 'ebr' bin)
    src/
      commands/   # CLI-only layer, one file per command
      cli.js      # Commander setup and entry point
```

**Core functions** (`packages/core/src/`) take an options object, do work, and return a
result or throw a typed error. They never read from stdin, write to stdout, or
call `process.exit()`.

**CLI commands** (`packages/cli/src/commands/`) are thin wrappers that collect user input,
call core functions, and format terminal output.

This split keeps the same business logic available to both the CLI and any
graphical tools built on top of the library. Do not put terminal I/O in
`packages/core/src/`.

## How to Contribute

1. Fork this repository
2. Create a feature branch from `main`
3. Make your changes
4. Run `npm test` and verify all tests pass
5. Open a pull request against `main`

### What We Accept

- Bug fixes
- Improvements to error messages and user guidance
- New catalog entries for official products or campaigns
- Documentation improvements

### What Requires Discussion First

Open an issue before working on:

- New commands or subcommands
- Changes to the core/commands architecture
- Dependency additions or upgrades
- Changes to manifest schema validation

## Testing

If you're changing anything in core logic, you probably need to add or change some tests as well.

- Core logic (`packages/core/src/`) is tested with Vitest
- Tests live in `packages/core/tests/`
- Run tests: `npm test`
- Watch mode: `npm run test:watch`
- Every core function should have corresponding test coverage
- CLI commands (`packages/cli/src/commands/`) are not unit tested

## Code Style

- Plain JavaScript (ESM modules)
- Typed errors (`packages/core/src/errors.js`) for distinct failure modes - callers
  branch on error type, not message strings
- Core functions accept an optional `{ onProgress }` callback for status
  reporting
- No `process.exit()` in `packages/core/src/`

## Commit Messages

Use clear, descriptive commit messages.

## Questions

Open a GitHub issue for questions about the codebase or contribution process.
