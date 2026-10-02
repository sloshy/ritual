# Contributing

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

## Tests

New features and bug fixes must include tests:

- **Unit tests** (non-side-effecting business logic): `test/unit/`
- **Integration tests** (file writes, HTTP calls, external APIs): `test/integration/`

For code that depends on interfaces, prefer non-side-effecting interface designs and add test implementations when needed. For side-effecting code, prefer end-to-end integration tests over unit tests.

After writing tests, run them and fix any compiler or linting issues before opening a pull request:

```bash
bun run test       # type check, lint, message catalog, unit tests
bun run test:it    # integration tests (builds the binary)
bun run test:e2e   # Playwright (run `bunx playwright install chromium` once first)
bun run verify     # the whole-repo gate: `test` plus cold lint and formatting
bun run lint:repo  # shellcheck, actionlint, hadolint, typos
```

CI runs all of these on every pull request, plus the docs-site build and a smoke test of every release binary on its own platform. The [Development](https://ritual.rpeters.dev/development/) page covers setup, the dev server, the pre-commit hook, CI, and how releases are published.
