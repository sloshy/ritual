---
title: 'Development'
---

This guide covers how to set up the project for local development and contribute to the codebase.

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.0 or higher)
- Node.js 20+ (for the Starlight docs site)

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/sloshy/ritual.git
cd ritual
bun install
```

## Running Locally

You can run commands directly without building:

```bash
bun run index.ts --help
bun run index.ts new deck "Test Deck"
```

When invoked this way (i.e. via `bun` rather than the compiled `ritual` binary), both [`admin`](/commands/admin/) and [`serve --build`](/commands/serve/) rebuild their SPA bundles from `src/` on startup. No flag is needed — the source-tree path is selected automatically. The compiled binary serves the pre-bundled assets baked into it.

## Dev Workflow

For iterative development of the `admin` interface or the static site, use:

```bash
bun run dev admin --refresh never   # auto-restart `admin`
bun run dev serve --refresh never   # auto-restart `serve --build`
```

This launches `scripts/dev.ts`, which:

- Spawns `bun index.ts <subcommand>` as a child process. For `serve`, the orchestrator appends `--build` automatically when absent — a restart loop over a server that never rebuilds would be pointless.
- Watches `src/` (TypeScript, TSX, CSS, SVG) and — for `serve` — `decks/`, `collections/`, and `wanted/` (Markdown).
- On any change, fully restarts the child process so updates to **any** part of the codebase (core logic, server handlers, parsers, SPA, themes, etc.) take effect on the next request. Running from source, `admin` and `serve --build` rebuild their CSS and SPA bundle from `src/` on each (re)start — there is no separate compile step to run, and the gitignored `*.compiled.*` artifacts are only used by the compiled binary.
- **Live-reloads the browser** (`admin` only, source mode). The served page holds an `EventSource` to a dev-only `/__dev_reload` endpoint that carries the server's boot id; the page reloads when that id changes (a real restart), not on every reconnect, so an idle-timeout drop never triggers a spurious reload. The restarted server rebuilds `styles.css`/`app.js` from source, and the reload refetches them.
- Catches changes even when the OS file watcher drops events. `fs.watch` can silently miss events under bursts (a formatter touching many files, an editor "save all", or atomic-rename saves), which would otherwise leave the rebuild stale. A snapshot of the watched tree is taken each time a build is launched, and a ~1s background scan re-checks it; if any file drifts from what the running build was launched against, the child restarts so the build always converges on the latest sources.

Any extra arguments are forwarded to the underlying command:

```bash
bun run dev admin --port 9090 --theme boros
bun run dev serve --decks "Atraxa Superfriends" --currencies usd
```

If `--base-dir <path>` is passed for `serve`, the watcher uses that base directory's data folders.

The dev orchestrator is a source-tree-only tool — it is not part of the compiled binary. Press `q` or `Ctrl+C` to stop it cleanly; the child process and its port are released before the orchestrator exits.

### Answering cache prompts

Because the orchestrator owns the terminal exclusively, the child process can't read interactive prompts (e.g. the "Card cache is N days old, refresh?" prompt issued under the default `--refresh ask`). Rather than leave the child hanging on an unanswerable prompt, `bun run dev` **requires** you to pre-answer it with an explicit `--refresh` mode and fails fast before launching otherwise:

```bash
bun run dev serve --refresh auto     # refresh stale cache (bulk download allowed)
bun run dev serve --refresh no-bulk  # refresh prices per-card, no bulk download
bun run dev serve --refresh never    # use the existing cache as-is
```

The same applies to `bun run dev admin`. The flag is forwarded straight to the underlying [`serve`](/commands/serve/) / [`admin`](/commands/admin/) command, so the modes behave exactly as documented there. `--refresh ask` does **not** count as an answer — it restates the prompting default. Passing `--no-input` also satisfies the check, since under it the child skips the refresh instead of prompting. For day-to-day dev `--refresh never` is usually what you want; if you need to refresh the Scryfall cache, use `--refresh auto` on the next restart or run `ritual cache preload-all` separately.

## Building

Create a compiled binary:

```bash
bun run build
```

This produces a `ritual` executable in the project root.

To (re)generate just the bundled front-end assets and license file that the
type check reads — without the slower `--compile` binary step — run:

```bash
bun run build:assets
```

The local check suite (`bun run test`) and the verification suite use this
lighter build; only `test:it` / `test:e2e`, which actually exercise the binary,
build the full executable.

## Testing

This project uses `bun test` for testing.

### Local check suite

`bun run test` runs the whole-repo checks you want before pushing a change —
**type check, lint, and unit tests** — concurrently, with an assets-only build:

```bash
bun run test
```

Unit tests run with `--parallel` (one worker per core), the type check is
incremental, and lint uses `--concurrency auto` plus `--cache`, so repeat runs
are fast (typically a few seconds). It does **not** check formatting — use
`bun run check-format` or `bun run verify` for that.

### Integration Tests

Run integration tests that interact with external services:

```bash
bun run test:it
```

## Project Structure

```
ritual-cli/
├── index.ts              # CLI entry point
├── src/
│   ├── commands/         # CLI command implementations
│   ├── auth/             # Authentication modules
│   ├── clients/          # API clients
│   ├── importers/        # Deck importers
│   ├── site/             # Static site components
│   ├── scryfall.ts       # Scryfall API integration
│   ├── prices.ts         # Price fetching logic
│   ├── cache.ts          # Caching system
│   └── types.ts          # TypeScript types
├── test/
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
├── decks/                # Deck files (Markdown)
├── cache/                # Card cache
└── dist/                 # Generated static site
```

## Code Style

This project uses Prettier for code formatting:

```bash
bun run format        # Format all files
bun run check-format  # Check formatting
```

## Pre-commit Hook

A [Husky](https://typicode.github.io/husky/) `pre-commit` hook runs the
verification suite before each commit via `bun run precommit`:

```bash
bun run precommit     # Hook: lint/format STAGED files; build + typecheck + unit tests over the project
bun run verify        # Full: lint/format the ENTIRE repo (use before pushing / in CI)
```

Both commands — and `bun run test` — share one orchestrator
(`scripts/precommit.ts`) that runs the checks concurrently. The assets-only
build runs alongside the build-independent checks (lint, unit tests, and
staged-scoped format), and only the checks that read build-generated assets —
the type check, and the whole-repo format check in `verify` — wait for the
build to finish. Unit tests run with `--parallel`, the type check is
incremental, and lint is multithreaded (`--concurrency auto`).

`bun run precommit` and `bun run test` add `--cache` to lint for a fast local
loop. `bun run verify` deliberately runs lint **cold**: the type-aware rules can
otherwise return a stale pass for a file whose type dependencies changed but
whose own contents did not, so the pre-push / CI gate re-checks everything.

`bun run precommit` scopes **lint** and **format** to the staged files: it
verifies exactly what you're committing, which keeps the hook fast. The build,
type check, and unit tests still run over the whole project, since those can't
be meaningfully scoped to a subset of files. When no `.js`/`.ts` files are
staged, only the staged files' format check runs.

`bun run verify` lints and formats the entire repository for full coverage —
run it before pushing or rely on it in CI to catch drift in files an individual
commit didn't touch.

> **Note:** the hook checks the working-tree version of staged files. If you
> stage only part of a file (`git add -p`), the unstaged remainder is included
> in lint/format. Run `bun run verify` for an airtight whole-repo check.
