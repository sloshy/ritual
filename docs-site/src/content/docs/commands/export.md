---
title: 'export'
---

Export any grouping of cards from your decks, collections, and wanted lists as **CSV**, **JSON**, **plain text**, or **Markdown**. Run it bare in a terminal for an interactive wizard, or drive everything with flags for scripting — the global `--no-input` flag is the headless switch that guarantees the wizard never opens. The same engine backs the [MCP](/commands/mcp/) `export_cards` tool.

## Usage

```bash
# Interactive wizard
./ritual export

# Everything, as JSON on stdout
./ritual export --format json > all-cards.json

# One deck to a CSV file with custom columns
./ritual export deck:burn --out burn.csv --columns name,quantity,listName

# One flat decklist of everything you own
./ritual export --collection --format text

# Cherry-pick cards across lists, filtered
./ritual export --card "sol ring" --card "lightning bolt" --finish foil

# A CSV ready for Archidekt's collection importer
./ritual export --collection --preset archidekt --out archidekt.csv
```

## Arguments

| Argument     | Description                                                                                                                             | Required |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[lists...]` | Lists to export. Names resolve like every list command; a `deck:` / `collection:` / `wanted:` prefix pins the type of an ambiguous name | No       |

When no lists and no `--card` picks are given, a headless run exports **every list** (so `ritual export --format json` dumps everything). A completely bare `ritual export` instead opens the [interactive wizard](#interactive-wizard) — or, where prompting is unavailable, fails with a usage error asking for `--all` or another flag.

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

Filters apply to the assembled set — list entries and card picks alike.

| Option               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--name <terms>`     | Only cards whose name contains every whitespace-separated term                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--set <code>`       | Only cards from this set code (case-insensitive)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--finish <finish>`  | Only `nonfoil`, `foil`, or `etched`. `nonfoil` also matches cards with no explicit finish                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--condition <list>` | Only cards with one of these conditions, comma-separated (`NM`, `LP`, `MP`, `HP`, `DMG`, `none`). An explicit grade matches only cards with it marked on their line; `none` matches cards with no condition marked (e.g. `--condition NM,none`). Wanted entries never carry a condition, so they never match                                                                                                                                                                               |
| `--labels <list>`    | Only deck and collection cards whose _effective_ labels (their `[labels]` override, else the list's front-matter default) include one of these, comma-separated (`sale`, `trade`, `keep`, `proxy`, `none`). `none` matches unlabeled cards. A filter may combine exclusive labels with the others — it selects, it doesn't declare. A deck line carries `proxy` alone, so `--labels proxy` selects a deck's proxies. Wanted entries carry no labels, so they never match — not even `none` |

### Output

| Option                 | Description                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--format <format>`    | `csv` (default), `json`, `text`, or `md`                                                                                                                     |
| `--columns <list>`     | Comma-separated properties in output order (`csv`/`json` only)                                                                                               |
| `--dialect <name>`     | Output vocabulary: `ritual` (default), `archidekt`, `arena`, or `moxfield`. Shapes `csv`/`json` values and the `text` line form; rejected with `--format md` |
| `--no-header`          | Omit the CSV header row                                                                                                                                      |
| `--quote-all`          | Quote every CSV cell instead of only cells that need it                                                                                                      |
| `--out <file>`         | Write to this file instead of stdout                                                                                                                         |
| `--preset <name>`      | Export with a saved or built-in preset (explicit flags override its values)                                                                                  |
| `--save-preset <name>` | Save the resolved format/columns/CSV options as a named preset                                                                                               |
| `--quiet`              | Suppress progress and status messages (never the payload or the warnings)                                                                                    |

The rendered export goes to stdout (or `--out`) raw, with no envelope — `export` has no scripting `--output` flag, because its stdout payload _is_ the export.

The same engine backs the admin API's [`POST /api/export`](/admin/api/#export-cards). That route returns the rendered export inline by default, or — with `write: true` — writes it to a server-named file under a gitignored `exports/` directory in the base dir and returns the relative path. Files written that way are byte-identical to what `--out` produces.

## Formats

### `csv` and `json`

Column-shaped output driven by `--columns`, `--no-header`, and `--quote-all` — see [Properties](#properties) below.

### `text` — a plain-text decklist

Identical printings (same name, printing, finish, condition, and language) are **aggregated** with their quantities summed, and a multi-list export **merges into one list** — list boundaries disappear. Lines keep first-seen file order; the printing is omitted for cards without a pinned one. The line form follows the [dialect](#dialects).

In the default `ritual` dialect (and in `archidekt`, which has no plain-text form of its own): `{quantity} {Name} ({SET}:{Collector Number})` lines, with no headers and no sections.

```text
2 Lightning Bolt (LEA:161)
1 Fireblast (VIS:78)
1 Price of Progress
```

In the `arena` and `moxfield` dialects: bare board markers over `{quantity} {Name} ({SET}) {Collector Number}` lines — the form those sites import. Sections map to boards (`Commander`, `Companion`, `Sideboard`, everything else `Deck` — except maybeboard and token sections, which map to no board and are [left out entirely](#maybeboard-and-token-sections)), and aggregation is per board. `moxfield` splices Moxfield's `*F*` / `*E*` finish marker **between the set and the collector number**, which is where [Moxfield's bulk-edit grammar](https://moxfield.com/help) puts it (`{quantity} {Name} ({SET}) *F* {Collector Number}`).

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

**Maybeboard and token sections are not part of a decklist**, and neither Arena nor Moxfield has a board for them, so an `arena` or `moxfield` export leaves those cards out. If your selection reached any, the count and the sections it dropped them from are reported as a warning on stderr — `--quiet` never silences it. The `ritual` and `archidekt` text forms are flat lists rather than decklists, so they carry every selected entry, maybeboard included.

### `md` — grouped canonical markdown

The canonical list markdown, grouped by source: a `# List Name` H1 per list (in first-seen order), `## Section` H2 blocks within it, and each card's canonical line for its list type — every line a `- ` bullet, deck lines carrying their quantity — with finish/condition/note tokens as stored. Card `&N` IDs are internal and **never included**.

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

`--columns`, `--no-header`, and `--quote-all` only shape `csv`/`json` output. Giving any of them **explicitly** alongside `--format text` or `--format md` is a usage error (exit `2`). `--dialect` also shapes `text` output, so it conflicts only with `--format md`, which is Ritual's own markdown by definition. A preset whose stored columns accompany a `text`/`md` format is fine — the columns are simply unused.

## Properties

The exportable properties are the fields stored in your list files (plus the list identity and three derived columns):

`name`, `quantity`, `set`, `collectorNumber`, `edition`, `scryfallId`, `finish`, `isFoil`, `condition`, `language`, `labels`, `note`, `section`, `listName`, `listType`

The default column set matches the site's CSV export: `name,set,collectorNumber,finish,condition,language,quantity`.

Notes on values:

- **Set codes** are lowercase in JSON output (a data format, matching how they're stored) and uppercase in CSV output (matching every other user-facing surface).
- **`edition`** (set + collector number) combines the printing into one value — `LEA:161` in CSV, `lea:161` in JSON (only the set code changes case; collector numbers are kept verbatim). Empty/omitted for cards without a pinned printing.
- **`scryfallId`** is the printing's Scryfall UUID, resolved from your **local Scryfall cache** (list files don't store it). A card with no pinned printing, or a printing your cache doesn't hold, exports an **empty cell** plus a warning naming the card — refresh the cache (`ritual cache preload-all`) if you need the ids. It's the only column that reads the cache, so an export without it never touches it.
- **`isFoil`** is `true` when the card's finish is `foil` or `etched`, `false` otherwise (a real boolean in JSON, `true`/`false` text in CSV).
- **`language`** is the line's Scryfall language code (`ja`, `zhs`, ...), blank for English — mirroring the markdown token, which is omitted on English lines. In the [`archidekt` dialect](#dialects) it is written as Archidekt's own CSV codes (`EN CT DE FR IT JP KR PT RU CS SP` — always filled in, `EN` for English), and a language Archidekt has no code for exports as `EN`.
- **`labels`** is the card's _effective_ labels, comma-joined (`sale, trade`) — a deck line's resolve against the deck's front-matter `labels:` default exactly as a collection's do; empty for unlabeled cards and always empty for wanted entries. An export flattens away the list file, so the override/default split is not represented — and the `md` format writes the effective labels inline as `[labels]` tokens (it drops front matter along with `&N` ids). The spelling is the same in every dialect: labels are Ritual-specific, so no foreign importer defines a vocabulary to translate into.
- JSON records **omit** properties the entry doesn't have (no `null`s); key order follows the column order.
- CSV renders missing values as empty cells. An explicitly marked `[nonfoil]` finish is written as `nonfoil` — unlike the site's fixed CSV export, nothing is blanked.
- Card `&N` IDs are internal and never exported.

## Dialects

A dialect decides how an export is spelled, so it can be fed straight into another tool's importer. Which half of the export it reaches depends on the format: `csv`/`json` take their **values** from it, `text` takes its **line and board form**, and `md` takes nothing (it is Ritual's own markdown, and `--dialect --format md` is a usage error).

| Dialect            | `csv` / `json` values                                                                                                       | `text` lines                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ritual` (default) | `finish` as `nonfoil` / `foil` / `etched` (blank when the line marks none); `condition` as `NM`…`DMG` (blank when unmarked) | One flat list of `1 Sol Ring (C21:263)` lines                      |
| `archidekt`        | `finish` as `Normal` / `Foil` / `Etched` under a **`Variant`** header; `condition` as `NM` / `LP` / `MP` / `HP` / `D`       | Same as `ritual` — Archidekt's lane is the CSV preset              |
| `arena`            | Same as `ritual`                                                                                                            | Board markers over `1 Sol Ring (C21) 263` lines, no finish marker  |
| `moxfield`         | Same as `ritual`                                                                                                            | The `arena` form with `*F*` / `*E*` between the set and the number |

Column keys, the JSON schema, and every property not named above are identical in every dialect.

In the `archidekt` dialect a line that marks no finish or condition is written as its **effective** value (`Normal`, `NM`) — Archidekt's CSV has no "unmarked" spelling, and an empty cell would be a row it has to guess about. That means an etched-only printing without an explicit `[etched]` tag is written as `Normal`; pin the finish on the line if you export such cards by hand. (`ritual collection-sync` resolves finishes against the Scryfall cache before building its own CSV, so its uploads are never affected.)

## Interactive Wizard

A bare `ritual export` opens the wizard when prompting is possible: stdout and stdin are both terminals and the global `--no-input` flag (or the `RITUAL_NO_INPUT` environment variable) is not in force. Any argument or flag that describes a concrete export — list names, `--all`, `--card`, a filter, an output-shape flag, `--out`, `--preset`, or `--save-preset` — skips the wizard and runs headlessly instead. A bare `ritual export` where prompting is unavailable is a usage error with a hint to pass such a flag (e.g. `--all` to export everything).

From the wizard's main menu you can:

- **Add lists** — an autocomplete over every deck, collection, and wanted list.
- **Add individual cards** — an autocomplete over every card entry across all your lists; type to search by name, set, or list.
- **Filters** — the same name/set/finish/condition/labels filters as the flags.
- **Load preset** — apply a saved or built-in output shape (the built-in `archidekt` preset is always listed). It is offered above the three items it overwrites, so you never set the format and columns by hand only to lose them to a preset. Loading a preset is also the only way to pick a [dialect](#dialects) in the wizard; the header line names it whenever it actually shapes the chosen format's output — `moxfield lines` on a `text` export, `archidekt values` on a `csv` one — and stays silent about a dialect that changes nothing there (`archidekt` on `text`, `arena` on `csv`).
- **Format, Columns, CSV options** — pick `csv`/`json`/`text`/`md`. For `csv`/`json` you then pick columns _in output order_ (each pick appends; `Done` finishes, `Reset to default` restores the standard columns) and toggle the header row and quoting mode; for `text`/`md` there are no columns to pick, so the Columns and CSV options menus disappear — a `text` export's line form comes from its [dialect](#dialects) instead, and `md` is always Ritual's canonical markdown.
- **Save current settings as a preset** — store the current output shape under a name.
- **Review** — print the assembled cards before exporting.
- **Export** — prompts for the output path (defaults to `export.csv` / `export.json` / `export.txt` / `export.md` to match the format).

`ritual export --preset <name>` runs the export directly with that preset's output shape (every list, unless other flags narrow it) — it does not open the wizard. To start the wizard from a preset, open the wizard and pick **Load preset**.

## Presets

Presets capture the **output shape** — format, columns and their order, the CSV toggles, and the dialect — not sources or filters. They live under `exportPresets` in [`ritual.config.json`](/configuration/) and are managed with `--save-preset`, the wizard, or by editing the file directly (`config set` does not manage them):

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

The stored `format` may be any of `csv`, `json`, `text`, or `md`; the `columns` are always stored but only read by `csv`/`json` output. `dialect` is stored only when it isn't the default `ritual`.

Precedence when exporting: built-in defaults → `--preset` values → explicit flags. So `ritual export --preset trade-sheet --no-header` uses the preset's columns without the header row.

### Built-in presets

| Preset      | Output                                                                                                                                                                                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archidekt` | `Scryfall ID,Quantity,Variant,Condition,Language` CSV with a header row, in the [`archidekt` dialect](#dialects) — the file [Archidekt's collection importer](https://archidekt.com/collections/import) takes, and exactly what `ritual collection-sync push` uploads for a large batch of additions |

Built-ins need no config and are always available to `--preset`; saving a preset of the same name shadows it for `ritual export` (the sync builds its own upload either way).

```bash
./ritual export --collection --preset archidekt --out archidekt.csv
# 1b59533a-3e38-495d-873e-2f89fbd08494,2,Normal,NM,EN
```

Because the CSV is keyed by Scryfall ID, rows never need name matching — but a printing missing from your local cache exports an empty id cell and a warning, and Archidekt cannot import that row.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Export written                                                                                                                                                                                                                                                                      |
| `1`  | Runtime error (for example, the output file could not be written)                                                                                                                                                                                                                   |
| `2`  | Usage error (conflicting type flags, a type prefix contradicting a type flag, unknown column or dialect, invalid filter, column/CSV flags with `--format text`/`--format md`, `--dialect` with `--format md`, ambiguous list name, or a bare `export` where the wizard cannot open) |
| `3`  | Not found (unknown list or preset)                                                                                                                                                                                                                                                  |
