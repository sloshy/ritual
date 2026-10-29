# Contributing

Everyone taking part in this project is expected to follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Reporting Bugs and Proposing Features

Open an issue with the [bug report or feature request form](https://github.com/sloshy/ritual/issues/new/choose). For usage questions, check the [documentation](https://ritual.rpeters.dev/) first. Report security problems privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

For anything larger than a small fix, open an issue to discuss it before sending a pull request.

## Getting Started

You need [Bun](https://bun.sh) (the version in `.bun-version`). Then:

```bash
git clone https://github.com/sloshy/ritual.git
cd ritual
bun install
bun run index.ts --help   # run Ritual from source, without building
bun run build             # compile the standalone ritual binary
```

The [Development](https://ritual.rpeters.dev/development/) page covers prerequisites, the dev server, the pre-commit hook, CI, and how releases are published. [`AGENTS.md`](AGENTS.md) holds the full project conventions; the sections below summarize them.

## Code Style

All TypeScript code should follow these conventions:

- **Interface names**: Use PascalCase without an `I` prefix (e.g. `CacheManager`, not `ICacheManager`).
- **Standard library imports**: Always use the `node:` prefix (e.g. `import fs from 'node:fs/promises'`).
- **Object types**: Always define object types explicitly with `type` or `interface` — never use inline anonymous object shapes as return types or variable types.
- **Parsers**: When writing parsing code, ensure that errors are properly represented, either through union types or structured error objects.
- **Set code normalization**: Set codes must always be lowercase in memory, cache keys, and data files. They must always be uppercase in markdown output (deck/collection/wanted files), CLI display text, and site UI. Normalize on read with `.toLowerCase()`; format on write/display with `.toUpperCase()`.

## Organization

- New CLI commands belong in `src/commands/`, not directly in `index.ts`.
- Any new command, flag, option, or feature must be documented in the Starlight docs under `docs-site/`.

## Localization

Every string a person reads in the CLI or either site goes through `t()` from `src/i18n/t.ts`, keyed into the English catalog under `src/i18n/messages/en/`. Each new key also needs an entry in the sibling `*.meta.ts` file with a `description`: it is the only context a translator gets. Removed strings mean removed keys. `bun run scripts/check-locales.ts` validates the catalog and runs as part of `bun run test`.

Some text is never translated because it is data, not prose:

- The card-line grammar (`&N`, `[foil]`, `[NM]`, `[ja]`, `SET:CN`) and its parsers and serializers.
- Changelog (`.changes.md`) prose, which Ritual parses back, and the other persistence and export modules. A unit test enforces that these never import `src/i18n`.
- Machine contracts: exit codes, error codes, JSON output keys, CSV headers.
- Model-facing text: MCP tool names and descriptions, skill content, and the docs site.

## Agent-Facing Surfaces

Besides the CLI, Ritual exposes its features to AI agents through the MCP server (`src/mcp/`, `ritual mcp`) and installable skills (`src/skills/`, `ritual skills install`). These must stay in step with the CLI. When you add, change, or remove a command, flag, option, config key, or file format, update in the same change:

- the command and its docs page,
- the matching MCP tools and server instructions, if the MCP exposes the operation (a capability the MCP needs gets an admin API route first, rather than calling engine code directly),
- the matching skill content and descriptions,
- the tests for each of those surfaces.

## Changes and Compatibility

Ritual is in 0.x, so commands, flags, output formats and the MCP tools may change from one release to the next. Two things go with every such change:

- **A `CHANGELOG.md` entry** under `## [Unreleased]` for anything a user would notice, saying what to do when they need to act.
- **A `ritual migrate` migration** (`src/migrate/migrations.ts`) for any change to what Ritual reads from or writes to a workspace: the list and card-line format, front matter, changelogs, sidecars, config keys, generated files. Users upgrade version by version and keep their data; the migration is how.

## Tests

New features and bug fixes must include tests:

- **Unit tests** (non-side-effecting business logic): `test/unit/`
- **Integration tests** (file writes, HTTP calls, external APIs): `test/integration/`

For code that depends on interfaces, prefer non-side-effecting interface designs and add test implementations when needed. For side-effecting code, prefer end-to-end integration tests over unit tests. Tests use synthetic data only, never real list files.

After writing tests, run them and fix any compiler or linting issues before opening a pull request:

```bash
bun run test       # type check, lint, message catalog, unit tests
bun run test:it    # integration tests (builds the binary)
bun run test:e2e   # Playwright (run `bunx playwright install chromium` once first)
bun run verify     # the whole-repo gate: `test` plus cold lint and formatting
bun run lint:repo  # shellcheck, actionlint, hadolint, typos
bun run format     # bun fmt, before you commit
```

CI runs all of these on every pull request, plus the docs-site build and a smoke test of every release binary on its own platform. The pull request template has a checklist of the above.
