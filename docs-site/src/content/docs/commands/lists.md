---
title: 'ritual lists'
description: 'List every deck, collection and wanted list in the workspace, or summarize their counts and value.'
sidebar:
  label: 'lists'
---

List every deck, collection, and wanted list in the workspace. Use it to see what exists, or from a script to get the names other commands accept. With [`--summary`](#summary), it counts the cards in each list instead, with totals across them, and with `--source` it prices them too.

## Usage

```bash
ritual lists [lists...] [options]
```

## Arguments

| Argument     | Description                                                                                                                     | Required |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[lists...]` | With `--summary`, summarize only these lists. Each is a list name, optionally prefixed with `deck:`, `collection:` or `wanted:` | No       |

Names resolve like every other list argument (see [List Names](/list-resolution/)); an ambiguous one asks for a type prefix (`deck:Storm`). List names need `--summary`: plain `ritual lists Burn` is a usage error.

## Options

| Option              | Description                                                                                                                                                              | Default       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `--deck`            | Only decks                                                                                                                                                               |               |
| `--collection`      | Only collections                                                                                                                                                         |               |
| `--wanted`          | Only wanted lists                                                                                                                                                        |               |
| `--summary`         | Count each list's entries and cards, with totals across them, instead of listing names                                                                                   |               |
| `--name <terms>`    | Only lists whose display name contains every one of these space-separated terms, in any order (case, accents and punctuation ignored)                                    |               |
| `--label <label>`   | Only lists whose [default card labels](/list-format/#default-labels-and-descriptions) include this one: `sale`, `trade`, `keep` or `proxy`                               |               |
| `--no-empty`        | Leave out lists with no entries (in the sections counted)                                                                                                                |               |
| `--format <format>` | Only decks of this format (such as `commander` or `modern`); collections and wanted lists never match                                                                    |               |
| `--section <name>`  | Count only this deck section, by its exact, case-sensitive heading (`Commander`, `Main`, `Sideboard`); repeat for several. Collections and wanted lists are unaffected   | every section |
| `--source <store>`  | Price each list at this store and show its value: `tcgplayer`, `cardmarket`, `cardhoarder` or `cardkingdom` (see [Price stores](/commands/price/#price-stores---source)) |               |
| `--sort <field>`    | Order the lists by `name`, `quantity` (copies) or `value` (needs `--source`)                                                                                             | `name`        |
| `--ascending`       | Smallest (or A) first: the default for `name`                                                                                                                            |               |
| `--descending`      | Largest (or Z) first: the default for `quantity` and `value`                                                                                                             |               |
| `--limit <n>`       | Show at most this many lists, after sorting. The totals still cover every selected list                                                                                  |               |
| `--refresh <mode>`  | Card cache refresh policy when pricing: `ask`, `auto`, `no-bulk` or `never` (see [Price Freshness](/commands/price/#price-freshness))                                    | `ask`         |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                                                                                                               | `text`        |
| `--quiet`           | Suppress non-essential output                                                                                                                                            | `false`       |

The three type flags are mutually exclusive. Passing more than one is a usage error. Every option from `--name` to `--refresh` works only with `--summary`: given without it, the command refuses rather than guessing, because `--summary` changes the shape of the output. `--ascending` and `--descending` together are a usage error too.

## Examples

List everything:

```bash
ritual lists
```

```text
Type         Name         File
deck         Burn         burn
deck         Winota Stax  stax
collection   Main Binder  main
wanted list  Needs        needs
```

The text output is a table under a heading row. **Type** is the list type, worded in your [UI language](/localization/) (`--output json` always spells it `deck`, `collection` or `wanted`). **Name** is the display name, the list's `# Title` heading. **File** is the slug, the file name without `.md`, which is what other commands match a list name against (see [List Names](/list-resolution/)). The **File** column appears only when some list's file name differs from its name. A title and its file name are [one name](/list-resolution/#a-lists-title-is-its-file-name), so the two differ only where the file name drops characters the title keeps (`Burn?` in `Burn.md`), in an older workspace, or after a hand edit ([`ritual cleanup`](/commands/cleanup/) renames such a file to its title). When every file is named after its list (the usual case), the table has just **Type** and **Name**:

```text
Type        Name
deck        Burn
collection  Main Binder
```

Scripts should read `--output json` rather than the text table.

Only decks, as JSON:

```bash
ritual lists --deck --output json
```

```json
[
  { "listType": "deck", "slug": "burn", "name": "Burn" },
  { "listType": "deck", "slug": "stax", "name": "Winota Stax" }
]
```

`ndjson` emits the same rows, one JSON object per line.

## Summary

`--summary` reads every selected list once and reports how many entries (lines) and cards (copies) each holds, plus totals across them. Counting reads only the list files, so it works with an empty card cache and never downloads anything.

```bash
ritual lists --summary
```

```text
Type         Name         File         Entries  Cards
deck         Burn         burn               2      6
collection   Main Binder  main-binder        3      3
wanted list  Needs        needs              1      1

Decks: 1 list · 2 entries · 6 cards · 2 distinct cards
Collections: 1 list · 3 entries · 3 cards · 2 distinct cards
Wanted Lists: 1 list · 1 entry · 1 card · 1 distinct card
All lists: 3 lists · 6 entries · 10 cards · 3 distinct cards
```

The per-type lines appear only when the selection spans more than one type. **Distinct cards** counts card names, with case and spacing folded.

Add `--source` to price every list at a store. The store line comes first, and each row and total gains its value:

```bash
ritual lists --summary --source tcgplayer
```

```text
💰 Prices last updated: 11/26/2026, 6:38:06 PM (less than a minute ago) · Store: TCGplayer (USD)

Type         Name         File         Entries  Cards  Value
deck         Burn         burn               2      6  Total $7.00
collection   Main Binder  main-binder        3      3  Total $5.50
wanted list  Needs        needs              1      1  Total $2.00

Decks: 1 list · 2 entries · 6 cards · 2 distinct cards · Total $7.00
Collections: 1 list · 3 entries · 3 cards · 2 distinct cards · Total $5.50
Wanted Lists: 1 list · 1 entry · 1 card · 1 distinct card · Total $2.00
All lists: 3 lists · 6 entries · 10 cards · 3 distinct cards · Total $14.50
```

A list's value is exactly what [`ritual price <list>`](/commands/price/) reports for it, by the same [pricing rules](/commands/price/#how-cards-are-priced). A deck's value leaves out its maybeboard and token sections, as deck totals do everywhere, so a deck's priced card count can be lower than its counted one.

More questions it answers:

```bash
# How many cards are in all my collections?
ritual lists --summary --collection

# Which lists have "box" in the name?
ritual lists --summary --name box

# My three most valuable collections
ritual lists --summary --collection --source tcgplayer --sort value --limit 3

# Each commander deck's main-board count, without the sideboard and maybeboard
ritual lists --summary --deck --format commander --section Commander --section Main

# Two named lists, side by side
ritual lists --summary deck:Burn "collection:Main Binder"
```

Filters intersect: a list is summarized only when it passes all of them. `--sort` and `--limit` only order and trim the rows; the totals always describe every selected list. Ties sort by name.

### JSON

```bash
ritual lists --summary --collection --source tcgplayer --output json
```

```json
{
  "lists": [
    {
      "listType": "collection",
      "slug": "main-binder",
      "name": "Main Binder",
      "counts": {
        "entryCount": 3,
        "cardCount": 3,
        "sections": [{ "name": "Main", "entryCount": 3, "cardCount": 3 }]
      },
      "value": {
        "cardCount": 3,
        "total": 5.5,
        "lowestTotal": 5.5,
        "unpricedCount": 0,
        "estimatedCount": 0
      }
    }
  ],
  "totals": {
    "listCount": 1,
    "entryCount": 3,
    "cardCount": 3,
    "distinctCardCount": 2,
    "value": {
      "cardCount": 3,
      "total": 5.5,
      "lowestTotal": 5.5,
      "unpricedCount": 0,
      "estimatedCount": 0
    }
  },
  "warnings": [],
  "source": "tcgplayer",
  "currency": "usd",
  "lastRefreshedAt": 1795739886172
}
```

- Each row names its list as `listType` + `slug` (the identity other tools take) and `name` (its display title). Plain `ritual lists --output json` rows use the same `listType`, `slug` and `name`.
- `counts` is the same shape the MCP `get_list` tool's summary view reports: lines and copies, overall and per section. A row also carries the list's default `labels`, `description`, cover `image` and deck `format` when it declares them.
- `value` (on rows and totals) is present only when priced. Its fields are the [price report's totals](/commands/price/#non-interactive-output): `estimatedCount` marks an estimate, and `unpricedCount` counts copies with no price.
- `typeTotals` (per-type totals, each with its `listType`) is present only when the selection spans more than one type.
- `source`, `currency` and `lastRefreshedAt` are present only when priced. `lastRefreshedAt` is when the prices were last refreshed, in Unix milliseconds (`null` when unknown): the Card Kingdom feed's download for `cardkingdom`, the card cache's last refresh for every other store.
- `--output ndjson` emits only the rows, one per line.

### Warnings

`warnings` holds every problem that leaves a count or a total short: a list file that could not be read (left out), lines its parser could not read (not counted), a list or its custom art that could not be priced, an empty card cache, or Card Kingdom with no feed. Each is a message object (`message`, plus `messageKey` and `messageParams`), and a warning about one list names it as `list: { listType, slug }`:

```json
{
  "message": "Burn: Skipped malformed line: - 2x",
  "messageKey": "domain.list.summary.inList",
  "messageParams": {
    "list": "Burn",
    "cause": {
      "messageKey": "domain.import.text.malformedLine",
      "messageParams": { "line": "- 2x" }
    }
  },
  "list": { "listType": "deck", "slug": "burn" }
}
```

Warnings also print to stderr in every output mode, including under `--quiet`.

Prices that cannot be had never cost you the counts. With `--source cardkingdom` and no Card Kingdom feed downloaded (and `--refresh` not allowed to download one), the summary prints the counts with a warning saying how to get the feed. With an empty card cache it does the same. Only `--sort value` refuses in those cases, since the order you asked for cannot be had.

## Behavior

Rows are sorted by type (decks, then collections, then wanted lists), then by slug; a summary sorts by `--sort` instead. When nothing matches, the command still exits `0`: text output prints `(no lists)` (a summary follows it with its zero totals line), JSON output prints `[]` (a summary prints its usual object with empty `lists`), and NDJSON prints nothing.

A list name on the command line that resolves to no list is an error (exit `3`). The [admin route](/admin/api/lists/#list-summary) and the MCP [`summarize_lists`](/commands/mcp/#summarizing-lists) tool take exact `type:slug` references instead, and report one that names no list as a warning.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success (including an empty result, and a summary whose prices could not be had)                                                                                                                                                                              |
| `1`  | Runtime error, including `--sort value` when the prices cannot be had (Card Kingdom with no feed, an empty card cache)                                                                                                                                        |
| `2`  | Usage error: more than one type flag, a summary option or list name without `--summary`, `--ascending` with `--descending`, an ambiguous list name, a `type:` prefix that contradicts the type flag, a bad option value, or `--sort value` without `--source` |
| `3`  | A list name given with `--summary` matches no list                                                                                                                                                                                                            |
