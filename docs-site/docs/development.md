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
bun run dev admin        # auto-restart `admin`
bun run dev serve-site   # auto-restart `serve-site`
```

This launches `scripts/dev.ts`, which:

- Spawns `bun index.ts <subcommand>` as a child process.
- Watches `src/` (TypeScript, TSX, CSS, SVG) and — for `serve-site` — `decks/`, `collections/`, and `wanted/` (Markdown).
- On any change, fully restarts the child process so updates to **any** part of the codebase (core logic, server handlers, parsers, SPA, themes, etc.) take effect on the next request.

Any extra arguments are forwarded to the underlying command:

```bash
bun run dev admin --port 9090 --theme boros
bun run dev serve-site --decks "Atraxa Superfriends" --currencies usd
```

If `--base-dir <path>` is passed for `serve-site`, the watcher uses that base directory's data folders.

The dev orchestrator is a source-tree-only tool — it is not part of the compiled binary. Press `q` or `Ctrl+C` to stop it cleanly; the child process and its port are released before the orchestrator exits.

Because the orchestrator owns the terminal exclusively, interactive prompts in the child process (e.g. the "Card cache is N days old, refresh?" prompt) auto-default rather than waiting for input. If you need to refresh the Scryfall cache while developing, run `ritual cache preload-all` separately or restart `bun run dev` after refreshing.

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

A [Husky](https://typicode.github.io/husky/) `pre-commit` hook runs the full
verification suite before each commit via `bun run precommit`:

```bash
bun run precommit     # Build, then typecheck + lint + unit tests + format check
```

When code files are staged, the build runs first (it generates the
`*.compiled.*` assets that the type checker and formatter read), then the
type check, lint, unit tests, and format check run **in parallel** so the hook
finishes in roughly the time of its slowest single check. When no `.js`/`.ts`
files are staged, only the format check runs.
