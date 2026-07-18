---
title: 'import-csv'
---

Import cards from a CSV file into a deck, collection, or wanted list — creating a new list or appending to an existing one. An interactive setup wizard maps your CSV's columns to card fields, and prints the equivalent flag-only command so the same import can be scripted.

CSV import is also available in the [admin site](/commands/admin/#import-csv) (**Import CSV** page) and as the [MCP](/commands/mcp/) `import_csv` tool, both backed by the same engine.

## Usage

```bash
./ritual import-csv <file>
```

Run with no other flags to use the interactive wizard. The wizard asks for the list type, a name (and deck format for decks), whether the first row is a header, and which column holds each card field.

## Arguments

| Argument | Description          | Required |
| -------- | -------------------- | -------- |
| `<file>` | Path to the CSV file | Yes      |

## Options

| Option                    | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `-t, --type <type>`       | List type to import into: `deck`, `collection`, or `wanted`        |
| `--name <name>`           | Name of the list to create or append to                            |
| `-f, --format <format>`   | Deck format when creating a deck (e.g. `commander`, `modern`)      |
| `-c, --columns <mapping>` | Column mapping (see below). Skips the interactive setup wizard.    |
| `--no-header`             | Treat the first row as data instead of a header row                |
| `-o, --overwrite`         | Replace an existing list file with the same name                   |
| `-a, --append`            | Append the cards to an existing list instead of creating a new one |
| `--output <format>`       | Output format: `text` (default), `json`, or `ndjson`               |
| `--quiet`                 | Suppress non-essential output                                      |

Every import requires a name, and creating a deck also requires a format (appending to a deck does not — the format is already in the file). Interactively the wizard prompts for them; in a scripted run pass `--name` (and `--format`).

## Scripting Without Prompts

The wizard's prompts are unavailable — and every required value must come from a flag — when
any of the following holds:

- prompts are disabled globally (`--no-input` or `RITUAL_NO_INPUT`),
- stdin is not a terminal (piped or redirected input), or
- `--columns` is given (an explicit mapping means the import is scripted).

A scripted run missing `--type`, `--name`, `--columns`, or (when creating a deck) `--format`
fails with a usage error (exit code `2`) instead of prompting.

With `--output json` (or `ndjson`) the command emits a structured result on success:

```json
{
  "imported": 4,
  "failed": 1,
  "failures": [{ "line": 3, "reason": "Invalid quantity 'x'" }],
  "filePath": "collections/Red Binder.md",
  "mode": "create"
}
```

`imported` counts copies written, `failures` lists the rejected rows by CSV line number, and
`mode` is the resolved `create`/`overwrite`/`append`. Errors are emitted on stderr as
`{ "error": { "code", "message" } }` in JSON modes. A partial failure still exits `1` even
though the payload was emitted (see below).

## Create, Overwrite, or Append

By default the import **creates** a new list and refuses to touch an existing one. Pass `--overwrite` to replace an existing list, or `--append` to add the cards to it (`--overwrite` and `--append` are mutually exclusive). Interactively, when a list with the chosen name already exists, the wizard asks whether to append, overwrite, or cancel.

Appending:

- Resolves the list name like every other command (case- and accent-insensitive, substring fallback).
- Continues the list's `&N` card IDs from its existing pool.
- For decks, merges rows into existing lines when the name and printing match (incrementing quantity) and creates any missing sections.
- Records every added card in the list's changelog (visible in `ritual history` and the admin Change History page).

## Column Mapping

`--columns` takes a comma-separated list of `field=column` pairs with **1-based** column numbers:

```bash
./ritual import-csv cards.csv --type collection --name "Red Binder" \
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

After the wizard completes, the command prints a ready-to-run `ritual import-csv ... --columns ...` line that pre-selects the same answers, so you can repeat the import without the wizard.

## Value Normalization

CSV exports differ between tools, so cell values are normalized during import (all matching is case-insensitive):

- **Condition** — canonical codes (`NM`, `LP`, `MP`, `HP`, `DMG`), spelled-out names (`Near Mint`, `Lightly Played`/`Light Played`/`Slightly Played`, `Moderately Played`, `Heavily Played`/`Heavy Played`, `Damaged`, plus `Mint`, `Played`, `Poor`), short codes (`SP` → LP, `PL` → MP), and single letters (`N`, `M`, `L`, `H`, `D`).
- **Finish** — `F`/`foil` (and `yes`/`true`/`1`) for foil, `E`/`etched`/`etched foil`/`foil etched` for etched; empty cells, `non-foil`/`nonfoil`, `normal`, `regular`, `no`, `false`, and `0` all mean non-foil.
- **Section** — blank means `Main`. For decks, common board names normalize to canonical headers: `side`/`sideboard`/`sb` → `Sideboard`, `maybe`/`maybeboard` → `Maybeboard`, `main`/`mainboard`/`maindeck`/`deck` → `Main`, `commander`/`command`/`command zone` → `Commander`. Anything else becomes a custom section verbatim.
- **Quantity** — a positive integer, tolerating `4x`/`x4`.
- **Set codes** — stored lowercase internally and written uppercase in the markdown output, like everywhere else in Ritual.

## Partial Failures

Rows that fail validation (missing name, missing printing for a collection, unrecognized condition/finish/quantity) do **not** abort the import: every valid row is imported, and each failed row is reported with its line number, raw text, and reason. When any row fails, the command exits non-zero (`1`) even though the import was written — check stderr for the failed lines.

## Examples

Interactive import (wizard maps the columns):

```bash
./ritual import-csv ./moxfield-export.csv
```

Scripted collection import:

```bash
./ritual import-csv binder.csv --type collection --name "Red Binder" \
  --columns "name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6"
```

Scripted deck import from a headerless CSV:

```bash
./ritual import-csv burn.csv --type deck --name "Burn" --format modern \
  --columns "quantity=1,name=2,section=3" --no-header
```

Replace an existing list:

```bash
./ritual import-csv binder.csv --type collection --name "Red Binder" \
  --columns "name=1,set=2,collector-number=3" --overwrite
```

Append new cards to an existing collection:

```bash
./ritual import-csv new-cards.csv --type collection --name "Red Binder" \
  --columns "name=1,set=2,collector-number=3,quantity=4" --append
```
