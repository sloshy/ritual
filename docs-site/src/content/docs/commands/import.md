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

| Option                          | Applies to | Description                                                                                                                                                                                                                                                             |
| ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-t, --type <type>`             | files      | List type for a file import: `deck`, `collection`, or `wanted`. Skips the interactive prompt. URLs always import decks.                                                                                                                                                 |
| `--name <name>`                 | CSV        | Name of the list to create or append to                                                                                                                                                                                                                                 |
| `--deck-format <format>`        | CSV        | Deck format when creating a deck (e.g. `commander`, `modern`)                                                                                                                                                                                                           |
| `-c, --columns <mapping>`       | CSV        | Column mapping (see below). Skips the interactive setup wizard.                                                                                                                                                                                                         |
| `--no-header`                   | CSV        | Treat the first row as data instead of a header row                                                                                                                                                                                                                     |
| `--append`                      | CSV        | Append the cards to an existing list instead of creating a new one                                                                                                                                                                                                      |
| `--csv`                         | files      | Treat the source file as CSV regardless of its extension                                                                                                                                                                                                                |
| `-o, --overwrite`               | all        | Overwrite existing lists without prompting                                                                                                                                                                                                                              |
| `-y, --yes`                     | all        | Automatically answer yes to the overwrite confirmation when an import conflicts with an existing list                                                                                                                                                                   |
| `-n, --dry-run`                 | all        | Preview actions without writing files                                                                                                                                                                                                                                   |
| `--sync-printings`              | URLs       | Keep the exact printings (set, collector number, finish) the source lists, without asking — see [Printings from a URL import](#printings-from-a-url-import)                                                                                                             |
| `--no-sync-printings`           | URLs       | Import bare card names, dropping the printings the source lists, without asking                                                                                                                                                                                         |
| `--moxfield-user-agent <agent>` | URLs       | Moxfield-approved unique User-Agent string (required for Moxfield imports unless env is set)                                                                                                                                                                            |
| `--output <format>`             | all        | Output format: `text` (default), `json`, or `ndjson`                                                                                                                                                                                                                    |
| `--quiet`                       | all        | Suppress progress and confirmation lines on every source kind (URL, text, CSV). Never suppressed: the structured payload, errors, the conflict messages and prompt, the `Overwriting <file>...` notice, advisories, the header-row warning, and the skipped-line report |

Flags are validated against the resolved source: a CSV-only flag on a URL or text-file
import, or `--moxfield-user-agent` / `--sync-printings` / `--no-sync-printings` on a CSV
**or text-file** import, fails with a usage error (exit code `2`) naming the offending
flag. Those three only apply to URL imports — a local file's printings are the file's
own data.

## Printings from a URL import

Archidekt and Moxfield state each card's exact printing — set code, collector number,
and foil/etched finish — and keeping that is a choice, the same one
[`deck-sync --sync-printings`](/commands/deck-sync/#printing-sync---sync-printings)
makes explicit:

- **Neither flag** — the import asks
  (`Import the exact printings (set, collector number, and finish) the source lists?`,
  default yes). Declining writes bare card names (`1 Sol Ring` instead of
  `1 Sol Ring (LTC:284) [foil]`); sections and everything else are unaffected, and
  cards that differed only by printing collapse into one line with their quantities
  summed. A deck whose entries state no printing at all (MTGGoldfish) has nothing
  to decide and never asks. `--output json`/`ndjson` cannot host the prompt, so with
  neither flag such a run is refused; the emitted payload records the decision as
  `syncPrintings` on URL imports.
- **`--sync-printings`** — keep them, without asking.
- **`--no-sync-printings`** — drop them, without asking. Good for scripted runs and
  agent tooling that must not block on a prompt.
- **`--no-input`** (with neither flag) — keeps the printings, the command's historical
  behavior, and says so:
  `Keeping the exact printings the source lists (pass --no-sync-printings to import bare card names).`
  Without a terminal and without `--no-input`, the unanswerable prompt is a usage error
  naming both flags.

[`import-account`](/commands/import-account/) takes the same pair of flags, asked once
for the whole run. The admin site's Import Deck page has the same choice as a checkbox
(ticked by default), and the MCP `import_deck` tool requires a `syncPrintings` boolean
on every URL import.

`-y, --yes` answers the overwrite confirmation on conflicts — for that purpose it is
equivalent to `--overwrite`. Neither flag disables prompting; use the global `--no-input`
for headless runs.

Cancelling any interactive prompt — the conflict prompt's **Cancel**, the list-type
prompt, the [printings prompt](#printings-from-a-url-import), or any step of the CSV
wizard — aborts the import with `Cancelled.` on stderr and exit code `2`; in JSON modes
nothing is written to stdout.

## Dry Runs

`-n, --dry-run` previews an import: the source is fetched or read, every card is resolved
and validated, and the summary reports exactly what would be written — but **nothing on
disk changes**. That includes directories: a dry run does not create the `decks/`,
`collections/`, or `wanted/` directory it would have written into, so previewing an import
in a fresh directory leaves that directory holding only the file you imported from.

A dry run that would replace an existing list says so rather than reading like a fresh
create: `[dry-run] Would overwrite deck: <path>` (or `[dry-run] Would overwrite
collection: <path>`) in place of `[dry-run] Would save deck to: <path>`, and the JSON
payload's `action` is `overwritten`.

Warnings still surface and still affect the exit code — see
[Partial Failures](#partial-failures).

## Scripting Without Prompts

The global `--no-input` flag (or the `RITUAL_NO_INPUT` environment variable) is the headless
switch: with it, `import` never prompts.

For URL and text-file imports:

- A text file import without `--type` defaults to a **deck** (logged, so the defaulting is
  visible). Pass `--type` to import a collection or wanted list.
- A name/ID conflict with an existing list fails with a usage error (exit code `2`) instead of
  prompting — pass `--overwrite` or `--yes` to replace the existing list. A name conflict is
  judged by [list-name folding](/commands/list-resolution/#names-that-would-collide-are-refused-at-creation),
  not by the file name alone, so importing `atraxa superfriends` beside `Atraxa Superfriends.md`
  is a conflict rather than a second, mutually-unaddressable list. The same error and
  exit code apply whenever [prompts are unavailable](/#when-prompts-are-unavailable), including
  a plain piped run without `--no-input`.

For CSV imports, prompts are unavailable — and every required value must come from a flag —
when any of the following holds:

- prompts are disabled globally (`--no-input` or `RITUAL_NO_INPUT`),
- stdin is not a terminal (piped or redirected input), or
- `--columns` is given (an explicit mapping means the import is scripted).

A scripted CSV run missing `--type`, `--name`, `--columns`, or (when creating a deck)
`--deck-format` fails with a usage error (exit code `2`) instead of prompting.

Without `--no-input`, a run whose stdin is not a terminal fails with a usage error
(exit code `2`) whenever a prompt would be required — the two causes are treated identically
(see [when prompts are unavailable](/#when-prompts-are-unavailable)).

The one deliberate exception is the missing-`--type` default above: it applies only under an
explicit `--no-input`/`RITUAL_NO_INPUT`. A piped run without `--type` is a usage error, since
nothing said which list type was intended.

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
  "warnings": [],
  "advisories": []
}
```

`action` is `created`, `overwritten`, or `renamed` (the interactive rename resolution).
`warnings` lists any text-file lines the parser skipped (always empty for URL imports);
a non-empty array means content was lost and the command exits `1` (see
[Partial Failures](#partial-failures)). `advisories` lists lines that **were** imported but
looked off — a card name still carrying a printing token, or a skipped Arena `About` line;
advisories print on stderr (even under `--quiet`) and never change the exit code. A URL
import's payload additionally carries `syncPrintings` — whether the written deck kept the
[exact printings the source listed](#printings-from-a-url-import).

A CSV import emits a structured result instead:

```json
{
  "imported": 4,
  "failed": 1,
  "failures": [{ "line": 3, "reason": "Invalid quantity 'x'" }],
  "filePath": "collections/Red Binder.md",
  "mode": "create",
  "dryRun": false,
  "replacesExisting": false
}
```

`imported` counts copies written, `failures` lists the rejected rows by CSV line number, and
`mode` is the resolved `create`/`overwrite`/`append`. `replacesExisting` is `true` when the
import replaced — or, under `--dry-run`, would replace — a list that already existed. Errors are emitted on stderr as
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

### Printings from URL Imports

Archidekt and Moxfield state which printing each card in the deck is, and keeping that
is a choice — see [Printings from a URL import](#printings-from-a-url-import). When kept,
the line is written as `1 Sol Ring (C19:221)`, with `[foil]` or `[etched]` when the source
says so, carried through exactly as the source states it — nothing is verified against
Scryfall, the same trust level as a CSV import. Cards of the same printing in one section
merge into a single line; different printings of the same card stay separate lines.

MTGGoldfish deck pages carry no printing data, so those imports remain name-only.

## Deck Format

A deck imported from a URL or text file is written with a `format:` in its front matter
**when one can be established** — otherwise the deck is written without a `format:`, which
you can add later by editing the file's front matter.

A format is established in one of two ways:

1. **The source reports it.** Archidekt and Moxfield do, and the reported format is mapped
   onto Ritual's format keys (Archidekt's "Commander / EDH" and Moxfield's `commander` both
   become `commander`). A format Ritual does not model (Archidekt's "Custom", Moxfield's
   `none`) counts as not reported.
2. **The deck's sections imply it.** Inference only recognizes a command zone: a
   `## Commander` section means Commander, and an `## Oathbreaker` section means
   Oathbreaker. Nothing else is inferred — a plain `Main`/`Sideboard` text decklist imports
   with **no** `format:`.

MTGGoldfish reports no format, so a MTGGoldfish import gets a format only through
inference. See [new](/commands/new/#deck-format) for the full list of format keys.

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

In a **deck**, rows naming the same card **and** the same printing merge into one line with
the quantities summed — in create/overwrite mode as well as append, so the same file
produces the same list either way. A different printing (set, collector number, finish, or
condition) stays its own line. **Collections and wanted lists** keep one bullet line per
physical copy in every mode, so N rows of the same printing stay N lines (each with its own
`&N` id).

Replacing an existing list prints `Overwriting <file>...` on stderr, even under `--quiet`,
so a destructive import is never silent. This holds for every source kind — URL, text file,
and CSV. Under `--dry-run` the preview line says it instead
(`[dry-run] Would overwrite collection 'Red Binder' with 12 card(s): ...`), and the JSON
payload carries `replacesExisting: true`.

By default the import **creates** a new list and refuses to touch an existing one — including a
list whose name merely [folds onto](/commands/list-resolution/#names-that-would-collide-are-refused-at-creation)
the one being imported. Pass
`--overwrite` to replace an existing list, or `--append` to add the cards to it
(`--overwrite` and `--append` are mutually exclusive). `--yes` auto-answers an existing-file
conflict with overwrite, like it does for URL and text-file imports. Interactively, when a
list with the chosen name already exists, the wizard asks whether to append, overwrite, or
cancel — cancelling exits `2` with `Cancelled.` on stderr. In a scripted run (see
[when prompts are unavailable](/#when-prompts-are-unavailable), or any run with `--columns`)
the same conflict is a usage error (exit `2`) naming `--append`, `--overwrite`, and `--yes`.

Appending:

- Resolves the list name like every other command (case- and accent-insensitive, substring fallback).
- Continues the list's `&N` card IDs from its existing pool.
- For decks, merges rows into existing lines when the name and printing match (incrementing quantity) and creates any missing sections.
- Records every added card in the list's changelog (visible in `ritual history` and the admin Change History page).
- Rewrites the whole target file in canonical form, so it **refuses** (exit `1`, nothing written) when
  that file holds content the rewrite cannot reproduce: a line the parser could not read, or a
  [fenced code block](/commands/edit/#fenced-code-blocks). `--overwrite` has no such gate — replacing
  the file is the point.

A `--dry-run` CSV import performs every validation and resolution step — including the
row conversion and its failures — but writes neither the list file nor a changelog.

### Header Rows

The wizard asks whether the first row is a header. A scripted run (`--columns`) does not
ask: the first row is treated as a header unless `--no-header` is given. Because that
assumption drops a row, a scripted run always says which one — `Skipping header row: ...` —
and when the dropped row does **not** look like a header (none of its cells match a known
column name), an extra warning names `--no-header`:

```
Warning: the first row does not look like a header but was skipped as one: Lightning Bolt,lea,161,4 — pass --no-header to import it as a card.
```

That warning goes to stderr and survives `--quiet`, since a data-shaped "header" is almost
certainly a lost card. `--no-header` always wins outright: with it, no row is dropped and
neither line is printed.

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
| `language`         | Card language (Scryfall codes or aliases — see below).               |
| `section`          | Section/board. Blank cells fall back to `Main`.                      |
| `quantity`         | Copies per row. Blank cells mean one copy.                           |

Every mapped column number is checked against the file's width before any row is
converted: `--columns name=99` on a 6-column file is a single usage error (exit `2`) —
`Column 99 (mapped to 'name') does not exist: the file has 6 column(s)` — rather than a
`Missing card name` failure for every row.

After the wizard completes, the command prints a ready-to-run `ritual import ... --columns ...`
line that pre-selects the same answers, so you can repeat the import without the wizard
(including `--csv` when the file's extension would not trigger CSV detection on its own).

### Value Normalization

CSV exports differ between tools, so cell values are normalized during import (all matching is case-insensitive):

- **Condition** — canonical codes (`NM`, `LP`, `MP`, `HP`, `DMG`), spelled-out names (`Near Mint`, `Lightly Played`/`Light Played`/`Slightly Played`, `Moderately Played`, `Heavily Played`/`Heavy Played`, `Damaged`, plus `Mint`, `Played`, `Poor`), short codes (`SP` → LP, `PL` → MP), and single letters (`N`, `M`, `L`, `H`, `D`).
- **Finish** — `F`/`foil` (and `yes`/`true`/`1`) for foil, `E`/`etched`/`etched foil`/`foil etched` for etched; empty cells, `non-foil`/`nonfoil`, `normal`, `regular`, `no`, `false`, and `0` all mean non-foil.
- **Language** — Scryfall codes (`en`, `ja`, `zhs`, ...), common printed-code aliases (`JP` → `ja`, `KR` → `ko`, `SP` → `es`, `CS` → `zhs`, `CT` → `zht` — Archidekt's CSV vocabulary), and full English names (`Japanese` → `ja`). An **explicit** cell value is honored as-is, and a **blank** cell in a present language column means English — the source recorded no language, so none is invented. Only when the import carries no language column at all are pinned rows stamped with the configured [`defaultLanguage`](/configuration/#default-language) — falling back to English when the printing does not exist in that language, then to the printing's only available language. Rows without a pinned printing are never stamped. English is written as a bare line (no token).
- **Section** — blank means `Main`. For decks, common board names normalize to canonical headers: `side`/`sideboard`/`sb` → `Sideboard`, `maybe`/`maybeboard` → `Maybeboard`, `main`/`mainboard`/`maindeck`/`deck` → `Main`, `commander`/`command`/`command zone` → `Commander`. Anything else becomes a custom section verbatim.
- **Quantity** — a positive integer, tolerating `4x`/`x4`.
- **Set codes** — stored lowercase internally and written uppercase in the markdown output, like everywhere else in Ritual.

### Partial Failures

Rows that fail validation (missing name, missing printing for a collection, unrecognized condition/finish/quantity) do **not** abort the import: every valid row is imported, and each failed row is reported with its line number, raw text, and reason. When any row fails, the command exits non-zero (`1`) even though the import was written — check stderr for the failed lines.

Text-file imports behave the same way: a body line that is neither a section header nor a card line (see [Local Text File Format](#local-text-file-format)) is skipped and reported — on stderr in text mode (`N line(s) could not be imported:` followed by each `Skipped malformed line: ...`), or in the JSON `warnings` array under `--output json`/`ndjson` — and makes the command exit `1` in every mode even though the import was written. `--dry-run` reports the same warnings, so a preview reveals the loss too.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success — the import was written, or fully previewed under `--dry-run`                                                                                                                                                  |
| `1`  | Runtime failure — a fetch or parse error, or a partial failure (CSV rows or text lines skipped)                                                                                                                         |
| `2`  | Usage error — invalid or misapplied flags, an unsupported URL, a name/ID conflict with no `--overwrite`/`--append`/`--yes`, a required prompt when input is unavailable, or a cancelled prompt (`Cancelled.` on stderr) |
| `3`  | Not found — the source file does not exist                                                                                                                                                                              |

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

### MTG Arena / MTGO Exports

Text imports also read the MTG Arena (and MTGO) export dialect, so a list copied straight
out of Arena imports without editing:

```
About
Name Mono-Red Aggro

Commander
1 Krenko, Mob Boss (M19) 149

Deck
4 Lightning Bolt (M10) 146
2 Shock (M20) 160

Sideboard
2 Pyroblast (ICE) 213
```

- `N Name (SET) NUM` card lines become printings — `4 Lightning Bolt (M10:146)` — instead
  of card names containing the printing text.
- A trailing `*F*` / `*E*` finish marker (Moxfield's, Archidekt's, and MTGO's plain-text
  exports append one) becomes the card's finish: `1 Sol Ring (LTC) 284 *F*` imports as
  `1 Sol Ring (LTC:284) [foil]`.
- Bare `Deck`, `Sideboard`, `Commander`, and `Companion` marker lines start sections
  (`Deck` is `Main`). A marker with no cards under it is a dropped section and warns like
  an empty `##` header would.
- An `About` block's `Name ...` line names the deck; the block's other lines are skipped
  with an advisory.

**A set with no collector number is not read as a printing.** A card line can only carry
`(SET:NUM)` — half a printing cannot be written back — and a trailing parenthesized word is
a real part of many card names (`Very Cryptic Command (Untap)`, `Hazmat Suit (Used)`). So
`1 Sol Ring (LTC)` keeps the name exactly as written and prints an advisory instead of
inventing a printing and then dropping it on the way to disk. The same rule applies to URL
imports: a source that names a set but no collector number yields a name-only card line.

### Fenced Decklists

A decklist pasted from Discord, Reddit, or GitHub usually arrives wrapped in a ``` fence.
On the **import path** the fence is packaging: its delimiter lines are dropped and the lines
inside are parsed like any other, so the cards import normally.

This applies to imports only (`ritual import <file>` and the admin/MCP paste-text route).
Everywhere else a
[fenced code block is prose](/commands/edit/#fenced-code-blocks) that the parsers leave
untouched.

This dialect applies to **imports only**. Loading Ritual's own list files keeps the strict
format above, so a marker word or a `(SET) NUM` suffix in a list file is never silently
reinterpreted.

If a card line's format is not recognized at all and the parsed name still contains a
parenthesized set-like token, the import writes the card but prints an advisory naming the
line (`Warning: Card name still contains a printing token, ...`). Advisories go to stderr,
survive `--quiet`, appear in the JSON `advisories` array, and do **not** change the exit
code — nothing was lost, but the name is probably not what you wanted.

### Skipped Lines

Any body line matching none of the above — a bare card name with no leading
quantity, a stray marker word the Arena dialect does not define, prose — is **skipped**, not
imported. Every skipped line is reported and the command exits `1` so a lossy
import never looks clean (see [Partial Failures](#partial-failures)).
