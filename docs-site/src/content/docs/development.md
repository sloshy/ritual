---
title: 'Development'
description: Set up the repository, run from source, and use the dev workflow, test suite, and pre-commit hook.
---

How to set up the project for local development and contribute to the codebase.

## Prerequisites

- [Bun](https://bun.sh) 1.4.4, the version `.bun-version` pins for CI and the Docker build
- Node.js 22.12 or newer (for the Starlight docs site)

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/sloshy/ritual.git
cd ritual
bun install
```

## Running Locally

Run commands directly without building:

```bash
bun run index.ts --help
bun run index.ts new deck "Test Deck"
```

When run this way (via `bun` rather than the compiled `ritual` binary), [`admin`](/commands/admin/) and [`serve --build`](/commands/serve/) rebuild their SPA bundles from `src/` on startup. No flag is needed. The compiled binary serves the pre-bundled assets baked into it.

## Dev Workflow

For iterative work on the `admin` interface or the static site:

```bash
bun run dev admin --refresh never   # auto-restart `admin`
bun run dev serve --refresh never   # auto-restart `serve --build`
```

This launches `scripts/dev.ts`, which:

- Spawns `bun index.ts <subcommand>` as a child process. For `serve`, it appends `--build` when absent.
- Watches `src/` (TypeScript, TSX, CSS, SVG) and, for `serve`, `decks/`, `collections/`, and `wanted/` (Markdown).
- Fully restarts the child on any change, so edits to **any** part of the codebase (core logic, server handlers, parsers, SPA, themes) take effect on the next request. Running from source, `admin` and `serve --build` rebuild their CSS and SPA bundle on each start. There is no separate compile step; the gitignored `*.compiled.*` artifacts are only used by the compiled binary.
- **Live-reloads the browser** (`admin` only, source mode). The page holds an `EventSource` to a dev-only `/__dev_reload` endpoint carrying the server's boot id, and reloads when that id changes (a real restart), not on every reconnect. The restarted server rebuilds `styles.css`/`app.js`, and the reload refetches them.
- Catches changes the OS file watcher drops. `fs.watch` can miss events under bursts (a formatter touching many files, "save all", atomic-rename saves). The orchestrator snapshots the watched tree at each build launch and re-checks it in a ~1s background scan; if any file drifted, the child restarts.

Extra arguments are forwarded to the underlying command:

```bash
bun run dev admin --port 9090 --theme boros
bun run dev serve --decks "Atraxa Superfriends" --price-sources tcgplayer
```

If `--base-dir <path>` is passed for `serve`, the watcher uses that base directory's data folders.

The dev orchestrator is a source-tree-only tool, not part of the compiled binary. Press `q` or `Ctrl+C` to stop it; the child process and its port are released before it exits.

### Answering cache prompts

The orchestrator owns the terminal, so the child cannot read interactive prompts such as the "Card cache is N days old, refresh?" prompt under the default `--refresh ask`. `bun run dev` therefore **requires** an explicit `--refresh` mode and fails fast without one:

```bash
bun run dev serve --refresh auto     # refresh stale cache (bulk download allowed)
bun run dev serve --refresh no-bulk  # refresh prices per-card, no bulk download
bun run dev serve --refresh never    # use the existing cache as-is
```

The same applies to `bun run dev admin`. The flag is forwarded to [`serve`](/commands/serve/) / [`admin`](/commands/admin/) and behaves as documented there. `--refresh ask` does **not** count, since it restates the prompting default. `--no-input` also satisfies the check, because the child then skips the refresh instead of prompting. For day-to-day work use `--refresh never`. To refresh the Scryfall cache, use `--refresh auto` on the next restart or run `ritual cache preload-all` separately.

## Building

Create a compiled binary:

```bash
bun run build
```

This produces a `ritual` executable in the project root.

Every network surface of a running Ritual offers its source: the public site's footer, the admin's navigation, and the MCP server's instructions all link to the repository at the exact version (see [License and Attribution](/attribution/#source-code)). A fork sets `RITUAL_SOURCE_URL` to its own repository when it builds, so the link leads to the modified source, as the AGPL asks:

```bash
RITUAL_SOURCE_URL=https://github.com/you/ritual bun run build
```

The value must be an `http(s)` URL. The links take the form `<url>/tree/<tag or commit>`, which GitHub, GitLab, Gitea, and Forgejo all serve. The Docker build takes it as a build argument (`--build-arg RITUAL_SOURCE_URL=…`), and `scripts/build-docker.sh` passes it through.

To regenerate only the bundled front-end assets and the generated modules the type check reads (`src/generated/`: licenses and baked locales), without the slower `--compile` step:

```bash
bun run build:assets
```

`bun run test`, `bun run verify`, and `test:e2e` use this lighter build. Only `test:it`, which exercises the binary, builds the full executable.

## Testing

This project uses `bun test`.

### Local check suite

`bun run test` runs the whole-repo checks to run before pushing (**type check, lint, and unit tests**) concurrently, with an assets-only build:

```bash
bun run test
```

Unit tests run with `--parallel` (one worker per core), the type check is Bun's native checker (`bun check`), and lint uses `--concurrency auto` plus `--cache`, so repeat runs take a few seconds. It does **not** check formatting; use `bun run check-format` or `bun run verify` for that.

### Integration Tests

Run the integration tests, which build the binary and drive it, the servers, and the file system end to end:

```bash
bun run test:it
```

### Playwright Tests

The browser tests build the public site from a synthetic workspace, start it and the admin site, and drive both in Chromium. Install the browser once, then run them:

```bash
bunx playwright install chromium
bun run test:e2e
```

## Project Structure

```
ritual/
├── index.ts              # CLI entry point
├── src/
│   ├── cli/              # CLI framework: program, options, output, prompts
│   ├── commands/         # CLI command implementations (registry.ts is the command table)
│   │   └── session/      # Interactive card-session TUI: loop, menus, prompts, per-list strategies
│   ├── card/             # Card-line grammar, printings, finishes, labels
│   ├── list/             # Deck / collection / wanted list files and sidecars
│   ├── changes/          # Change events and the .changes.md changelog
│   ├── pricing/          # Price and sell reports
│   ├── config/           # ritual.config.json schema and base directory
│   ├── scryfall/, cache/ # Scryfall API integration and the card cache
│   ├── importers/        # Deck importers
│   ├── list-view/, editor/, ui/  # Shared SPA model, editor, and component kit
│   ├── site/, admin/     # Public site and admin site (+ HTTP API)
│   └── mcp/, skills/     # Agent-facing surfaces
├── test/
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── e2e/              # Playwright tests
├── scripts/              # Build, dev, install, lint, and release scripts
├── docs-site/            # This documentation (Starlight)
├── .github/workflows/    # CI (ci.yml, build-binaries.yml), release.yml, docs deploy
├── decks/                # Deck files (Markdown)
├── cache/                # Card cache
└── dist/                 # Generated static site
```

## Code Style

This project formats with `bun fmt`, Bun's Prettier-compatible formatter, which reads `.prettierrc` and `.prettierignore` (and skips everything in `.gitignore`). The type check is `bun check`; the `typescript` package stays installed only for ESLint and editors.

```bash
bun run format        # Format all files
bun run check-format  # Check formatting
```

For format-on-save, point your editor at `bun fmt` or at any Prettier-compatible formatter; both read the same `.prettierrc`.

## Pre-commit Hook

A [Husky](https://typicode.github.io/husky/) `pre-commit` hook runs `bun run precommit` before each commit:

```bash
bun run precommit     # Hook: lint/format STAGED files; build + typecheck + unit tests over the project
bun run verify        # Full: lint/format the ENTIRE repo (use before pushing / in CI)
```

Both commands, and `bun run test`, share one orchestrator (`scripts/precommit.ts`) that runs the checks concurrently. The assets-only build runs alongside the build-independent checks (lint, unit tests, staged-scoped format). Only the type check, which reads the build-generated modules, waits for the build.

One build-independent check is the **message-catalog validator** (`scripts/check-locales.ts`). It validates every file in `locales/` against the English catalog: placeholders, plural categories, length budgets. It runs in all three modes, so a broken translation cannot be committed. Run it alone while working on a locale:

```bash
bun run scripts/check-locales.ts --report
```

See [Localization → Contributing a locale](/localization/#contributing-a-locale).

How the three modes differ:

- `bun run precommit` and `bun run test` add `--cache` to lint for a fast local loop. `bun run verify` runs lint **cold**, because type-aware rules can return a stale pass for a file whose type dependencies changed but whose own contents did not.
- `bun run precommit` scopes **lint** and **format** to the staged files. The build, type check, and unit tests still run over the whole project. When no `.js`/`.ts`/`.tsx` files are staged, only the staged files' format check, the message-catalog check, and the untranslated-baseline guard run.
- `bun run verify` lints and formats the entire repository. Run it before pushing to catch drift in files a commit did not touch; CI runs it on every pull request.

> **Note:** the hook checks the working-tree version of staged files. If you stage only part of a file (`git add -p`), the unstaged remainder is included in lint/format. Run `bun run verify` for an airtight whole-repo check.

## Repository Lints

`bun run lint:repo` runs the linters that cover what ESLint and `bun fmt` do not: [shellcheck](https://www.shellcheck.net/) over `scripts/*.sh`, [actionlint](https://github.com/rhysd/actionlint) over the workflows, [hadolint](https://github.com/hadolint/hadolint) over the `Dockerfile`, and [typos](https://github.com/crate-ci/typos) over everything. `scripts/tools.sh` downloads each one, at the version CI uses, into `.tools/` on first run (Linux and macOS). A word typos flags that is deliberate, such as a search prefix a test types, goes in `_typos.toml`.

## Continuous Integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

| Job                 | What it runs                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Verify              | `bun run verify`                                                                                                                |
| Integration tests   | `bun run test:it`                                                                                                               |
| Playwright          | `bun run test:e2e` in Chromium; the HTML report is uploaded when it fails                                                       |
| Docs site           | The Starlight build, whose link validator fails on a broken internal link                                                       |
| Repository lints    | `bun run lint:repo`                                                                                                             |
| Docker image builds | `docker build` of the `Dockerfile`, without pushing                                                                             |
| Binaries            | All six release binaries, cross-compiled on Linux, then each started on its own OS and architecture (`scripts/smoke-binary.sh`) |

## Releasing

A release is published by pushing its tag; `.github/workflows/release.yml` does the rest.

1. In one commit, set `version` in `package.json` to the new version and move the `Unreleased` notes in `CHANGELOG.md` under a `## [X.Y.Z] - <date>` heading.
2. Tag that commit `vX.Y.Z` (`vX.Y.Z-rc1` and the like for a prerelease) and push the tag.

The workflow refuses a tag that disagrees with `package.json`, and a stable release without a `CHANGELOG.md` section (a prerelease without one gets GitHub's generated notes). It then runs the CI gates, builds and smoke-tests the binaries with the tag's version, records a provenance attestation for each, and attaches the binaries and their `.sha256` files to a **draft** release. Only once everything is attached is the release published, so the installers and `ritual self-update` never see a release without its binaries. The Docker image is pushed last: tagged with the version, plus `X.Y` and `X` for a stable release (no bare `X` while the version is 0.x, where a minor release may break), and `latest` only for a stable release.

A release you drafted for the tag beforehand, for example to write its notes by hand, is filled in and published as it stands. A failed run is re-run from the Actions page.
