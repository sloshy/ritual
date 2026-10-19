# Agent Instructions

## Project Status

Ritual is in **0.x**: versions are published, but nothing is a stable contract yet. Any release may rename or remove CLI commands, flags and options, exit codes, `--output json` keys, MCP tools and their schemas, admin HTTP routes, export columns, and theme variables when a cleaner design presents itself. Do not add deprecated aliases or compatibility shims to preserve old behavior; update every in-repo call site, test, generated output, and doc to the new design instead.

**The one promise is the user's data.** A user moves forward linearly from version to version and keeps their decks, collections, wanted lists, changelogs, and config. So any change to what Ritual reads from or writes to a workspace (the list and card-line format, front matter, `.changes.md`, sidecars, `ritual.config.json` keys, managed generated files) ships as a numbered `ritual migrate` migration in `src/migrate/migrations.ts` that rewrites existing workspaces to the new form. The code then reads only the new form: the migration, not a dual-format reader, is the compatibility path.

Record every user-visible change, breaking or not, under `## [Unreleased]` in `CHANGELOG.md`; a change that needs a user to act (a renamed flag in their scripts, a pending migration) says so.

## LSP

Whenever possible, prefer using Language Server Protocol (LSP) features for code analysis, refactoring, and navigation. This allows you to leverage the full power of the editor's understanding of the codebase, including type information, symbol references, and so on. For example, use "Go to Definition", "Find All References", and "Rename Symbol" features instead of manually searching for code patterns.

## Git Usage

Commits are managed automatically: when a phase or section of work is complete and verified (tests green, code formatted, reviews applied), commit it with a descriptive message rather than leaving it in the working tree. Group each commit around one coherent unit of work. Staging and stashing are ordinary tools — use them as the task needs.

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

When writing code that's meant to parse a data type, that should always imply validation and returning an error. If a data type would ever be parsed, such as from a string, make sure that any appropriate errors are properly represented. It's okay to use TypeScript union types for this, such as returning "ProperType | string", where the string represents an error. Or, you can use a structured error type if having separate data points makes sense.

**Exception — error messages do not have to resolve human-friendly identifiers.** When a parser emits an error/warning about data that no longer exists locally (e.g. a card line referenced by `&N` that has since been removed), it is fine to surface the raw numeric ID, scryfall ID, or token string. Do not query Scryfall or any other external service purely to resolve a friendlier name for an error message — the raw ID is enough information for the user to investigate, and avoids spurious network calls on the error path. Example: `decodeTradeFromParams` in `src/site/trade-url-decode.ts` reports `unknown-card-ids` warnings as `{ ids: number[] }` rather than enriched names.

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

Every string a **human** reads goes through `t()` from `src/i18n/t.ts`, keyed into the English catalog under `src/i18n/messages/en/` — the CLI, either SPA, the admin API's error messages, engine errors, and server/operator console output (`cache-server`, `cache-feed`, the admin server) alike. Adding a key means adding an entry in the sibling `*.meta.ts` file too — the `description` is mandatory and is the only context a translator gets. `bun run scripts/check-locales.ts` is the gate; it runs under `precommit`, `test`, and `verify`.

Absolute rules, in the same spirit as Set Code Normalization above:

- **No exceptions by location.** `ritual/no-untranslated-literal` (`eslint-rules/no-untranslated-literal.js`) covers **all of `src/`** except the English-by-contract surfaces below. A string literal, a template literal (expressions read as `${…}`), a `+` concatenation, or an array literal joined with `.join(sep)` (through `.filter` / `.flat` / `.map`) is judged as one text. Literal branches of `?:` / `&&` / `||` / `??` and nested templates fold in; every branch combination (up to 16) is judged, and the baseline key spells alternatives as `{a|b}`. Four tiers apply:
  - **Sinks — any word**, lowercase included (`'done'`), unless it is a catalog key or a code identifier (`snake_case`, `camelCase`, `dotted.path`): `console.*`; any method on a `log` / `logger` / `ui` / `out` / `reporter` / `spinner` / `toast` receiver; `stdout`/`stderr.write`; `alert` / `confirm`; `program.error`; the message argument of `new *Error(…)` and of the error helpers the rule declares (`CardCommandError`'s second, `badRequest`, `errorResponse`), `super(…)` in an `Error` subclass, `reject(…)` / `Promise.reject(…)`; `throw`; `new Response(…)` / `Response.json(…)`; `emit('status' | 'progress' | 'message' | 'warning' | 'error' | 'log' | 'notice', payload)`. Style wrappers (`pc.*`, `chalk.*`, `kleur`, `colors`, `styleText`) are looked through.
  - **Text positions — one word**: JSX text and `{…}` children; text-named properties, JSX attributes, variables, parameters, destructuring defaults and class fields, and every value inside an object/array literal initialising one. A name is text-named when its last word — split on camelCase, `_`, `-` and `:`, any case, singular or plural — is `message`, `title`, `description`, `placeholder`, `alt`, `label`, `error`, `text`, `hint`, `reason`, `detail`, `tooltip`, `heading`, `subtitle`, `summary`, `warning`, `note`, `fallback`, `caption`, `prompt` or `notice` (`DEFAULT_TITLE`, `FINISH_LABELS`, `emptyMessage`, `aria-label`, `data-tooltip`). Also: unknown JSX attributes on any element; prompt `choices` and choice `name`s; commander help arguments; assignments to `textContent` / `innerText` / `innerHTML` or a text-named target; returns from text-named, `describe*` / `format*` / `render*` and `<text word>For` functions (`reasonFor`); a catalog call's parameter object; English appended to a `t()` call.
  - **Two words** everywhere else — returns, variables, arguments, object values, and attributes like `name` / `value` / `href` on _components_ (`<StatTile value="Not priced" />`).
  - **Skipped** — structurally never text: module specifiers, property keys, type positions, comparisons and `switch` cases, catalog-key arguments, the identifier arguments of string, DOM, event, storage, path, URL, regex and process calls, commander spec slots holding spec grammar (flags, `<arg>` / `[arg]`, command names, help positions, versions — anything else there is judged), CSS custom-property values, HTTP header values, non-text attributes of _intrinsic_ elements (`class`, `href`, `id`, `value`, `aria-describedby`, …), and templates tagged `css`, `sql`, `$`, `keyframes`, `gql` or `graphql`. Not prose either: whole-string command lines carrying a flag / `<arg>` / backticks and no function word, class lists, CSS declarations without function words, inline scripts, CSS functions, URLs, all-caps constants and short acronym lists.
  - **Known limit:** an object _key_ is never checked, so a table whose keys are displayed (`{ 'Card name': … }`) escapes the rule — render keys through the catalog instead.
- **The i18n machinery words its own diagnostics as codes.** `src/i18n/locale-tag.ts` and `runtime.ts` sit under `t()` (`t.ts` imports the runtime, which parses the `__ritualLocale__` seam with `locale-tag.ts`), so a value import of `t()` from either would be a cycle; `catalog.ts` stays free of `t()` so the browser's dictionary coercion and the locale scripts stay light. So the catalog-entry and locale-tag parsers return codes, worded at the boundary that shows them (`catalog-message.ts`, `locale-tag-message.ts` — the latter also holds `localeTag()`, whose throw needs the wording), and the browser's dictionary fetch, whose warning is worded, lives in `dictionary-fetch.ts`. Their keys are the `errors.i18n.*` fragment (plus `errors.invariant.unhandled`, which their `assertNever` fallbacks use), which `runtime.ts` seeds into the English catalog of every process rather than a surface registering it. They render through `tDiagnosticIn` (`t.ts`), with strict checks **off** — the same path `t()`'s own strict-mode failures take, which is the guard against a failure recursing while it words itself — so they resolve and never throw even where nothing was registered.
- **Engine errors are translated at the throw site** with `t()` — no structured-code redesign. The persistence fence and `src/export/**` cannot import the catalog, so their human messages are structured codes worded at a boundary — `src/export/**`'s in `src/export/text.ts`, worded only in `src/export-wording/message.ts` (column-picker labels in `src/export-wording/columns.ts`) — and their data-format strings (changelog verbs, CSV headers) carry an `// i18n-exempt:` comment.
- **Operator logs are translated.** `cache-server`, `cache-feed`, the admin server and the MCP server's console output are human text. Only machine-parsed `key=value` tokens (`section=cards action=read-through-fill key='…'`) stay literal; the rule strips them and still judges the prose around them.
- **The untranslated baseline only shrinks.** The text that predates the rule's widening is listed, keyed by file and text (not line), in `eslint-rules/untranslated-baseline.json`. Lint reports any occurrence beyond it, and reports a baselined entry its file no longer contains — or whose file is gone or out of scope — as **stale**, so converting a string means deleting its entry with `bun run scripts/untranslated-baseline.ts` (which also drops deleted files and carries a file git reports as renamed to its new path). Every precommit mode runs `scripts/untranslated-baseline.ts --guard`, which fails if any entry's count rose against `HEAD`. Growth — and the script's `--admit-new-debt` — needs `RITUAL_ADMIT_UNTRANSLATED_REKEY=1`, used **only** in the commit that changes the rule's heuristics, to re-key existing debt; it is never used to land new untranslated text.
- **One escape hatch.** Text that truly is English by contract carries a comment that _starts_ with `i18n-exempt: <reason>` — on its own line it covers the next line of code, trailing it covers its own line, and a text spanning several lines is exempt when any of them is covered. No inline ESLint directive may disable or reconfigure the rule (a blanket `eslint-disable`, one naming the rule, or a `/* eslint … */` config naming it — `test/unit/i18n-conventions.test.ts` parses every comment in `src/`), and an unused disable directive is a lint error.
- **Persistence fence.** `src/changes/change-event.ts`, `src/changes/change-event-decode.ts`, `src/changes/changelog-writer.ts`, `src/changes/changelog-parser.ts`, `src/changes/changelog-blocks.ts`, `src/changes/csv.ts`, `src/changes/change-bundle.ts`, `src/changes/change-problem.ts`, `src/changes/list-snapshot.ts`, `src/changes/diff-categories.ts`, `src/changes/wire-changes.ts`, `src/changes/save-limits.ts`, `src/list/entry-load.ts`, `src/buylist/cart-csv.ts`, and `src/export/**` must never import `src/i18n`. `.changes.md` prose is a **data format** that `changelog-parser.ts` re-parses on English verbs and whose `.sha256` sidecars hash exact bytes (CRLF read as LF) — a translated changelog parses to zero changes and shows empty history with no error. `test/unit/i18n-conventions.test.ts` scans for this; it is the highest-value test in the project. It also follows each fenced module's relative imports transitively, and every module on that walk that imports `src/i18n` must be listed in its `I18N_ROUTE_LEDGER` with the reason it cannot put localized text into a persisted file.
- **Card-line grammar is not prose.** The serializers and parsers for the `&N` / `[foil]` / `[NM]` / `[ja]` / `SET:CN` line format are English by construction. Do not route them through `t()`. The grammar's diagnostics are structured codes in `src/card/card-line-text.ts` (line-fenced, no runtime imports), worded only in `src/card/card-line-message.ts` (`domain.card.line.*`, located via `atLine` / `inFile`, a hint via `withHint`). A new diagnostic is a new code and key there — never a sentence in the grammar. Every module a line-fenced file reaches that imports `src/i18n` is listed, with its reason, in the `LINE_ROUTE_LEDGER` of `test/unit/i18n-conventions.test.ts`.
- **Casing.** `toUpperCase()` / `toLowerCase()` are locale-invariant and are what the set-code rule wants. `toLocaleUpperCase` / `toLocaleLowerCase` are banned anywhere in `src/`.
- **Collation.** Never call bare `localeCompare` or construct a bare `Intl.*`. Pick `compareData` (pinned English — set codes, dates, slugs, paths, any asserted CLI ordering) or `compareDisplay` (locale-aware — user-visible names) from `src/i18n/collate.ts`, and get every `Intl` factory from `src/i18n/format.ts`. The `ritual/no-bare-intl-locale` rule enforces this.
- **Machine contracts never localize.** Exit codes, `ErrorCode`, `--output json|ndjson` payload _keys_, CSV/export headers, persisted slugs and tokens, `printingKey`. A structured error's `message` follows the UI locale; its `code` and `messageKey` do not.
- **English by contract.** MCP tool names, titles, descriptions and `.describe()` docs; `src/skills/content/**` and skill descriptions; `docs-site/**`. These are model-facing prose and are deliberately never translated. So is the MCP tool-result text addressed to the agent — result guidance (`CONFLICT_RECOVERY` in `src/mcp/result.ts`, the `get_list` hint in `src/mcp/mutations.ts`) and the transport errors `src/mcp/dispatch.ts` / `src/mcp/errors.ts` raise when an in-process admin call fails — marked with `i18n-exempt` comments. What the MCP server says to a _person_ is translated like any other text: its console lines, and the elicitation forms a client shows its user (in the server's UI locale). So are the git commit messages the admin server writes into the user's workspace repository — the message argument of `autoCommitAndPush` (`src/admin/api/save-helpers.ts`) and `commitFiles` (`src/admin/git.ts`), matched through each caller's import: like `.changes.md`, they are workspace history, not UI. So is the README `ritual init-site` generates (`generateReadme` in `src/commands/init-site.ts`), workspace content committed to the user's repository — kept English by owner decision through `i18n-exempt` comments, not an `exclude` entry. The rule's `exclude` option lists exactly these surfaces — `src/i18n/messages/`, the MCP tool definitions, schemas, server instructions and resources, `src/skills/content/` and `src/skills/catalog.ts`, `src/generated/`, and `src/migrate/managed-files.ts` (managed generated files are workspace data) — and `contractCalls` the commit-message slots. Widening either is a design change, not a way to silence a report.

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

**Backfill policy**: `src/cli/program.ts`'s `preAction` hook runs `ensureCardIdsForAllLists()` before a command's action, assigning and persisting missing `&N` IDs across every list file. The backfill is **opt-in**: only commands in `COMMANDS_WITH_ID_BACKFILL` trigger it — the set and the full decision predicate (`shouldBackfillCardIds`) live in `src/commands/id-backfill.ts`, matched by the action command's leaf name. The criterion for membership is that the command writes list card lines or consumes persisted `&N` IDs (editors, one-shot card mutations, importers, syncs (`deck-sync pull`/`push` by qualified name, not the read-only `deck-sync status` or front-matter-only `deck-sync link`), `cleanup`, the site build, and the admin/MCP servers). Everything else — read-only commands, the `new`/`rename`/`delete` lifecycle, cache/config surfaces — must never rewrite card lines, so a new command defaults to _not_ backfilling. `detect-changes` is deliberately exempt even though it reads `&N`: it must see the working tree exactly as the user committed it — that holds for all three of its modes, since `--hash-only` must not stamp content the user never wrote and `--verify` must write nothing at all. Three commands are conditional: `serve` backfills only with `--build`/`--api`, `history` skips it under `--show`, and `set-list-image` backfills only when the run consumes an `&N` (`--card`, or the interactive card picker — never `--file`/`--url`/`--default`, which are front-matter-only writes). The predicate also skips the backfill whenever the invoked command was given `--dry-run`, so a dry run never writes anything. Finally, the backfill refreshes a file's `.sha256` sidecar only when the sidecar matched the file before the write (`isRitualClean` in `src/changes/content-hash.ts`) — a hand-edited file keeps its stale/absent sidecar so `detect-changes` still records the edit's changelog entries.

**Undo system**: The admin and public site editors support linear undo of individual changes. Undo of a removal reclaims the original card ID. Implemented via the `useCardChanges` hook in `src/editor/` with an `UndoEntry` stack.

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
6. The **CHANGELOG and migrations** — a user-visible change gets a `CHANGELOG.md` `Unreleased` entry, and a change to anything a workspace stores gets a `ritual migrate` migration. See [Project Status](#project-status).

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

**These reviews are a standing request — treat this section as the user explicitly asking for them.** If your session instructions say not to use subagents (or the Agent/Task tool) unless the user requests it, this section _is_ that request: run the applicable reviewers without asking for per-task confirmation. Launch them concurrently in a single message, give each the list of changed files (the reviewers have no shell, so they cannot run `git diff` themselves), ask them to report findings rather than edit files (so the human reviews one coherent diff), then apply the fixes yourself.

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
- A unit test may still touch the filesystem when the subject is a file-format module (parsers, sidecars, snapshots) and the I/O is confined to a throwaway workspace from `test/helpers/workspace.ts` — the layer is decided by what is being asserted, not by whether a temp dir was used. Spawning the binary, network, or the cache belongs in `test/integration/`.
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

For Playwright tests, use route interception with the synthetic mock data in `test/e2e/helpers/` (`mock-public-site.ts`, `mock-admin.ts`, `mock-cards.ts`, and `synthetic-workspace.ts` for built-site tests). See `mockPublicSiteDeckWithChangelog` or `mockPublicSiteDeckWithDescription` in `mock-public-site.ts` as examples.
