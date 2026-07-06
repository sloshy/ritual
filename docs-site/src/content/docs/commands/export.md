---
title: 'export'
---

Export any grouping of cards from your decks, collections, and wanted lists as **CSV** or **JSON**. Run it bare in a terminal for an interactive wizard, or drive everything with flags for scripting. The same engine backs the [MCP](/commands/mcp/) `export_cards` tool.

## Usage

```bash
# Interactive wizard
./ritual export

# Everything, as JSON on stdout
./ritual export --format json > all-cards.json

# One deck to a CSV file with custom columns
./ritual export deck:burn --out burn.csv --columns name,quantity,listName

# Cherry-pick cards across lists, filtered
./ritual export --card "sol ring" --card "lightning bolt" --finish foil
```

## Arguments

| Argument     | Description                                                                                                                             | Required |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[lists...]` | Lists to export. Names resolve like every list command; a `deck:` / `collection:` / `wanted:` prefix pins the type of an ambiguous name | No       |

When no lists and no `--card` picks are given, **every list is exported** (so `ritual export --format json` dumps everything).

## Options

### Sources

| Option           | Description                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--deck`         | Only decks (also disambiguates bare list names)                                                                           |
| `--collection`   | Only collections (also disambiguates bare list names)                                                                     |
| `--wanted`       | Only wanted lists (also disambiguates bare list names)                                                                    |
| `--all`          | Export every list in scope (the default when no lists or `--card` are given)                                              |
| `--card <terms>` | Add every entry (across all lists in scope) whose name matches all terms. Repeatable; deduplicated against selected lists |

### Filters

Filters apply to the assembled set — list entries and card picks alike.

| Option               | Description                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--name <terms>`     | Only cards whose name contains every whitespace-separated term                                                                                                                                                                                                                                               |
| `--set <code>`       | Only cards from this set code (case-insensitive)                                                                                                                                                                                                                                                             |
| `--finish <finish>`  | Only `nonfoil`, `foil`, or `etched`. `nonfoil` also matches cards with no explicit finish                                                                                                                                                                                                                    |
| `--condition <list>` | Only cards with one of these conditions, comma-separated (`NM`, `LP`, `MP`, `HP`, `DMG`, `none`). An explicit grade matches only cards with it marked on their line; `none` matches cards with no condition marked (e.g. `--condition NM,none`). Wanted entries never carry a condition, so they never match |

### Output

| Option                 | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `--format <format>`    | `csv` (default) or `json`                                      |
| `--columns <list>`     | Comma-separated properties in output order (see below)         |
| `--no-header`          | Omit the CSV header row                                        |
| `--quote-all`          | Quote every CSV cell instead of only cells that need it        |
| `--out <file>`         | Write to this file instead of stdout                           |
| `--preset <name>`      | Start from a saved preset (explicit flags override its values) |
| `--save-preset <name>` | Save the resolved format/columns/CSV options as a named preset |
| `--quiet`              | Suppress warnings and confirmations                            |
| `--no-interactive`     | Never open the interactive wizard                              |

## Properties

The exportable properties are the fields stored in your list files (plus the list identity and two derived columns):

`name`, `quantity`, `set`, `collectorNumber`, `edition`, `finish`, `isFoil`, `condition`, `note`, `section`, `listName`, `listType`

The default column set matches the site's CSV export: `name,set,collectorNumber,finish,condition,quantity`.

Notes on values:

- **Set codes** are lowercase in JSON output (a data format, matching how they're stored) and uppercase in CSV output (matching every other user-facing surface).
- **`edition`** (set + collector number) combines the printing into one value — `LEA:161` in CSV, `lea:161` in JSON (only the set code changes case; collector numbers are kept verbatim). Empty/omitted for cards without a pinned printing.
- **`isFoil`** is `true` when the card's finish is `foil` or `etched`, `false` otherwise (a real boolean in JSON, `true`/`false` text in CSV).
- JSON records **omit** properties the entry doesn't have (no `null`s); key order follows the column order.
- CSV renders missing values as empty cells. An explicitly marked `[nonfoil]` finish is written as `nonfoil` — unlike the site's fixed CSV export, nothing is blanked.
- Card `&N` IDs are internal and never exported.

## Interactive Wizard

A bare `ritual export` in a terminal opens the wizard. From its main menu you can:

- **Add lists** — an autocomplete over every deck, collection, and wanted list.
- **Add individual cards** — an autocomplete over every card entry across all your lists; type to search by name, set, or list.
- **Filters** — the same name/set/finish/condition filters as the flags.
- **Format, Columns, CSV options** — pick `csv`/`json`, then pick columns _in output order_ (each pick appends; `Done` finishes, `Reset to default` restores the standard columns), and toggle the header row and quoting mode.
- **Load / save presets** — apply a saved output shape or save the current one.
- **Review** — print the assembled cards before exporting.
- **Export** — prompts for the output path (defaults to `export.csv` / `export.json`).

`ritual export --preset <name>` (with no other flags) opens the wizard pre-loaded with that preset.

## Presets

Presets capture the **output shape** — format, columns and their order, and the CSV toggles — not sources or filters. They live under `exportPresets` in [`ritual.config.json`](/configuration/) and are managed with `--save-preset`, the wizard, or by editing the file directly (`config-set` does not manage them):

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

Precedence when exporting: built-in defaults → `--preset` values → explicit flags. So `ritual export --preset trade-sheet --no-header` uses the preset's columns without the header row.

## Exit Codes

| Code | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| `0`  | Export written                                                                            |
| `1`  | Runtime error (for example, the output file could not be written)                         |
| `2`  | Usage error (conflicting type flags, unknown column, invalid filter, ambiguous list name) |
| `3`  | Not found (unknown list or preset)                                                        |
