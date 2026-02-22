# Contributing

## Code Style

All TypeScript code should follow these conventions:

- **Interface names**: Use PascalCase without an `I` prefix (e.g. `CacheManager`, not `ICacheManager`).
- **Standard library imports**: Always use the `node:` prefix (e.g. `import fs from 'node:fs/promises'`).
- **Object types**: Always define object types explicitly with `type` or `interface` — never use inline anonymous object shapes as return types or variable types.

## Organization

- New CLI commands belong in `src/commands/`, not directly in `index.ts`.
- Any new command, flag, option, or feature must be documented in the Docusaurus docs under `docs-site/`.

## Tests

New features and bug fixes must include tests:

- **Unit tests** (non-side-effecting business logic): `test/unit/`
- **Integration tests** (file writes, HTTP calls, external APIs): `test/integration/`

For code that depends on interfaces, prefer non-side-effecting interface designs and add test implementations when needed. For side-effecting code, prefer end-to-end integration tests over unit tests.

After writing tests, run them and fix any compiler or linting issues before opening a pull request:

```bash
bun run test      # unit tests
bun run test:it   # integration tests
```
