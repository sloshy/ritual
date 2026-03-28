# Agent Instructions

## LSP

Whenever possible, prefer using Language Server Protocol (LSP) features for code analysis, refactoring, and navigation. This allows you to leverage the full power of the editor's understanding of the codebase, including type information, symbol references, and so on. For example, use "Go to Definition", "Find All References", and "Rename Symbol" features instead of manually searching for code patterns.

## Git Usage

Do NOT ever make a git commit unless explicitly asked to. I want to review any code changes you suggest, so they should just be left in the git tree unstaged as if I wasn't using version control.

## Coding Style

### Object Types

Object types must be explicitly defined using `type` or `interface` declarations — never left as implicit inline object shapes inferred by the compiler. This applies to function return types, variable declarations, and any other context where an object type would otherwise be anonymous.

```ts
// ✅ Correct
type Point = { x: number; y: number }
function getOrigin(): Point {
  return { x: 0, y: 0 }
}

// ❌ Incorrect
function getOrigin(): { x: number; y: number } {
  return { x: 0, y: 0 }
}
```

### Parsers

When writing code that's meant to parse a data type, that should always imply validation and returning an error. If a data type would ever be parsed, such as from a string, make sure that any appropraite errors are properly represented. It's okay to use TypeScript union types for this, such as returning "ProperType | string", where the string represents an error. Or, you can use a structured error type if having separate data points makes sense.

### Set Code Normalization

Set codes (e.g. `mkm`, `lea`, `2xm`) must follow these rules throughout the codebase:

- **Lowercase internally**: Normalize to lowercase when reading from user input, file parsers, or any external source. All in-memory representations, cache keys, and comparisons must use lowercase.
- **Lowercase in data files**: Cache files and any non-markdown data files must store set codes in lowercase.
- **Uppercase in output**: Markdown files (deck, collection, wanted lists), CLI display text, and site UI must always render set codes in uppercase (`.toUpperCase()`).

```ts
// ✅ Reading/parsing — normalize to lowercase
set: match[3]?.toLowerCase()

// ✅ Writing to markdown or displaying to user — uppercase
`${card.set.toUpperCase()}:${card.collectorNumber}`

// ✅ Comparisons — always lowercase both sides
entry.set.toLowerCase() === change.set.toLowerCase()
```

### Organization

New CLI commands should be added to `src/commands/` rather than directly in `index.ts`.

Any new command, flag, option, or feature adjusted or added must also be reflected in the Docusaurus docs under `docs-site/`.

### Research Tasks

When asked to do research work (for example external API exploration or reverse engineering), save created files in `research/`.

### Naming Conventions

#### Interfaces

- Do not prefix interface names with `I` (use `CacheManager`, not `ICacheManager`).
- Use PascalCase for interface names.

#### Imports

For imports from the Bun or Node standard library, always use the `node:` prefix. For example, importing `fs/promises` should be imported from `node:fs/promises` instead.

### Card IDs

Every card entry in deck, collection, and wanted list markdown files has a persistent numeric ID suffix (`&N`). These IDs are stable across non-removal edits and only released back to a reuse pool when a card line is entirely removed.

**Format**: `&` followed by a number at the end of a card line (e.g., `1 Sol Ring &5`, `- Lightning Bolt (LEA:161) &12`).

**Rules**:

- IDs are sequential starting from 1 within each list file
- When a card is removed, its ID is released to a reuse pool
- New cards take the smallest available ID from the pool, then fall back to the next sequential number
- Decrementing deck quantity does NOT release the ID — only full line removal does
- IDs are an internal implementation detail — NOT exposed on the public site
- The `src/card-id.ts` module contains all pool allocation logic (`createIdPool`, `allocateId`, `releaseId`, `claimId`, `initializePoolFromEntries`)
- Files without IDs get auto-assigned IDs on load and persisted on save
- Changelog entries include card IDs

**Undo system**: The admin site editors support linear undo of individual changes. Undo of a removal reclaims the original card ID. Implemented via `useCardChanges` hook with `UndoEntry` stack.

## Tests

When adding a new feature, include tests.

- For non-side-effecting business logic, add unit tests.
- For code that depends on interfaces, prefer non-side-effecting interface designs and add test implementations when needed.
- For side-effecting code (file writes, HTTP calls, external APIs), prefer end-to-end integration tests over unit tests.

Test locations:

- Unit and non-side-effecting tests: `test/unit/`
- Integration tests that hit APIs or write files: `test/integration/`

After writing tests, run them and fix compiler or linting issues before finishing.

### Testing Strategy

Always run `bun run test` after adding new code, so that it may be properly tested. Following running tests, format all code with `bun run format`.

### Playwright Tests

When writing a new feature for the public site or admin site, ensure there's a new Playwright test or an additional expectation for an existing, related test.
Tests using the built site should always use synthetic data created for running the tests.
Do not bother writing tests just to see if an element is visible, except for one or two basic smoke tests, or smoke testing inside of other behavior tests.
Most playwright testing should be focused on state transitions, such as adding a card to a collection and seeing if it appears, or editing a deck and seeing if the changes persist.
