---
title: 'import'
---

Import a deck from a URL, or a deck, collection, or wanted list from a local text or CSV file.

## Usage

```bash
./ritual import <source>
```

The source decides how the import runs:

- **URL** — a deck URL from a supported service (Archidekt, Moxfield, MTGGoldfish). URL
  imports always create decks — importing a collection or wanted list from a URL is not
  supported.
- **CSV file** — a path ending in `.csv` (case-insensitive), or any file with the `--csv`
  flag. An interactive setup wizard maps the CSV's columns to card fields, and prints the
  equivalent flag-only command so the same import can be scripted. See
  [CSV Imports](#csv-imports).
- **Text file** — any other path. `import` asks whether the cards are a deck, a collection,
  or a wanted list (pass `--type` to skip the prompt).

The scheme is optional for supported deck sites: `archidekt.com/decks/12345`
is treated as `https://archidekt.com/decks/12345`. A source with an explicit
scheme (`https://`, `http://`, etc.) is always treated as a URL — an
unsupported host fails with an "URL not supported" usage error (exit code 2)
rather than falling back to a file lookup. Only scheme-less input falls back
to a local file path, so relative paths and file names containing dots keep
working.

CSV import is also available in the [admin site](/commands/admin/#import-csv) (**Import
CSV** page) and as the [MCP](/commands/mcp/) `import_csv` tool, both backed by the same
engine.

## Arguments

| Argument   | Description                                             | Required |
| ---------- | ------------------------------------------------------- | -------- |
| `<source>` | URL (Archidekt/Moxfield/MTGGoldfish) or local file path | Yes      |

## Options

| Option                          | Applies to | Description                                                                                                             |
| ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `-t, --type <type>`             | files      | List type for a file import: `deck`, `collection`, or `wanted`. Skips the interactive prompt. URLs always import decks. |
| `--name <name>`                 | CSV        | Name of the list to create or append to                                                                                 |
| `--deck-format <format>`        | CSV        | Deck format when creating a deck (e.g. `commander`, `modern`)                                                           |
| `-c, --columns <mapping>`       | CSV        | Column mapping (see below). Skips the interactive setup wizard.                                                         |
| `--no-header`                   | CSV        | Treat the first row as data instead of a header row                                                                     |
| `--append`                      | CSV        | Append the cards to an existing list instead of creating a new one                                                      |
| `--csv`                         | files      | Treat the source file as CSV regardless of its extension                                                                |
| `-o, --overwrite`               | all        | Overwrite existing lists without prompting                                                                              |
| `-y, --yes`                     | all        | Automatically answer yes to the overwrite confirmation when an import conflicts with an existing list                   |
| `-n, --dry-run`                 | all        | Preview actions without writing files                                                                                   |
| `--moxfield-user-agent <agent>` | URLs       | Moxfield-approved unique User-Agent string (required for Moxfield imports unless env is set)                            |
| `--output <format>`             | all        | Output format: `text` (default), `json`, or `ndjson`                                                                    |
| `--quiet`                       | all        | Suppress non-essential output                                                                                           |

Flags are validated against the resolved source: a CSV-only flag on a URL or text-file
import, or `--moxfield-user-agent` on a CSV import, fails with a usage error (exit code
`2`) naming the offending flag.

`-y, --yes` answers the overwrite confirmation on conflicts — for that purpose it is
equivalent to `--overwrite`. Neither flag disables prompting; use the global `--no-input`
for headless runs.

Cancelling any interactive prompt — the conflict prompt's **Cancel**, the list-type
prompt, or any step of the CSV wizard — aborts the import with `Cancelled.` on stderr
and exit code `2`; in JSON modes nothing is written to stdout.

## Scripting Without Prompts

The global `--no-input` flag (or the `RITUAL_NO_INPUT` environment variable) is the headless
switch: with it, `import` never prompts.

For URL and text-file imports:

- A text file import without `--type` defaults to a **deck** (logged, so the defaulting is
  visible). Pass `--type` to import a collection or wanted list.
- A name/ID conflict with an existing list fails (exit code `1`) instead of prompting —
  pass `--overwrite` or `--yes` to replace the existing list.

For CSV imports, prompts are unavailable — and every required value must come from a flag —
when any of the following holds:

- prompts are disabled globally (`--no-input` or `RITUAL_NO_INPUT`),
- stdin is not a terminal (piped or redirected input), or
- `--columns` is given (an explicit mapping means the import is scripted).

A scripted CSV run missing `--type`, `--name`, `--columns`, or (when creating a deck)
`--deck-format` fails with a usage error (exit code `2`) instead of prompting.

Without `--no-input`, a run whose stdin is not a terminal fails with a usage error
(exit code `2`) whenever a prompt would be required.

## JSON Output

With `--output json` (or `ndjson`), a URL or text-file import emits a summary on success:

```json
{
  "source": "./binder.txt",
  "listType": "collection",
  "name": "binder",
  "filePath": "collections/binder.md",
  "action": "created",
  "dryRun": false,
  "warnings": []
}
```

`action` is `created`, `overwritten`, or `renamed` (the interactive rename resolution).
`warnings` lists any text-file lines the parser skipped (always empty for URL imports);
a non-empty array means content was lost and the command exits `1` (see
[Partial Failures](#partial-failures)).

A CSV import emits a structured result instead:

```json
{
  "imported": 4,
  "failed": 1,
  "failures": [{ "line": 3, "reason": "Invalid quantity 'x'" }],
  "filePath": "collections/Red Binder.md",
  "mode": "create",
  "dryRun": false
}
```

`imported` counts copies written, `failures` lists the rejected rows by CSV line number, and
`mode` is the resolved `create`/`overwrite`/`append`. Errors are emitted on stderr as
`{ "error": { "code", "message" } }` in JSON modes. A partial failure still exits `1` even
though the payload was emitted (see [Partial Failures](#partial-failures)).

## Supported Sources

| Source      | Example                                  |
| ----------- | ---------------------------------------- |
| Archidekt   | `https://archidekt.com/decks/12345`      |
| Moxfield    | `https://moxfield.com/decks/abc123`      |
| MTGGoldfish | `https://www.mtggoldfish.com/deck/12345` |
| Text File   | `./my-deck.txt`                          |
| CSV File    | `./moxfield-export.csv`                  |

## Deck Format

A deck imported from a URL or text file is written with a `format:` in its front matter.
Archidekt and Moxfield report the deck's format, and it is mapped onto Ritual's format keys
(Archidekt's "Commander / EDH" and Moxfield's `commander` both become `commander`).
When the source reports a format Ritual does not model, or reports none at all — as
MTGGoldfish and plain text files do — the format is inferred from the deck's
sections: a `## Commander` section means Commander. See
[new](/commands/new/#deck-format) for the full list.

CSV rows carry no sections to infer from, so creating a deck from a CSV requires an explicit
`--deck-format` (or the wizard's format prompt). Appending to a deck does not — the format
is already in the file.

## CSV Imports

Run with no other flags to use the interactive wizard:

```bash
./ritual import ./moxfield-export.csv
```

The wizard asks for the list type, a name (and deck format for decks), whether the first
row is a header, and which column holds each card field. Every import requires a name, and
creating a deck also requires a deck format; in a scripted run pass `--name` (and
`--deck-format`).

### Create, Overwrite, or Append

By default the import **creates** a new list and refuses to touch an existing one. Pass
`--overwrite` to replace an existing list, or `--append` to add the cards to it
(`--overwrite` and `--append` are mutually exclusive). `--yes` auto-answers an existing-file
conflict with overwrite, like it does for URL and text-file imports. Interactively, when a
list with the chosen name already exists, the wizard asks whether to append, overwrite, or
cancel — cancelling exits `2` with `Cancelled.` on stderr.

Appending:

- Resolves the list name like every other command (case- and accent-insensitive, substring fallback).
- Continues the list's `&N` card IDs from its existing pool.
- For decks, merges rows into existing lines when the name and printing match (incrementing quantity) and creates any missing sections.
- Records every added card in the list's changelog (visible in `ritual history` and the admin Change History page).

A `--dry-run` CSV import performs every validation and resolution step — including the
row conversion and its failures — but writes neither the list file nor a changelog.

### Column Mapping

`--columns` takes a comma-separated list of `field=column` pairs with **1-based** column numbers:

```bash
./ritual import cards.csv --type collection --name "Red Binder" \
  --columns "name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6"
```

| Field              | Notes                                                                |
| ------------------ | -------------------------------------------------------------------- |
| `name`             | Card name. Always required.                                          |
| `set`              | Set code. Required for collections, optional for decks/wanted lists. |
| `collector-number` | Collector number (a string, e.g. `221★`). Required for collections.  |
| `condition`        | Card condition. Not allowed for wanted lists (they carry none).      |
| `finish`           | Foil/etched finish.                                                  |
| `section`          | Section/board. Blank cells fall back to `Main`.                      |
| `quantity`         | Copies per row. Blank cells mean one copy.                           |

After the wizard completes, the command prints a ready-to-run `ritual import ... --columns ...`
line that pre-selects the same answers, so you can repeat the import without the wizard
(including `--csv` when the file's extension would not trigger CSV detection on its own).

### Value Normalization

CSV exports differ between tools, so cell values are normalized during import (all matching is case-insensitive):

- **Condition** — canonical codes (`NM`, `LP`, `MP`, `HP`, `DMG`), spelled-out names (`Near Mint`, `Lightly Played`/`Light Played`/`Slightly Played`, `Moderately Played`, `Heavily Played`/`Heavy Played`, `Damaged`, plus `Mint`, `Played`, `Poor`), short codes (`SP` → LP, `PL` → MP), and single letters (`N`, `M`, `L`, `H`, `D`).
- **Finish** — `F`/`foil` (and `yes`/`true`/`1`) for foil, `E`/`etched`/`etched foil`/`foil etched` for etched; empty cells, `non-foil`/`nonfoil`, `normal`, `regular`, `no`, `false`, and `0` all mean non-foil.
- **Section** — blank means `Main`. For decks, common board names normalize to canonical headers: `side`/`sideboard`/`sb` → `Sideboard`, `maybe`/`maybeboard` → `Maybeboard`, `main`/`mainboard`/`maindeck`/`deck` → `Main`, `commander`/`command`/`command zone` → `Commander`. Anything else becomes a custom section verbatim.
- **Quantity** — a positive integer, tolerating `4x`/`x4`.
- **Set codes** — stored lowercase internally and written uppercase in the markdown output, like everywhere else in Ritual.

### Partial Failures

Rows that fail validation (missing name, missing printing for a collection, unrecognized condition/finish/quantity) do **not** abort the import: every valid row is imported, and each failed row is reported with its line number, raw text, and reason. When any row fails, the command exits non-zero (`1`) even though the import was written — check stderr for the failed lines.

Text-file imports behave the same way: a body line that is neither a section header nor a card line (see [Local Text File Format](#local-text-file-format)) is skipped and reported — on stderr in text mode (`N line(s) could not be imported:` followed by each `Skipped malformed line: ...`), or in the JSON `warnings` array under `--output json`/`ndjson` — and makes the command exit `1` in every mode even though the import was written. `--dry-run` reports the same warnings, so a preview reveals the loss too.

## Exit Codes

| Code | Meaning                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success — the import was written, or fully previewed under `--dry-run`                                                                                      |
| `1`  | Runtime failure — a fetch or parse error, a conflict in a headless run without `--overwrite`/`--yes`, or a partial failure (CSV rows or text lines skipped) |
| `2`  | Usage error — invalid or misapplied flags, an unsupported URL, a required prompt when input is unavailable, or a cancelled prompt (`Cancelled.` on stderr)  |
| `3`  | Not found — the source file does not exist                                                                                                                  |

## Examples

Import a deck from Archidekt:

```bash
./ritual import https://archidekt.com/decks/12345
```

Import a deck from Moxfield with an explicit user agent:

```bash
./ritual import https://moxfield.com/decks/abc123 --moxfield-user-agent "YourName Ritual Import/1.0"
```

Import from a local text file (prompts for the list type):

```bash
./ritual import ./decklist.txt
```

Import a text file into a collection:

```bash
./ritual import ./binder.txt --type collection
```

Import a text file into a wanted list without prompts:

```bash
./ritual import ./wants.txt --type wanted --no-input
```

Preview an import without writing files:

```bash
./ritual import ./decklist.txt --dry-run --no-input
```

Interactive CSV import (wizard maps the columns):

```bash
./ritual import ./moxfield-export.csv
```

Scripted CSV collection import:

```bash
./ritual import binder.csv --type collection --name "Red Binder" \
  --columns "name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6"
```

Scripted deck import from a headerless CSV:

```bash
./ritual import burn.csv --type deck --name "Burn" --deck-format modern \
  --columns "quantity=1,name=2,section=3" --no-header
```

Append new cards to an existing collection:

```bash
./ritual import new-cards.csv --type collection --name "Red Binder" \
  --columns "name=1,set=2,collector-number=3,quantity=4" --append
```

Import a CSV that lacks the `.csv` extension:

```bash
./ritual import export.txt --csv --type wanted --name "To Buy" --columns "name=1,quantity=2"
```

## Moxfield User-Agent Requirement

Moxfield imports require a unique Moxfield-approved user agent string.

- Set `MOXFIELD_USER_AGENT`, or
- Pass `--moxfield-user-agent <agent>`

If you need a unique user agent string, contact Moxfield support.

## Local Text File Format

When importing from a local text file, use the standard decklist format. `## Section`
headers split the cards into sections:

```
4 Lightning Bolt
4 Monastery Swiftspear
2 Mountain

## Sideboard
2 Pyroblast
```

Lines may also carry a printing, finish, condition, and note, e.g.
`1 Sol Ring (C19:221) [foil] [NM] {trade binder}`.

When importing into a collection or wanted list, each line expands to one
bullet line per copy (`4 Lightning Bolt` becomes four `- Lightning Bolt` lines),
matching how those lists track individual physical cards.

Collection imports require a printing (`(SET:123)`) on every line, since
collection entries always reference a specific physical printing. Wanted list
entries may be name-only.

Any body line matching none of the above — a bare card name with no leading
quantity, a stray `Sideboard` marker without `##`, prose — is **skipped**, not
imported. Every skipped line is reported and the command exits `1` so a lossy
import never looks clean (see [Partial Failures](#partial-failures)).
