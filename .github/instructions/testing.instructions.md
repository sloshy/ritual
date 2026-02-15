---
description: Testing expectations for new and changed functionality.
applyTo: '**/*'
---

# Tests

When adding a new feature, include tests.

- For non-side-effecting business logic, add unit tests.
- For code that depends on interfaces, prefer non-side-effecting interface designs and add test implementations when needed.
- For side-effecting code (file writes, HTTP calls, external APIs), prefer end-to-end integration tests over unit tests.

Test locations:

- Unit and non-side-effecting tests: `test/unit/`
- Integration tests that hit APIs or write files: `test/integration/`

After writing tests, run them and fix compiler or linting issues before finishing.
