---
title: 'import'
---

Import a deck from a URL, or a deck, collection, or wanted list from a local text or CSV file.

## Usage

```bash
ritual import <source>
```

The source decides how the import runs:

- **URL**: a deck URL from Archidekt, Moxfield, or MTGGoldfish. URL imports always create decks. Collections and wanted lists cannot be imported from a URL.
- **CSV file**: a path ending in `.csv` (case-insensitive), or any file with `--csv`. A setup wizard maps the CSV's columns to card fields and prints the equivalent flag-only command for scripting. See [CSV Imports](#csv-imports).
- **Text file**: any other path. `import` asks whether the cards are a deck, a collection, or a wanted list. Pass `--type` to skip the prompt.

The scheme is optional for supported deck sites: `archidekt.com/decks/12345` means `https://archidekt.com/decks/12345`. A source with an explicit scheme (`https://`, `http://`, etc.) is always a URL. An unsupported host fails with a "URL not supported" usage error (exit `2`) and never falls back to a file lookup. Only scheme-less input is tried as a local path, so relative paths and file names with dots keep working.

CSV import is also available on the [admin site](/admin/import/#import-csv) (**Import CSV** page) and as the [MCP](/commands/mcp/) `import_csv` tool.

## Arguments

| Argument   | Description                                             | Required |
| ---------- | ------------------------------------------------------- | -------- |
| `<source>` | URL (Archidekt/Moxfield/MTGGoldfish) or local file path | Yes      |

## Options

| Option                          | Applies to | Description                                                                                                                                                |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-t, --type <type>`             | files      | List type for a file import: `deck`, `collection`, or `wanted`. Skips the prompt. URLs always import decks.                                                |
| `--name <name>`                 | CSV        | Name of the list to create or append to                                                                                                                    |
| `--deck-format <format>`        | CSV        | Deck format when creating a deck (e.g. `commander`, `modern`)                                                                                              |
| `-c, --columns <mapping>`       | CSV        | Column mapping (see [Column Mapping](#column-mapping)). Skips the wizard.                                                                                  |
| `--no-header`                   | CSV        | Treat the first row as data instead of a header row                                                                                                        |
| `--append`                      | CSV        | Add the cards to an existing list instead of creating a new one                                                                                            |
| `--csv`                         | files      | Treat the source file as CSV regardless of its extension                                                                                                   |
| `-o, --overwrite`               | all        | Overwrite existing lists without prompting                                                                                                                 |
| `-y, --yes`                     | all        | Answer yes to the overwrite confirmation when an import conflicts with an existing list                                                                    |
| `-n, --dry-run`                 | all        | Preview actions without writing files                                                                                                                      |
| `--sync-printings`              | URLs       | Keep the exact printings (set, collector number, finish) the source lists, without asking. See [Printings from a URL import](#printings-from-a-url-import) |
| `--no-sync-printings`           | URLs       | Import bare card names, dropping the source's printings, without asking                                                                                    |
| `--moxfield-user-agent <agent>` | URLs       | Moxfield-approved unique User-Agent string (required for Moxfield imports unless `MOXFIELD_USER_AGENT` is set)                                             |
| `--output <format>`             | all        | Output format: `text` (default), `json`, or `ndjson`                                                                                                       |
| `--quiet`                       | all        | Suppress progress and confirmation lines for every source kind                                                                                             |

`--quiet` never suppresses: the structured payload, errors, conflict messages and prompts, the `Overwriting <file>...` notice, advisories, the header-row warning, or the skipped-line report.

Flags are checked against the resolved source. A CSV-only flag on a URL or text import, or `--moxfield-user-agent` / `--sync-printings` / `--no-sync-printings` on a CSV or text import, is a usage error (exit `2`) naming the flag. Those three apply to URL imports only; a local file's printings are the file's own data.

`--yes` answers the overwrite confirmation on conflicts, so for that purpose it equals `--overwrite`. Neither flag disables prompting; use the global `--no-input` for headless runs.

Cancelling any prompt (the conflict prompt's **Cancel**, the list-type prompt, the [printings prompt](#printings-from-a-url-import), or any CSV wizard step) aborts the import with `Cancelled.` on stderr and exit `2`. In JSON modes nothing is written to stdout.

## Supported Sources

| Source      | Example                                  |
| ----------- | ---------------------------------------- |
| Archidekt   | `https://archidekt.com/decks/12345`      |
| Moxfield    | `https://moxfield.com/decks/abc123`      |
| MTGGoldfish | `https://www.mtggoldfish.com/deck/12345` |
| Text File   | `./my-deck.txt`                          |
| CSV File    | `./moxfield-export.csv`                  |

## Local Text File Format

Use the standard decklist format: quantity-led lines, with or without Ritual's `- ` bullet (see [List Files](/list-format/)). `## Section` headers split the cards into sections:

```
4 Lightning Bolt
4 Monastery Swiftspear
2 Mountain

## Sideboard
2 Pyroblast
```

Lines may also carry a printing, finish, condition, language, labels, tags, and note, as in `1 Sol Ring (C19:221) [foil] [NM] [ja] [sale] #Ramp, Staple {trade binder}`. The `#tags` token is kept on every list type (see [Card tags](/list-format/#card-tags)). The `[sale]` / `[trade]` / `[keep]` label token is **collection-only**: a collection import keeps it, a deck import warns that it was dropped, and a wanted-list import drops it the same way.

Into a collection or wanted list, each line expands to one bullet line per copy (`4 Lightning Bolt` becomes four `- Lightning Bolt` lines). Into a deck, the quantity stays on the line and the bullet is added (`- 4 Lightning Bolt`).

Collection imports require a printing (`(SET:123)`) on every line. Wanted list entries may be name-only.

### MTG Arena / MTGO Exports

Text imports also read the MTG Arena (and MTGO) export dialect, so a list copied out of Arena imports without editing:

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

- `N Name (SET) NUM` lines become printings (`4 Lightning Bolt (M10:146)`).
- A `*F*` / `*E*` finish marker becomes the card's finish, in either position the export dialects use: trailing, as Archidekt and MTGO write it (`1 Sol Ring (LTC) 284 *F*`), or between set and collector number, as [Moxfield's bulk-edit grammar](https://moxfield.com/help) does (`1 Sol Ring (LTC) *F* 284`). Both import as `1 Sol Ring (LTC:284) [foil]`, so a `ritual export --format text --dialect moxfield` file reads straight back in.
- Bare `Deck`, `Sideboard`, `Commander`, and `Companion` lines start sections (`Deck` is `Main`). An empty `Commander` or `Companion` marker is dropped with a warning, like an empty `##` header. An empty `Deck` or `Sideboard` marker in an import that has cards elsewhere is kept as a bare header.
- An `About` block's `Name ...` line names the deck. Its other lines are skipped with an advisory.

**A set with no collector number is not read as a printing.** A card line can only carry `(SET:NUM)`, and a trailing parenthesized word is part of many real card names (`Very Cryptic Command (Untap)`, `Hazmat Suit (Used)`). So `1 Sol Ring (LTC)` keeps the name exactly as written and prints an advisory. The same rule applies to URL imports: a source that names a set but no collector number yields a name-only card line.

### Fenced Decklists

A decklist pasted from Discord, Reddit, or GitHub usually arrives wrapped in a ``` fence. On import, the fence lines are dropped and the lines inside are parsed normally.

This applies to imports only (`ritual import <file>` and the admin/MCP paste-text route). Everywhere else a [fenced code block is prose](/list-format/#fenced-code-blocks) that the parsers leave untouched.

The bare board markers and the `About` block are import-only. The `(SET) NUM` and `*F*`/`*E*` printing forms are a [read tolerance](/list-format/#read-tolerances) of the card-line grammar itself, so a list file holding them is read the same way and rewritten to `(SET:CN)` and `[foil]` on its next save.

If a card line's format is not recognized and the parsed name still contains a parenthesized set-like token, the card is written and an advisory names the line (`Warning: Card name still contains a printing token, ...`). Advisories go to stderr, survive `--quiet`, appear in the JSON `advisories` array, and do not change the exit code. Nothing was lost, but the name is probably not what you wanted.

### Skipped Lines

Any body line matching none of the above (a bare card name with no quantity, a stray marker word, prose) is **skipped**. Every skipped line is reported and the command exits `1`, so a lossy import never looks clean (see [Partial Failures](#partial-failures)).

## Printings from a URL import

Archidekt and Moxfield state each card's exact printing: set code, collector number, and foil/etched finish. Keeping that is a choice, the same one [`deck-sync --sync-printings`](/commands/deck-sync/#printing-sync---sync-printings) makes:

- **Neither flag**: the import asks `Import the exact printings (set, collector number, and finish) the source lists?` (default yes). Declining writes bare card names (`1 Sol Ring` instead of `1 Sol Ring (LTC:284) [foil]`); cards that differed only by printing collapse into one line with summed quantities. Sections and everything else are unaffected. A deck whose entries state no printing (MTGGoldfish) never asks. `--output json`/`ndjson` cannot host the prompt, so such a run with neither flag is refused.
- **`--sync-printings`**: keep them, without asking.
- **`--no-sync-printings`**: drop them, without asking. Use this for scripts and agents that must not block on a prompt.
- **`--no-input`** (with neither flag): keeps the printings and says so: `Keeping the exact printings the source lists (pass --no-sync-printings to import bare card names).` Without a terminal and without `--no-input`, the unanswerable prompt is a usage error naming both flags.

The JSON payload records the decision as `syncPrintings` on URL imports.

[`import-account`](/commands/import-account/) takes the same pair of flags, asked once for the whole run. The admin site's Import Deck page has the same choice as a checkbox (ticked by default), and the MCP `import_deck` tool requires a `syncPrintings` boolean on every URL import.

When printings are kept, the line is written as `1 Sol Ring (C19:221)`, plus `[foil]` or `[etched]` when the source says so, exactly as the source states it. Nothing is verified against Scryfall, the same trust level as a CSV import. Cards of the same printing in one section merge into a single line; different printings of the same card stay separate lines. MTGGoldfish pages carry no printing data, so those imports are name-only.

## Dry Runs

`-n, --dry-run` previews an import. The source is fetched or read, every card is resolved and validated, and the summary reports exactly what would be written, but **nothing on disk changes**. A dry run does not even create the `decks/`, `collections/`, or `wanted/` directory it would have written into.

A dry run that would replace an existing list says so: `[dry-run] Would overwrite deck: <path>` (or `... collection: <path>`) instead of `[dry-run] Would save deck to: <path>`, and the JSON payload's `action` is `overwritten`.

Warnings still surface and still affect the exit code. See [Partial Failures](#partial-failures).

## Scripting Without Prompts

The global `--no-input` flag (or `RITUAL_NO_INPUT`) is the headless switch. With it, `import` never prompts. See [when prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable) for the shared rules.

For URL and text-file imports:

- A text-file import without `--type` defaults to a **deck**, and logs that it did. Pass `--type` for a collection or wanted list. This default applies only under an explicit `--no-input`/`RITUAL_NO_INPUT`; a piped run without `--type` is a usage error, since nothing said which list type was intended.
- A name/ID conflict with an existing list is a usage error (exit `2`) instead of a prompt. Pass `--overwrite` or `--yes` to replace the list. A name conflict is judged by [list-name folding](/list-resolution/#names-that-would-collide-are-refused-at-creation), not by the file name alone, so importing `atraxa superfriends` beside `Atraxa Superfriends.md` is a conflict. The same error applies to any run where prompts are unavailable, including a plain piped run without `--no-input`.

For CSV imports, prompts are unavailable and every required value must come from a flag when any of these holds:

- prompts are disabled globally (`--no-input` or `RITUAL_NO_INPUT`),
- stdin is not a terminal, or
- `--columns` is given (an explicit mapping means the import is scripted).

A scripted CSV run missing `--type`, `--name`, `--columns`, or (when creating a deck) `--deck-format` fails with a usage error (exit `2`).

Without `--no-input`, a run whose stdin is not a terminal fails with a usage error (exit `2`) whenever a prompt would be required. The two causes are treated the same.

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

- `action` is `created`, `overwritten`, or `renamed` (the interactive rename resolution).
- `warnings` lists text-file lines the parser skipped (always empty for URL imports). A non-empty array means content was lost and the command exits `1` (see [Partial Failures](#partial-failures)).
- `advisories` lists content that **was** read but is worth a word: a card name still carrying a printing token, a skipped Arena `About` line, or an empty extras section (`## Maybeboard`, `## Tokens`) dropped because it holds nothing. Advisories print on stderr (even under `--quiet`) and never change the exit code, so a file whose only oddity is a bare `## Maybeboard` exits `0`.
- A URL import's payload also carries `syncPrintings`: whether the deck kept the [exact printings the source listed](#printings-from-a-url-import).

A CSV import emits a different result:

```json
{
  "imported": 4,
  "failed": 1,
  "failures": [{ "line": 3, "reason": "Invalid quantity 'x'" }],
  "filePath": "collections/Red Binder.md",
  "mode": "create",
  "dryRun": false,
  "replacesExisting": false,
  "advisories": []
}
```

- `imported` counts copies written. `failures` lists rejected rows by CSV line number.
- `mode` is the resolved `create`/`overwrite`/`append`.
- `replacesExisting` is `true` when the import replaced (or, under `--dry-run`, would replace) an existing list.
- `advisories` carries non-fatal notices about rows that **did** import: category values the grammar refused, category values that named a board and became the row's section, and a categories sidecar that could not be written. In text mode these print on stderr as `Warning: ...` (even under `--quiet`). They never change the exit code.
- A CSV import has no `warnings` key. On a URL or text-file import that key means content was **lost**, which exits `1`.

Errors are emitted on stderr as `{ "error": { "code", "message" } }` in JSON modes. A partial failure still exits `1` even though the payload was emitted.

## Deck Format

A deck imported from a URL or text file gets a `format:` in its front matter **when one can be established**. Otherwise the deck is written without one, and you can add it later by editing the front matter.

A format is established in one of two ways:

1. **The source reports it.** Archidekt and Moxfield do. The reported format is mapped onto Ritual's format keys (Archidekt's "Commander / EDH" and Moxfield's `commander` both become `commander`). A format Ritual does not model (Archidekt's "Custom", Moxfield's `none`) counts as not reported.
2. **The deck's sections imply it.** Only a command zone is recognized: a `## Commander` section means Commander, an `## Oathbreaker` section means Oathbreaker. A plain `Main`/`Sideboard` decklist imports with **no** `format:`.

MTGGoldfish reports no format, so those imports get a format only through inference. See [new](/commands/new/#deck-format) for the full list of format keys.

CSV rows carry no sections to infer from, so creating a deck from a CSV requires `--deck-format` (or the wizard's format prompt). Appending to a deck does not; the format is already in the file.

## CSV Imports

Run with no other flags to use the wizard:

```bash
ritual import ./moxfield-export.csv
```

The wizard asks for the list type, a name (and deck format for decks), whether the first row is a header, and which column holds each card field. In a scripted run pass `--name` (and `--deck-format`).

### Create, Overwrite, or Append

In a **deck**, rows naming the same card **and** the same printing merge into one line with summed quantities, in every mode, so the same file produces the same list either way. A different printing (set, collector number, finish, or condition) stays its own line. **Collections and wanted lists** keep one bullet line per physical copy in every mode, so N rows of the same printing stay N lines, each with its own `&N` id.

Replacing an existing list prints `Overwriting <file>...` on stderr, even under `--quiet`, for every source kind. Under `--dry-run` the preview line says it instead (`[dry-run] Would overwrite collection 'Red Binder' with 12 card(s): ...`), and the JSON payload carries `replacesExisting: true`.

By default the import **creates** a new list and refuses to touch an existing one, including a list whose name merely [folds onto](/list-resolution/#names-that-would-collide-are-refused-at-creation) the imported one. Pass `--overwrite` to replace it or `--append` to add the cards to it; the two are mutually exclusive. `--yes` auto-answers the conflict with overwrite. Interactively, the wizard asks whether to append, overwrite, or cancel; cancelling exits `2` with `Cancelled.` on stderr. In a scripted run (prompts unavailable, or any run with `--columns`) the conflict is a usage error (exit `2`) naming `--append`, `--overwrite`, and `--yes`.

Appending:

- Resolves the list name like every other command (see [List Names](/list-resolution/)).
- Continues the list's `&N` card IDs from its existing pool.
- For decks, merges rows into existing lines when name and printing match (incrementing quantity) and creates any missing sections.
- Records every added card in the list's changelog (visible in `ritual history` and the admin Change History page).
- Rewrites the whole target file in canonical form, so it **refuses** (exit `1`, nothing written) when the file holds content the rewrite cannot reproduce: a line the parser could not read, or a [fenced code block](/list-format/#fenced-code-blocks). `--overwrite` has no such gate.

A `--dry-run` CSV import performs every validation and resolution step, including row conversion and its failures, but writes neither the list file nor a changelog.

### Header Rows

The wizard asks whether the first row is a header. A scripted run (`--columns`) does not ask: the first row is a header unless `--no-header` is given. Because that drops a row, a scripted run always says which one (`Skipping header row: ...`). When the dropped row does **not** look like a header (none of its cells match a known column name), an extra warning names `--no-header`:

```
Warning: the first row does not look like a header but was skipped as one: Lightning Bolt,lea,161,4 — pass --no-header to import it as a card.
```

That warning goes to stderr and survives `--quiet`, since a data-shaped "header" is almost certainly a lost card. With `--no-header`, no row is dropped and neither line is printed.

### Column Mapping

`--columns` takes a comma-separated list of `field=column` pairs with **1-based** column numbers:

```bash
ritual import cards.csv --type collection --name "Red Binder" \
  --columns "name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6"
```

| Field              | Notes                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `name`             | Card name. Always required.                                                                                               |
| `set`              | Set code. Required for collections, optional for decks/wanted lists.                                                      |
| `collector-number` | Collector number (a string, e.g. `221★`). Required for collections.                                                       |
| `condition`        | Card condition. Not allowed for wanted lists (they carry none).                                                           |
| `finish`           | Foil/etched finish.                                                                                                       |
| `language`         | Card language (Scryfall codes or aliases — see below).                                                                    |
| `section`          | Section/board. Blank cells fall back to `Main`.                                                                           |
| `quantity`         | Copies per row. Blank cells mean one copy.                                                                                |
| `tags`             | Card tags (headers `tags` or `tag`), comma-separated: `Ramp, Card Draw` is two tags. A malformed tag fails only that row. |
| `categories`       | Card categories (headers `category` or `categories`), comma-separated: `Ramp, Artifacts` is two, the first primary.       |

Every mapped column number is checked against the file's width before any row is converted. `--columns name=99` on a 6-column file is a single usage error (exit `2`), `Column 99 (mapped to 'name') does not exist: the file has 6 column(s)`, rather than a `Missing card name` failure per row.

After the wizard completes, the command prints a ready-to-run `ritual import ... --columns ...` line with the same answers, so you can repeat the import without the wizard (including `--csv` when the extension alone would not trigger CSV detection).

### Value Normalization

CSV exports differ between tools, so cell values are normalized on import. All matching is case-insensitive.

- **Condition**: canonical codes (`NM`, `LP`, `MP`, `HP`, `DMG`); spelled-out names (`Near Mint`, `Lightly Played`/`Light Played`/`Slightly Played`, `Moderately Played`, `Heavily Played`/`Heavy Played`, `Damaged`, plus `Mint`, `Played`, `Poor`); short codes (`SP` → LP, `PL` → MP); and single letters (`N`, `M`, `L`, `H`, `D`).
- **Finish**: `F`/`foil` (and `yes`/`true`/`1`) for foil; `E`/`etched`/`etched foil`/`foil etched` for etched. Empty cells, `non-foil`/`nonfoil`, `normal`, `regular`, `no`, `false`, and `0` all mean non-foil.
- **Language**: Scryfall codes (`en`, `ja`, `zhs`, ...), printed-code aliases (`JP` → `ja`, `KR` → `ko`, `SP` → `es`, `CS` → `zhs`, `CT` → `zht`, Archidekt's CSV vocabulary), and full English names (`Japanese` → `ja`). An explicit cell value is kept as-is. A blank cell in a present language column means English. Only when the import has no language column at all are pinned rows stamped with the configured [`defaultLanguage`](/configuration/#default-language), falling back to English when the printing does not exist in that language, then to the printing's only available language. Rows without a printing are never stamped. English is written as a bare line (no token).
- **Section**: blank means `Main`. For decks, common board names normalize to canonical headers: `side`/`sideboard`/`sb` → `Sideboard`, `maybe`/`maybeboard` → `Maybeboard`, `main`/`mainboard`/`maindeck`/`deck` → `Main`, `commander`/`command`/`command zone` → `Commander`. Anything else becomes a custom section verbatim.
- **Categories**: comma-separated, in cell order, the first one primary. On a **deck**, a value that names a board (`sideboard`/`side`/`sb`, `maybeboard`/`maybe`, `commander`/`commanders`/`command`/`command zone`, `main`/`mainboard`/`maindeck`/`deck`, `tokens`/`token`, `companion`, `oathbreaker`/`signature spell` — the last yielding section `Oathbreaker`) sets the row's **section** instead of becoming a category. So Archidekt's `Ramp,Sideboard` cell yields section `Sideboard` and category `Ramp`. When a cell names two board values, the first wins. An explicit, non-empty `section` cell wins over both. Every board value is dropped from the categories either way and reported as an advisory (`Tokens` is also a shipped default category). On collections and wanted lists every value stays a category. A value that is not [category-shaped](/commands/categories/) (containing `(`, `)`, `&`, `*`, `"`, brackets, braces, or `#`, such as Archidekt's `Ramp (Rocks)`) is **ignored with a warning; the card still imports** with its other categories. The `category` header means categories, not section; `board` and `section` are the section headers. Imported categories are written to the list's `<name>.categories.json` sidecar and recorded in the changelog on `--append`.
- **Quantity**: a positive integer, tolerating `4x`/`x4`.
- **Set codes**: stored lowercase internally and written uppercase in markdown, like everywhere else in Ritual.

### Partial Failures

Rows that fail validation (missing name, missing printing for a collection, unrecognized condition/finish/quantity) do **not** abort the import. Every valid row is imported, and each failed row is reported with its line number, raw text, and reason. When any row fails, the command exits `1` even though the import was written. Check stderr for the failed lines.

Text-file imports behave the same way. A body line that is neither a section header nor a card line (see [Local Text File Format](#local-text-file-format)) is skipped and reported: on stderr in text mode (`N line(s) could not be imported:` followed by each `Skipped malformed line: ...`), or in the JSON `warnings` array. The command exits `1` in every mode even though the import was written. `--dry-run` reports the same warnings, so a preview reveals the loss too.

## Exit Codes

| Code | Meaning                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------- |
| `0`  | Success — the import was written, or fully previewed under `--dry-run`                          |
| `1`  | Runtime failure — a fetch or parse error, or a partial failure (CSV rows or text lines skipped) |
| `2`  | Usage error (see below)                                                                         |
| `3`  | Not found — the source file does not exist                                                      |

Exit `2` covers:

- invalid or misapplied flags
- an unsupported URL
- a name/ID conflict with no `--overwrite`/`--append`/`--yes`
- a list name with no characters usable in a file name
- a collection import whose lines carry no printing
- a text-file import the list writer refuses (for example, the target file already exists)
- a required prompt when input is unavailable
- a cancelled prompt (`Cancelled.` on stderr)

## Examples

Import a deck from Archidekt:

```bash
ritual import https://archidekt.com/decks/12345
```

Import a deck from Moxfield with an explicit user agent:

```bash
ritual import https://moxfield.com/decks/abc123 --moxfield-user-agent "YourName Ritual Import/1.0"
```

Import from a local text file (prompts for the list type):

```bash
ritual import ./decklist.txt
```

Import a text file into a collection:

```bash
ritual import ./binder.txt --type collection
```

Import a text file into a wanted list without prompts:

```bash
ritual import ./wants.txt --type wanted --no-input
```

Preview an import without writing files:

```bash
ritual import ./decklist.txt --dry-run --no-input
```

Interactive CSV import (the wizard maps the columns):

```bash
ritual import ./moxfield-export.csv
```

Scripted CSV collection import:

```bash
ritual import binder.csv --type collection --name "Red Binder" \
  --columns "name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6"
```

Scripted deck import from a headerless CSV:

```bash
ritual import burn.csv --type deck --name "Burn" --deck-format modern \
  --columns "quantity=1,name=2,section=3" --no-header
```

Append new cards to an existing collection:

```bash
ritual import new-cards.csv --type collection --name "Red Binder" \
  --columns "name=1,set=2,collector-number=3,quantity=4" --append
```

Import a CSV that lacks the `.csv` extension:

```bash
ritual import export.txt --csv --type wanted --name "To Buy" --columns "name=1,quantity=2"
```

## Moxfield User-Agent Requirement

Moxfield imports require a unique Moxfield-approved user agent string.

- Set `MOXFIELD_USER_AGENT`, or
- Pass `--moxfield-user-agent <agent>`

If you need one, contact Moxfield support.
