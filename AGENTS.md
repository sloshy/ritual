# Agent Instructions

## Project Status

This project is **pre-release**. There are no published versions and no external users to support, so **backward compatibility is not a concern**. Freely rename or remove CLI flags, commands, options, config keys, file formats, and APIs when a cleaner design presents itself — do not add deprecated aliases, compatibility shims, or migration paths to preserve old behavior. Just update all in-repo call sites, tests, generated output, and docs to match the new design.

## LSP

Whenever possible, prefer using Language Server Protocol (LSP) features for code analysis, refactoring, and navigation. This allows you to leverage the full power of the editor's understanding of the codebase, including type information, symbol references, and so on. For example, use "Go to Definition", "Find All References", and "Rename Symbol" features instead of manually searching for code patterns.

## Git Usage

Do NOT ever make a git commit unless explicitly asked to. I want to review any code changes you suggest, so leave them in the working tree for me to review. In the normal case, don't manage the staging state on my behalf (no proactively running `git add` to stage your edits, and don't un-stage either) — files that are already staged are fine and expected, since I may stage files or commit bits and pieces as we work.

The exception is when staging or stashing is a means to an end for a task — e.g. `git stash` to test whether a failure is a pre-existing regression, then restoring afterward. That kind of transient, self-contained use is fine; just leave the working tree as you found it when done.

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

**Exception — error messages do not have to resolve human-friendly identifiers.** When a parser emits an error/warning about data that no longer exists locally (e.g. a card line referenced by `&N` that has since been removed), it is fine to surface the raw numeric ID, scryfall ID, or token string. Do not query Scryfall or any other external service purely to resolve a friendlier name for an error message — the raw ID is enough information for the user to investigate, and avoids spurious network calls on the error path. Example: `decodeTradeFromParams` in `src/site/trade-url.ts` reports `unknown-card-ids` warnings as `{ ids: number[] }` rather than enriched names.

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

### Localization

Every string a **human** reads in the CLI or either SPA goes through `t()` from `src/i18n/t.ts`, keyed into the English catalog under `src/i18n/messages/en/`. Adding a key means adding an entry in the sibling `*.meta.ts` file too — the `description` is mandatory and is the only context a translator gets. `bun run scripts/check-locales.ts` is the gate; it runs under `precommit`, `test`, and `verify`.

Absolute rules, in the same spirit as Set Code Normalization above:

- **Persistence fence.** `src/changes/change-event.ts`, `src/changes/changelog-writer.ts`, `src/changes/changelog-parser.ts`, `src/changes/csv.ts`, `src/buylist/cart-csv.ts`, and `src/export/**` must never import `src/i18n`. `.changes.md` prose is a **data format** that `changelog-parser.ts` re-parses on English verbs and whose `.sha256` sidecars hash exact bytes — a translated changelog parses to zero changes and shows empty history with no error. `test/unit/i18n-conventions.test.ts` scans for this; it is the highest-value test in the project.
- **Card-line grammar is not prose.** The serializers and parsers for the `&N` / `[foil]` / `[NM]` / `[ja]` / `SET:CN` line format are English by construction. Do not route them through `t()`.
- **Casing.** `toUpperCase()` / `toLowerCase()` are locale-invariant and are what the set-code rule wants. `toLocaleUpperCase` / `toLocaleLowerCase` are banned anywhere in `src/`.
- **Collation.** Never call bare `localeCompare` or construct a bare `Intl.*`. Pick `compareData` (pinned English — set codes, dates, slugs, paths, any asserted CLI ordering) or `compareDisplay` (locale-aware — user-visible names) from `src/i18n/collate.ts`, and get every `Intl` factory from `src/i18n/format.ts`. The `ritual/no-bare-intl-locale` rule enforces this.
- **Machine contracts never localize.** Exit codes, `ErrorCode`, `--output json|ndjson` payload _keys_, CSV/export headers, persisted slugs and tokens, `printingKey`. A structured error's `message` follows the UI locale; its `code` and `messageKey` do not.
- **English by contract.** MCP tool names, titles, descriptions and `.describe()` docs; `src/skills/content/**` and skill descriptions; `docs-site/**`. These are model-facing prose and are deliberately never translated — see `research/i18n-framework-plan-2026-08-07.md` §11.

Design record: `research/i18n-framework-plan-2026-08-07.md`.

### Organization

New CLI commands should be added to `src/commands/` rather than directly in `index.ts`.

Any new command, flag, option, or feature adjusted or added must also be reflected in the Starlight docs under `docs-site/`, **and in the agent-facing surfaces** — see [Agent-Facing Surfaces](#agent-facing-surfaces-mcp-server--skills) below.

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
- IDs are an internal implementation detail — NOT exposed through the UI, but may be used in APIs, query parameters, or other functionality as needed
- The `src/card/card-id.ts` module contains all pool allocation logic (`createIdPool`, `allocateId`, `releaseId`, `claimId`, `initializePoolFromEntries`)
- Files without IDs get auto-assigned IDs on load and persisted on save
- Changelog entries include card IDs

**Backfill policy**: `index.ts`'s `preAction` hook runs `ensureCardIdsForAllLists()` before a command's action, assigning and persisting missing `&N` IDs across every list file. The backfill is **opt-in**: only commands in `COMMANDS_WITH_ID_BACKFILL` trigger it — the set and the full decision predicate (`shouldBackfillCardIds`) live in `src/commands/id-backfill.ts`, matched by the action command's leaf name. The criterion for membership is that the command writes list card lines or consumes persisted `&N` IDs (editors, one-shot card mutations, importers, syncs (`deck-sync pull`/`push` by qualified name, not the read-only `deck-sync status` or front-matter-only `deck-sync link`), `cleanup`, the site build, and the admin/MCP servers). Everything else — read-only commands, the `new`/`rename`/`delete` lifecycle, cache/config surfaces — must never rewrite card lines, so a new command defaults to _not_ backfilling. `detect-changes` is deliberately exempt even though it reads `&N`: it must see the working tree exactly as the user committed it — that holds for all three of its modes, since `--hash-only` must not stamp content the user never wrote and `--verify` must write nothing at all. Three commands are conditional: `serve` backfills only with `--build`/`--api`, `history` skips it under `--show`, and `set-list-image` backfills only when the run consumes an `&N` (`--card`, or the interactive card picker — never `--file`/`--url`/`--default`, which are front-matter-only writes). The predicate also skips the backfill whenever the invoked command was given `--dry-run`, so a dry run never writes anything. Finally, the backfill refreshes a file's `.sha256` sidecar only when the sidecar matched the file before the write (`isRitualClean` in `src/changes/content-hash.ts`) — a hand-edited file keeps its stale/absent sidecar so `detect-changes` still records the edit's changelog entries.

**Undo system**: The admin site editors support linear undo of individual changes. Undo of a removal reclaims the original card ID. Implemented via `useCardChanges` hook with `UndoEntry` stack.

## Agent-Facing Surfaces (MCP Server & Skills)

Ritual exposes its capabilities to AI agents through two surfaces in addition to the CLI itself, and **both must be kept in sync with the CLI and with each other on every relevant change**:

- **MCP server** — `src/mcp/` (command: `src/commands/mcp.ts`, run with `ritual mcp`). Exposes deck/collection/wanted operations as Model Context Protocol tools by reusing the admin route handlers. Tools live in `src/mcp/tools/{read,write,destructive}-tools.ts`; the server description is in `src/mcp/server.ts`; docs are in `docs-site/src/content/docs/commands/mcp.md`.
- **Skills** — `src/skills/` (command: `src/commands/skills.ts`, run with `ritual skills install`). Installable Claude Code agent skills that teach an agent to drive the `ritual` CLI directly. The catalog is `src/skills/catalog.ts`; each skill's content is one module under `src/skills/content/`; docs are in `docs-site/src/content/docs/commands/skills.md`.

### API-First Surface Definition

The admin HTTP API (`src/admin/api/`, registered in `src/admin/server.ts`) is Ritual's **client-neutral API surface**. It is defined from the perspective of a full-featured API usable by multiple clients — the admin UI, the MCP server, and any future client — **not** by what the admin UI currently displays. Concretely:

- When the MCP server (or any other client) needs a capability that has no admin route, the default is to **add an admin route for it**, even if no UI uses it yet. MCP tools calling engine modules directly is not the pattern; the shared handler is where validation and behavior live exactly once.
- When a client needs more data than a handler's response carries, **widen the shared response type** rather than adding per-client projections or field-selection parameters. A handler returns one honest, fully-typed shape; each client projects what it needs from it.
- The admin UI is one consumer of this API, not its definition. "No UI for it yet" is never a reason to leave a capability out of the API, and the admin UI's feature set is never the ceiling on what other clients can do.

**The rule:** whenever you add, change, or remove a command, flag, option, config key, file format, or user-visible behavior, update **all** of the following in tandem so the CLI, the MCP server, and the Skills never drift apart:

1. The command in `src/commands/` and its page in `docs-site/src/content/docs/`.
2. The corresponding MCP tool(s) in `src/mcp/tools/` **if the operation is exposed there**, plus the server instructions and `mcp.md`. (Not every CLI command is mirrored by an MCP tool — the auth/login surface is intentionally omitted — but anything the MCP does expose must match, and a capability the MCP needs gets an admin route first; see [API-First Surface Definition](#api-first-surface-definition) above. Where MCP tools declare result `outputSchema`s, a change to a handler's response shape must update the schema and its pinned tests in the same change.)
3. The corresponding skill content in `src/skills/content/` (and the skill descriptions used for discovery), plus `skills.md`. The Skills are meant to mirror the **full CLI surface**, so a new or changed command almost always means a skill edit.
4. The tests for each surface (`test/unit/mcp/*`, `test/integration/mcp-*.test.ts`, `test/unit/skills.test.ts`, `test/integration/skills-install.test.ts`).
5. The **message catalog** — any new or reworded user-facing string is a key in `src/i18n/messages/en/` plus its mandatory `description` in the sibling `*.meta.ts`, validated by `bun run scripts/check-locales.ts`. A removed string means a removed key: dead keys are an error, not a warning. See [Localization](#localization) for what is deliberately _not_ translated.

When reviewing changes that touch commands, explicitly confirm the MCP tools and Skills were updated — a CLI change with no matching MCP/Skills update is a defect, not an omission. Run the **`feature-surface-sync`** agent (see [Post-Implementation Review](#post-implementation-review)) to audit this matrix automatically whenever you touch an admin route handler, a `src/commands/` command, or a flag/option.

## Post-Implementation Review

After completing any new feature or bug fix, run the following subagent reviews before considering the task done:

- **`ts-code-reviewer`** — reviews TypeScript code for type safety, idiomatic patterns, and proper use of language features.
- **`solidjs-code-reviewer`** — reviews any new or modified SolidJS components, signals, stores, or effects for reactivity correctness and modern patterns. Only invoke when SolidJS code was written or changed.
- **`code-deduplicator`** — scans changed files for meaningful duplication opportunities: repeated logic, redundant constants, similar parsing patterns. Only invoke when multiple files were added or significantly modified.
- **`docs-sync-reviewer`** — verifies that `docs-site/src/content/docs/` reflects the current CLI source. Invoke whenever a command in `src/commands/` is added, changed, or removed, or when flags/options change.
- **`feature-surface-sync`** — audits that a feature added or changed on one surface stays consistent across all of them: the MCP server (`src/mcp/`), the CLI skills (`src/skills/`), `docs-site/src/content/docs/`, and test coverage. Invoke whenever you add, change, or remove an admin route handler, a `src/commands/` command, or a flag/option/config key — see [Agent-Facing Surfaces](#agent-facing-surfaces-mcp-server--skills).
- **`card-format-reviewer`** — audits code that touches card entries (parsers, serializers, importers) for violations of domain invariants: set code normalization, `&N` ID handling, canonical line format, and parser error representation. Invoke when adding or modifying any code that reads or writes deck, collection, or wanted list files.
- **`test-quality-reviewer`** — reviews new or modified test code for correctness, meaningful assertions, and boilerplate duplication. Invoke after writing or significantly changing unit, integration, or Playwright tests.

Run all applicable agents for the change. If a reviewer flags issues, fix them before finishing.

**These reviews are a standing request — treat this section as the user explicitly asking for them.** If your session instructions say not to use subagents (or the Agent/Task tool) unless the user requests it, this section _is_ that request: run the applicable reviewers without asking for per-task confirmation. Launch them concurrently in a single message, ask them to report findings rather than edit files (so the human reviews one coherent diff), then apply the fixes yourself.

Skipping a reviewer is fine only when its stated trigger genuinely does not apply — say which ones you skipped and why. If you are unable to spawn the agents at all, **say so explicitly before reporting the task complete**; silently skipping the reviews and calling the work done is the failure mode this paragraph exists to prevent.

## Tests

When adding a new feature, include tests.

- For non-side-effecting business logic, add unit tests.
- For code that depends on interfaces, prefer non-side-effecting interface designs and add test implementations when needed.
- For side-effecting code (file writes, HTTP calls, external APIs), prefer end-to-end integration tests over unit tests.

Test locations:

- Unit and non-side-effecting tests: `test/unit/`
- Integration tests that hit APIs or write files: `test/integration/`

### Test Layering Policy

Most features are reachable through several surfaces (engine module, CLI command, admin API handler, admin/public UI, MCP tool). Test each property at exactly one layer — the lowest one that can express it:

- **Engine semantics** (parsing, diffing, apply logic, formatting) belong in unit tests against the engine module.
- **Integration tests** cover one representative path through the CLI or admin handler per feature — flag wiring, exit codes, file side effects — not a re-run of the engine's cases.
- **Playwright tests** cover UI state transitions (the UI reflects and mutates state correctly), not engine behavior that happens to be reachable through the page.
- **MCP tool tests** cover wiring only: the tool is registered, its schema rejects bad input, the result shape is right, and one happy path per tool. The MCP server reuses the admin handlers in-process, so anything beyond wiring re-tests a layer that already has coverage.

When adding a test, check whether the property is already pinned at a lower layer; if it is, assert only what the new layer adds (wiring, transport, presentation).

After writing tests, run them and fix compiler or linting issues before finishing.

### Testing Strategy

Always run `bun run test` after adding new code, so that it may be properly tested. Following running tests, format all code with `bun run format`.

### Playwright Tests

When writing a new feature for the public site or admin site, ensure there's a new Playwright test or an additional expectation for an existing, related test.
Tests using the built site should always use synthetic data created for running the tests.
Do not bother writing tests just to see if an element is visible, except for one or two basic smoke tests, or smoke testing inside of other behavior tests.
Most playwright testing should be focused on state transitions, such as adding a card to a collection and seeing if it appears, or editing a deck and seeing if the changes persist.

### Test Data

All tests — especially integration and Playwright tests — **must use fake or synthetic data**, never real data files. Directories listed in `.gitignore` (e.g., `decks/`, `collections/`, `wanted/`, `cache/`, `dist/`) are not available from a fresh clone. Tests that depend on those files will fail in CI or on a new machine.

For Playwright tests, use route interception with mock data defined in `test/e2e/helpers/mock-data.ts`. See `mockPublicSiteDeckWithChangelog` or `mockPublicSiteDeckWithDescription` as examples.
