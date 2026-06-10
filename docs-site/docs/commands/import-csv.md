---
sidebar_position: 3
---

# import-csv

Import cards from a CSV file into a **new** deck, collection, or wanted list. An interactive setup wizard maps your CSV's columns to card fields, and prints the equivalent non-interactive command so the same import can be scripted.

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

| Option                    | Description                                                     |
| ------------------------- | --------------------------------------------------------------- |
| `-t, --type <type>`       | List type to create: `deck`, `collection`, or `wanted`          |
| `-n, --name <name>`       | Name for the new list                                           |
| `-f, --format <format>`   | Deck format (deck imports only, e.g. `commander`, `modern`)     |
| `-c, --columns <mapping>` | Column mapping (see below). Skips the interactive setup wizard. |
| `--no-header`             | Treat the first row as data instead of a header row             |
| `-o, --overwrite`         | Overwrite an existing list file with the same name              |
| `--non-interactive`       | Disable interactive prompts; fail when input is required        |

Every import requires a name, and deck imports also require a format. Interactively the wizard prompts for them; non-interactively pass `--name` (and `--format`).

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
