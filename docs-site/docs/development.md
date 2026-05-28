---
sidebar_position: 10
---

# Development

This guide covers how to set up the project for local development and contribute to the codebase.

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.0 or higher)
- Node.js 18+ (for Docusaurus docs site)

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
bun run index.ts new-deck "Test Deck"
```

When invoked this way (i.e. via `bun` rather than the compiled `ritual` binary), both [`admin`](./commands/admin.md) and [`serve-site`](./commands/serve-site.md) rebuild their SPA bundles from `src/` on startup. No flag is needed — the source-tree path is selected automatically. The compiled binary serves the pre-bundled assets baked into it.

## Dev Workflow

For iterative development of the `admin` interface or the static site, use:

```bash
bun run dev admin --no-refresh        # auto-restart `admin`
bun run dev serve-site --no-refresh   # auto-restart `serve-site`
```

This launches `scripts/dev.ts`, which:

- Spawns `bun index.ts <subcommand>` as a child process.
- Watches `src/` (TypeScript, TSX, CSS, SVG) and — for `serve-site` — `decks/`, `collections/`, and `wanted/` (Markdown).
- On any change, fully restarts the child process so updates to **any** part of the codebase (core logic, server handlers, parsers, SPA, themes, etc.) take effect on the next request. Running from source, `admin` and `serve-site` rebuild their CSS and SPA bundle from `src/` on each (re)start — there is no separate compile step to run, and the gitignored `*.compiled.*` artifacts are only used by the compiled binary.
- **Live-reloads the browser** (`admin` only, source mode). The served page holds an `EventSource` to a dev-only `/__dev_reload` endpoint that carries the server's boot id; the page reloads when that id changes (a real restart), not on every reconnect, so an idle-timeout drop never triggers a spurious reload. To guarantee the reloaded page fetches fresh assets, dev responses set `Cache-Control: no-store` **and** the `styles.css` / `app.js` URLs are cache-busted with a per-start `?v=<boot-id>` query — so a reload after a restart can never reuse a stylesheet or bundle the browser cached earlier.
- Catches changes even when the OS file watcher drops events. `fs.watch` can silently miss events under bursts (a formatter touching many files, an editor "save all", or atomic-rename saves), which would otherwise leave the rebuild stale. A snapshot of the watched tree is taken each time a build is launched, and a ~1s background scan re-checks it; if any file drifts from what the running build was launched against, the child restarts so the build always converges on the latest sources.

Any extra arguments are forwarded to the underlying command:

```bash
bun run dev admin --port 9090 --theme boros
bun run dev serve-site --decks "Atraxa Superfriends" --currencies usd
```

If `--base-dir <path>` is passed for `serve-site`, the watcher uses that base directory's data folders.

The dev orchestrator is a source-tree-only tool — it is not part of the compiled binary. Press `q` or `Ctrl+C` to stop it cleanly; the child process and its port are released before the orchestrator exits.

### Answering cache prompts

Because the orchestrator owns the terminal exclusively, the child process can't read interactive prompts (e.g. the "Card cache is N days old, refresh?" prompt). Rather than leave the child hanging on an unanswerable prompt, `bun run dev` **requires** you to pre-answer it with one of the refresh flags and fails fast before launching otherwise:

```bash
bun run dev serve-site --allow-refresh          # refresh stale cache (bulk download allowed)
bun run dev serve-site --allow-refresh-no-bulk  # refresh prices per-card, no bulk download
bun run dev serve-site --no-refresh             # use the existing cache as-is
```

The same applies to `bun run dev admin`. The flags are forwarded straight to the underlying [`serve-site`](./commands/serve-site.md) / [`admin`](./commands/admin.md) command, so they behave exactly as documented there — including suppressing the automatic bulk download for the two non-`--allow-refresh` options. For day-to-day dev `--no-refresh` is usually what you want; if you need to refresh the Scryfall cache, use `--allow-refresh` on the next restart or run `ritual cache preload-all` separately.

## Building

Create a compiled binary:

```bash
bun run build
```

This produces a `ritual` executable in the project root.

## Testing

This project uses `bun test` for testing.

### Unit Tests

Run unit tests for quick feedback:

```bash
bun run test
```

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

Both commands run the checks concurrently. The build runs alongside the
build-independent checks (lint, unit tests, and staged-scoped format), and only
the checks that read build-generated assets — the type check, and the whole-repo
format check in `verify` — wait for the build to finish.

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
