---
title: 'export'
---

Export any set of cards from your decks, collections, and wanted lists as **CSV**, **JSON**, **plain text**, or **Markdown**. Run it bare in a terminal for an interactive wizard, or drive everything with flags for scripting. The global `--no-input` flag guarantees the wizard never opens. The same engine backs the [MCP](/commands/mcp/) `export_cards` tool.

## Usage

```bash
# Interactive wizard
ritual export

# Everything, as JSON on stdout
ritual export --format json > all-cards.json

# One deck to a CSV file with custom columns
ritual export deck:burn --out burn.csv --columns name,quantity,listName

# One flat decklist of everything you own
ritual export --collection --format text

# Cherry-pick cards across lists, filtered
ritual export --card "sol ring" --card "lightning bolt" --finish foil

# A CSV ready for Archidekt's collection importer
ritual export --collection --preset archidekt --out archidekt.csv
```

## Arguments

| Argument     | Description                                                                                                         | Required |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | -------- |
| `[lists...]` | Lists to export. See [List Names](/list-resolution/); a `deck:` / `collection:` / `wanted:` prefix selects the type | No       |

With no lists and no `--card` picks, a headless run exports **every list**, so `ritual export --format json` dumps everything. A completely bare `ritual export` opens the [interactive wizard](#interactive-wizard) instead. Where prompting is unavailable, it fails with a usage error asking for `--all` or another flag.

## Options

### Sources

| Option           | Description                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--deck`         | Only decks (also disambiguates list names)                                                                                |
| `--collection`   | Only collections (also disambiguates list names)                                                                          |
| `--wanted`       | Only wanted lists (also disambiguates list names)                                                                         |
| `--all`          | Export every list in scope (the default when no lists or `--card` are given)                                              |
| `--card <terms>` | Add every entry (across all lists in scope) whose name matches all terms. Repeatable; deduplicated against selected lists |

### Filters

Filters apply to the assembled set, list entries and card picks alike.

| Option               | Description                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--name <terms>`     | Only cards whose name contains every whitespace-separated term                                                    |
| `--set <code>`       | Only cards from this set code (case-insensitive)                                                                  |
| `--finish <finish>`  | Only `nonfoil`, `foil`, or `etched`. `nonfoil` also matches cards with no explicit finish                         |
| `--condition <list>` | Only cards with one of these conditions, comma-separated: `NM`, `LP`, `MP`, `HP`, `DMG`, `none`                   |
| `--labels <list>`    | Only cards whose effective labels include one of these, comma-separated: `sale`, `trade`, `keep`, `proxy`, `none` |
| `--tags <list>`      | Only cards carrying one of these [tags](/list-format/#card-tags), comma-separated                                 |

Notes:

- `--condition`: an explicit grade matches only cards with it marked on their line; `none` matches cards with no condition marked (e.g. `--condition NM,none`). Wanted entries never carry a condition, so they never match.
- `--labels`: a card's effective labels are its `[labels]` override, else the list's front-matter default. `none` matches unlabeled cards. A filter may combine exclusive labels freely; it selects, it does not declare. A deck line carries `proxy` alone, so `--labels proxy` selects a deck's proxies. Wanted entries carry no labels, so they never match, not even `none`.
- `--tags`: exact and case-sensitive (`Signed`, `Card Draw`). Spaces are part of a tag, so quote the value. Matches on every list type, wanted lists included; a card with no tags never matches. There is no `none` value; `none` is an ordinary tag.

### Output

| Option                 | Description                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `--format <format>`    | `csv` (default), `json`, `text`, or `md`                                                              |
| `--columns <list>`     | Comma-separated properties in output order (`csv`/`json` only)                                        |
| `--dialect <name>`     | Output vocabulary: `ritual` (default), `archidekt`, `arena`, or `moxfield`. See [Dialects](#dialects) |
| `--no-header`          | Omit the CSV header row                                                                               |
| `--quote-all`          | Quote every CSV cell instead of only cells that need it                                               |
| `--out <file>`         | Write to this file instead of stdout                                                                  |
| `--preset <name>`      | Export with a saved or built-in preset (explicit flags override its values)                           |
| `--save-preset <name>` | Save the resolved format/columns/CSV options as a named preset                                        |
| `--quiet`              | Suppress progress and status messages (never the payload or the warnings)                             |

The rendered export goes to stdout (or `--out`) raw, with no envelope. `export` has no scripting `--output` flag because its stdout payload _is_ the export.

The same engine backs the admin API's [`POST /api/export`](/admin/api/#export-cards). That route returns the export inline by default, or, with `write: true`, writes it to a server-named file under a gitignored `exports/` directory in the base dir and returns the relative path. Files written that way are byte-identical to `--out` output.

## Formats

### `csv` and `json`

Column-shaped output driven by `--columns`, `--no-header`, and `--quote-all`. See [Properties](#properties).

### `text` — a plain-text decklist

Identical printings (same name, printing, finish, condition, and language) are **aggregated** with summed quantities. A multi-list export **merges into one list**, so list boundaries disappear. Lines keep first-seen file order, and the printing is omitted for cards without one. The line form follows the [dialect](#dialects).

In the default `ritual` dialect (and in `archidekt`, which has no plain-text form of its own): `{quantity} {Name} ({SET}:{Collector Number})` lines, with no headers or sections.

```text
2 Lightning Bolt (LEA:161)
1 Fireblast (VIS:78)
1 Price of Progress
```

In the `arena` and `moxfield` dialects: bare board markers over `{quantity} {Name} ({SET}) {Collector Number}` lines, the form those sites import. Sections map to boards (`Commander`, `Companion`, `Sideboard`, everything else `Deck`), except maybeboard and token sections, which are [left out entirely](#maybeboard-and-token-sections). Aggregation is per board. `moxfield` puts its `*F*` / `*E*` finish marker **between the set and the collector number**, following [Moxfield's bulk-edit grammar](https://moxfield.com/help) (`{quantity} {Name} ({SET}) *F* {Collector Number}`).

```text
Commander
1 Atraxa, Praetors' Voice (CMR) 523

Deck
2 Lightning Bolt (LEA) 161
1 Fireblast (VIS) *F* 78

Sideboard
1 Price of Progress
```

<a id="maybeboard-and-token-sections"></a>

**Maybeboard and token sections are not part of a decklist**, and neither Arena nor Moxfield has a board for them, so an `arena` or `moxfield` export leaves those cards out. If your selection reached any, a warning on stderr reports the count and the sections dropped; `--quiet` never silences it. The `ritual` and `archidekt` text forms are flat lists, so they carry every selected entry, maybeboard included.

### `md` — grouped canonical markdown

The canonical list markdown, grouped by source: a `# List Name` H1 per list (first-seen order), `## Section` H2 blocks within it, and each card's canonical line for its list type. Every line is a `- ` bullet, deck lines carry their quantity, and finish/condition/note tokens appear as stored. Card `&N` IDs are **never included**.

```markdown
# burn

## Main

- 2 Lightning Bolt (LEA:161)
- 1 Fireblast (VIS:78) [foil]

# binder

## Main

- Sol Ring (C21:263) [foil]
```

### Conflicts

`--columns`, `--no-header`, and `--quote-all` only shape `csv`/`json` output. Giving any of them **explicitly** with `--format text` or `--format md` is a usage error (exit `2`). `--dialect` also shapes `text`, so it conflicts only with `--format md`. A preset whose stored columns accompany a `text`/`md` format is fine; the columns are simply unused.

## Properties

The exportable properties are the fields stored in your list files, plus the list identity and three derived columns:

`name`, `quantity`, `set`, `collectorNumber`, `edition`, `scryfallId`, `finish`, `isFoil`, `condition`, `language`, `labels`, `tags`, `categories`, `primaryCategory`, `note`, `section`, `listName`, `listType`

The default column set matches the site's CSV export: `name,set,collectorNumber,finish,condition,language,quantity`.

Notes on values:

- **Set codes** are lowercase in JSON (a data format) and uppercase in CSV (like every other user-facing surface).
- **`edition`** combines set and collector number into one value: `LEA:161` in CSV, `lea:161` in JSON (collector numbers are kept verbatim). Empty for cards without a printing.
- **`scryfallId`** is the printing's Scryfall UUID, resolved from your **local Scryfall cache** (list files do not store it). A card with no printing, or a printing your cache lacks, exports an **empty cell** plus a warning naming the card. Refresh the cache (`ritual cache preload-all`) if you need the ids. It is the only column that reads the cache; an export without it never touches it.
- **`isFoil`** is `true` when the finish is `foil` or `etched`, `false` otherwise (a boolean in JSON, `true`/`false` text in CSV).
- **`language`** is the line's Scryfall language code (`ja`, `zhs`, ...), blank for English, like the markdown token. In the [`archidekt` dialect](#dialects) it is written as Archidekt's CSV codes (`EN CT DE FR IT JP KR PT RU CS SP`, always filled in, `EN` for English). A language Archidekt has no code for exports as `EN`.
- **`labels`** is the card's effective labels, comma-joined (`sale, trade`). A deck line resolves against the deck's front-matter `labels:` default exactly as a collection's does. Empty for unlabeled cards and always empty for wanted entries. The export flattens the list file, so the override/default split is not represented. The `md` format writes effective labels inline as `[labels]` tokens for collection entries only; deck lines are written without labels, since their effective set can hold collection-only vocabulary a deck line could not re-parse, so a deck's `[proxy]` is not exported. Same spelling in every dialect.
- **`tags`** is the card's [tags](/list-format/#card-tags), comma-joined in canonical order (`Card Draw, Ramp`), without the `#` the card line writes. Tags have no list-level default, so the column is exactly the line's tags and empty for an untagged card. The `md` format writes them back as the line's `#tags` token on every list type. Same spelling in every dialect.
- **`categories`** is the card's [categories](/commands/categories/) in that list, comma-joined in stored order (`Ramp, Artifacts`), the first being primary. Categories belong to a card **name** in one list, so every line of that name (whatever its printing or section) reports the same value, and the column is empty for an uncategorized card. They are read from the list's `<name>.categories.json` sidecar, not the list file. Same spelling in every dialect (Archidekt's board is not composed into the cell). **The `md` and `text` formats drop categories**, since a category is never on a card line. A sidecar that cannot be read is reported as a warning and its list exports with empty category cells.
- **`primaryCategory`** is the first category, the one the site groups by; empty for an uncategorized card.
- JSON records **omit** properties the entry does not have (no `null`s). Key order follows the column order.
- CSV renders missing values as empty cells. An explicit `[nonfoil]` finish is written as `nonfoil`; unlike the site's fixed CSV export, nothing is blanked.
- Card `&N` IDs are never exported.

## Dialects

A dialect decides how an export is spelled, so it can be fed straight into another tool's importer. `csv`/`json` take their **values** from it, `text` takes its **line and board form**, and `md` takes nothing (`--dialect` with `--format md` is a usage error).

| Dialect            | `csv` / `json` values                                                                                                       | `text` lines                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ritual` (default) | `finish` as `nonfoil` / `foil` / `etched` (blank when the line marks none); `condition` as `NM`…`DMG` (blank when unmarked) | One flat list of `1 Sol Ring (C21:263)` lines                      |
| `archidekt`        | `finish` as `Normal` / `Foil` / `Etched` under a **`Variant`** header; `condition` as `NM` / `LP` / `MP` / `HP` / `D`       | Same as `ritual` — Archidekt's lane is the CSV preset              |
| `arena`            | Same as `ritual`                                                                                                            | Board markers over `1 Sol Ring (C21) 263` lines, no finish marker  |
| `moxfield`         | Same as `ritual`                                                                                                            | The `arena` form with `*F*` / `*E*` between the set and the number |

Column keys, the JSON schema, and every property not named above are identical in every dialect.

In the `archidekt` dialect a line that marks no finish or condition is written as its **effective** value (`Normal`, `NM`), since Archidekt's CSV has no "unmarked" spelling. An etched-only printing without an explicit `[etched]` tag is therefore written as `Normal`; mark the finish on the line if you export such cards by hand. (`ritual collection-sync` resolves finishes against the Scryfall cache before building its own CSV, so its uploads are never affected.)

## Interactive Wizard

A bare `ritual export` opens the wizard when prompting is possible: stdout and stdin are both terminals and `--no-input` / `RITUAL_NO_INPUT` is not in force. Any argument or flag that describes a concrete export (list names, `--all`, `--card`, a filter, an output-shape flag, `--out`, `--preset`, or `--save-preset`) skips the wizard and runs headlessly. A bare `ritual export` where prompting is unavailable is a usage error with a hint to pass such a flag (for example `--all`).

From the main menu you can:

- **Add lists**: an autocomplete over every deck, collection, and wanted list.
- **Add individual cards**: an autocomplete over every card entry across all your lists. Search by name, set, or list.
- **Filters**: the same name/set/finish/condition/labels/tags filters as the flags (tags typed comma-separated).
- **Load preset**: apply a saved or built-in output shape (the built-in `archidekt` preset is always listed). It sits above the three items it overwrites, so you never set format and columns by hand only to lose them to a preset. This is also the only way to pick a [dialect](#dialects) in the wizard. The header line names the dialect when it actually shapes the chosen format's output (`moxfield lines` on a `text` export, `archidekt values` on a `csv` one) and stays silent when it changes nothing (`archidekt` on `text`, `arena` on `csv`).
- **Format, Columns, CSV options**: pick `csv`/`json`/`text`/`md`. For `csv`/`json` you then pick columns in output order (each pick appends; `Done` finishes, `Reset to default` restores the standard columns) and toggle the header row and quoting mode. For `text`/`md` the Columns and CSV options menus disappear; a `text` export's line form comes from its dialect, and `md` is always Ritual's canonical markdown.
- **Save current settings as a preset**: store the current output shape under a name.
- **Review**: print the assembled cards before exporting.
- **Export**: prompts for the output path (defaults to `export.csv` / `export.json` / `export.txt` / `export.md` to match the format).

`ritual export --preset <name>` runs the export directly with that preset's output shape (every list, unless other flags narrow it) and does not open the wizard. To start the wizard from a preset, open the wizard and pick **Load preset**.

## Presets

Presets capture the **output shape**: format, columns and their order, the CSV toggles, and the dialect. They do not capture sources or filters. They live under `exportPresets` in [`ritual.config.json`](/configuration/) and are managed with `--save-preset`, the wizard, or by editing the file directly (`config set` does not manage them):

```json
{
  "exportPresets": {
    "trade-sheet": {
      "format": "csv",
      "columns": ["name", "set", "collectorNumber", "condition", "quantity"],
      "header": true,
      "quoteAll": false
    }
  }
}
```

The stored `format` may be `csv`, `json`, `text`, or `md`. `columns` are always stored but only read by `csv`/`json` output. `dialect` is stored only when it is not the default `ritual`.

Precedence: built-in defaults → `--preset` values → explicit flags. So `ritual export --preset trade-sheet --no-header` uses the preset's columns without the header row.

### Built-in presets

| Preset      | Output                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `archidekt` | `Scryfall ID,Quantity,Variant,Condition,Language` CSV with a header row, in the [`archidekt` dialect](#dialects). The file [Archidekt's collection importer](https://archidekt.com/collections/import) takes |

This is exactly what `ritual collection-sync push` uploads for a large batch of additions. Built-ins need no config and are always available to `--preset`. Saving a preset of the same name shadows it for `ritual export` (the sync builds its own upload either way).

```bash
ritual export --collection --preset archidekt --out archidekt.csv
# 1b59533a-3e38-495d-873e-2f89fbd08494,2,Normal,NM,EN
```

Because the CSV is keyed by Scryfall ID, rows never need name matching. A printing missing from your local cache exports an empty id cell and a warning, and Archidekt cannot import that row.

## Exit Codes

| Code | Meaning                                                           |
| ---- | ----------------------------------------------------------------- |
| `0`  | Export written                                                    |
| `1`  | Runtime error (for example, the output file could not be written) |
| `2`  | Usage error (see below)                                           |
| `3`  | Not found (unknown list or preset)                                |

Exit `2` covers: conflicting type flags, a type prefix contradicting a type flag, an unknown column or dialect, an invalid filter, column/CSV flags with `--format text`/`--format md`, `--dialect` with `--format md`, an ambiguous list name, or a bare `export` where the wizard cannot open.
