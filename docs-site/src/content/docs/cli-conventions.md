---
title: 'CLI Conventions'
description: Global options, headless runs, scripting output, and exit codes shared by every command.
---

Every Ritual command shares the same global options, the same rules for running without a terminal, the same scripting output formats, and the same exit codes. This page collects them so the individual command pages don't have to repeat them.

## Global Options

These options work on every command. Each one has an environment variable that does the same job. When both are given, the flag wins, and an empty or whitespace-only variable counts as **not set**.

| Option                       | Environment variable  | Description                                                                 |
| ---------------------------- | --------------------- | --------------------------------------------------------------------------- |
| `--base-dir <path>`          | `RITUAL_BASE_DIR`     | Use this directory instead of the current working directory                 |
| `--cache-server <host:port>` | `RITUAL_CACHE_SERVER` | Use a remote cache server instead of local cache files                      |
| `--no-input`                 | `RITUAL_NO_INPUT`     | Never prompt; fail or use documented defaults where input would be required |
| `--locale <tag>`             | `RITUAL_LOCALE`       | Language for Ritual's own interface text (BCP-47, e.g. `de-AT`)             |

### `--base-dir`

By default Ritual reads and writes files relative to the directory you run it from. `--base-dir` points it at a different directory without a `cd`:

```bash
# Run from anywhere, but operate on files in ~/my-collection
ritual --base-dir ~/my-collection build-site

# Price a deck in a specific project directory
ritual --base-dir /projects/mtg price "My Deck"
```

This affects every path: decks, collections, wanted lists, the cache, config files, and the output `dist/` directory. Paths in [`ritual.config.json`](/configuration/) are resolved relative to it.

`RITUAL_BASE_DIR` does the same thing whenever the flag is not passed, so a shell session or a service unit can pin a workspace once:

```bash
export RITUAL_BASE_DIR=~/my-collection
ritual lists                              # operates on ~/my-collection
ritual --base-dir /projects/mtg lists     # the flag wins for this one run
```

**The directory must already exist.** Ritual never creates a base directory. A path that is missing, or that is not a directory, is a usage error (exit code `2`), and nothing is read or written:

```
base directory does not exist: /home/you/my-collectoin
base directory is not a directory: /home/you/notes.txt
base directory is not readable: /srv/private — EACCES: permission denied, stat '/srv/private'
```

The third form covers permission problems and any other filesystem failure while checking the path. Failing here protects you from a typo: a misspelled `--base-dir` would otherwise look like an empty workspace, and a write would fork your data into a stray directory.

### `--no-input`

Disables every interactive prompt. This is the switch for scripts, CI, and agents. A command that would normally prompt either fails with a usage error or falls back to a documented default. Each command's page says which; see for example [`price`](/commands/price/#price-freshness), [`export`](/commands/export/#interactive-wizard), and [`cleanup`](/commands/cleanup/#headless-runs).

`RITUAL_NO_INPUT` does the same thing whenever the flag is not passed, so you can set it once in a CI environment instead of adding the flag to every invocation:

```bash
RITUAL_NO_INPUT=1 ritual cleanup --skip-formats
ritual import ./decklist.txt --type deck --no-input
```

A falsy value (`0`, `false`, `no`, `off`, any casing) counts as **not set**, so an inherited `RITUAL_NO_INPUT=1` can be turned back off for one run:

```bash
RITUAL_NO_INPUT=0 ritual edit "My Deck"   # prompts again, despite the CI default
```

### When prompts are unavailable

A prompt cannot run in two situations: `--no-input` or `RITUAL_NO_INPUT` disabled prompting, or stdin is not a terminal (piped input, `</dev/null`, most CI runners). The CLI treats both the same way. No command opens a prompt, spawns a pager, or exits `0` after quietly skipping the work it was asked to do.

Where an answer is required, you get a usage error (exit code `2`) naming what was needed. The message names the flag that would have supplied the answer where one exists, and otherwise the thing the prompt asked for:

```
Input required: pass --finish <nonfoil|foil|etched> (no terminal available for prompts).
Input required: pass --finish <nonfoil|foil|etched> (prompts are disabled by --no-input / RITUAL_NO_INPUT).
Input required: a printing of the card (...)
```

The parenthetical says which of the two causes applied, since the remedies differ: supply the missing flags, or reconsider `--no-input`.

Interactive-only surfaces refuse to open at all and point at their headless equivalent: `edit`, the `history` editor, `move`'s session, and `dep-license`'s picker. `license` and `dep-license <package>` print their text straight to stdout instead of paging it through `less`.

Where a question has a documented default, that default is used instead of failing. The general rule is that `--refresh ask` is **declined** rather than answered wherever it is a prompt. A few commands read the situation differently, and their pages say so:

- [`build-site`](/commands/build-site/#card-cache-refresh) bulk-downloads an empty or stale card cache without asking, since it cannot build without card data.
- [`sell`](/commands/sell/#feed-freshness) redownloads an already-downloaded Card Kingdom buylist once it is a day old, since a day-old feed quotes yesterday's offers. [`admin`](/commands/admin/), [`serve --api`](/commands/serve/#live-api-mode---api), and a [sell-mode `build-site`](/commands/build-site/#sell-mode---sell-mode) do the same. Only the _first_ buylist download prompts.
- [`collection-sync`](/commands/collection-sync/#cache-freshness) fails the run instead of skipping.
- A text `import` without `--type` falls back to a deck **under an explicit `--no-input`**. A merely piped run still errors, since nothing said which type was meant.
- A URL `import` (and `import-account`) without a [`--sync-printings`/`--no-sync-printings`](/commands/import/#printings-from-a-url-import) answer behaves the same way: an explicit `--no-input` keeps the source's exact printings and says so, while a merely piped run errors.

### `--locale`

Sets the language of **Ritual's own interface text**: output, prompts, menus, help, and errors. It takes a [BCP-47](https://www.rfc-editor.org/info/bcp47) tag (`en`, `de`, `de-AT`, `pt-BR`). Tags are canonicalized, so `--locale de-at` and `--locale de-AT` mean the same thing.

```bash
ritual --locale de lists            # this one run
export RITUAL_LOCALE=de             # this shell
ritual config set uiLocale de       # this workspace, persistently
```

The full precedence is `--locale` → `RITUAL_LOCALE` → the [`uiLocale`](/configuration/#interface-language) config key → your OS locale → `en`. Only the flag is strict: a tag naming no known language is a usage error (exit code `2`). A bad `RITUAL_LOCALE` or `uiLocale` warns and falls through to the next tier, because an unusable interface language is cosmetic and refusing to run over it would be worse than the misconfiguration.

Run [`ritual locale`](/commands/locale/) to see which tier won, or [`ritual locale --detect`](/commands/locale/#detecting-the-os-locale) to run the deeper OS probes (Windows/macOS) and optionally save the result as `uiLocale`.

:::note[Not the card language]
`--locale` is about the language **Ritual speaks**. Which _printing of a card_ gets recorded is [`defaultLanguage`](/configuration/#default-language), a separate setting with a separate vocabulary. The two are independent; see [Localization](/localization/). No translations ship yet, so today every locale renders English text, though dates, numbers, and currency follow the tag.
:::

## Scripting

Every command that produces data can emit it in a machine-readable form:

```bash
# One JSON document
ritual price "My Commander Deck" --output json | jq '.totals'

# One JSON object per line, with only the fields you want
ritual card --from-file cards.txt --output ndjson --fields name,set,prices.usd

# No prompts, no writes
ritual import-account johndoe --all --no-input --dry-run
```

A few habits make scripts robust:

- Prefer `--output json` or `--output ndjson` over parsing text.
- Use `--fields` to project a stable subset of the data.
- Set `--no-input` (or `RITUAL_NO_INPUT`) in headless environments so no command ever prompts, and pass `--yes` where a confirmation is required.

## Scripting conventions

Three flags and one exit-code vocabulary behave the same way on every command that has them.

### `--output` always means the scripting format

`--output text|json|ndjson` selects the **envelope** the command writes to stdout. It never means a file format or a destination. `json` emits exactly one document per run, so a batch of card lookups or a multi-page search is still one array. `ndjson` streams one JSON object per line. `text` is the human rendering.

Three commands widen or drop the value list rather than redefining the flag. [`scry`](/commands/scry/) adds `--output csv`, which Scryfall renders itself. [`sell`](/commands/sell/) adds `--output csv` too, with a different payload: Card Kingdom's sell-cart upload rows, not the report re-rendered. [`export`](/commands/export/) has no `--output` at all, because its stdout payload _is_ the export; you choose it with `--format csv|json|text|md` and redirect it with `--out <file>`.

Errors always go to **stderr**, structured to match the output mode. Under `json`/`ndjson` an error is `{"error": {"code", "messageKey", "messageParams", "message", "details"}}`; under `text` it is a plain line. `code` and `messageKey` are locale-invariant, so match on those. `message` is prose that follows the UI locale. `messageKey` and `messageParams` are omitted when the failure has no message-catalog entry behind it, such as an error quoted verbatim from Scryfall or the filesystem. An unexpected internal failure uses the same envelope with `code: "runtime_error"`, exit code `1`, and neither `messageKey` nor `details`. stdout stays parseable in every case.

### `--quiet` suppresses chatter, never data

`--quiet` removes progress and status messages: "Reading cards from file…", "Successfully imported…", applied counts, confirmations. It never removes:

- the **structured payload**. `--output json`/`ndjson` stdout is always emitted, so `--quiet --output json` is a JSON document with no chatter around it. Scripts that want total silence redirect stdout.
- **errors**, and **warnings that mean content was lost**: a card line the parser could not read, a change skipped as a conflict, a result set truncated by the page cap. These always print to stderr, `--quiet` or not, because nothing else would tell you.

A command with no non-essential output does not register the flag at all rather than advertising an inert one. `card`, `diff`, `scry`, `cache status`, `dep-license`, `history`, `login status`, `deck-sync status`, and `skills list` therefore accept `--output` but no `--quiet`: everything they print is either the payload or a warning that has to survive anyway.

### Exit codes

| Code | Meaning                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                             |
| `1`  | Runtime error — the work was attempted and failed                                                                   |
| `2`  | Usage error — a bad flag value or an impossible combination, including a malformed `--base-dir` or `--cache-server` |
| `3`  | Not found — a named list, file, card, or other resource does not exist                                              |

A closed stdout pipe is not a failure: `ritual … --output ndjson | head` stops quietly and exits `0`, like any standard Unix tool.

## The card-ID backfill

Every card line in a list file ends in a stable internal ID, the `&N` suffix (`- 1 Sol Ring &5`). Ritual manages these IDs; never hand-author or renumber them. When a file is missing IDs, typically after a hand edit, Ritual fills them in automatically before running any command that rewrites card lines or needs every line to carry an ID:

- the editors: `edit`, `history`'s editor mode, `admin` (the server itself, not its `setup`/`reset-password`/`disable-totp` subcommands), `mcp`, and `serve --build`/`--api`;
- the one-shot card commands: `add-card`, `remove-card`, `set-card`, `note`, and `move`;
- the importers and syncs: `import`, `import-account`, `import-changes`, `deck-sync pull`/`deck-sync push` (but not the read-only `deck-sync status` or the front-matter-only `deck-sync link`), and `collection-sync`;
- the whole-workspace passes: `cleanup` and `build-site`;
- [`set-list-image`](/commands/set-list-image/), only when the run consumes an `&N` (`--card`, or the wizard's card picker), and never for `--file`, `--url`, or `--default`.

No other command triggers the backfill, so no other command rewrites the card lines in your list files. That covers:

- the read-only commands (`lists`, `diff`, `price`, `sell`, `export`, `get-primer`, `history --show`, `list-all-cards`, `scry`, `card`, ...);
- the lifecycle commands `new`, `rename`, and `delete`, which create, move, or remove list files but never touch card lines;
- the front-matter-only [`metadata`](/commands/metadata/) command and the front-matter-only modes of `set-list-image`;
- the sidecar-only [`categories`](/commands/categories/) command;
- `detect-changes`, in all three of its modes, since a backfill would rewrite the very files it is inspecting (`--hash-only` still writes `.sha256` sidecars, as that is its job).

`-n`/`--dry-run` also skips the backfill: a dry run writes nothing.

The backfill never hides a hand edit from change tracking. It refreshes a file's `.sha256` sidecar only when the sidecar already matched the file, so [`detect-changes`](/commands/detect-changes/) still sees your edits and records their changelog entries.
