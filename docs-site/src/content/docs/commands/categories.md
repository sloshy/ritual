---
title: 'categories'
description: Inspect and edit a list's card categories.
---

Inspect and edit a list's **card categories**: a card's role in that one list, such as `Ramp`, `Removal`, or `Board Wipes`. It is what Archidekt calls a category and Moxfield a tag.

A category belongs to a card **name**, not to a card line. One assignment covers every line of that name in the list, whatever its printing, section or quantity. It is never written on the line, and it **never follows a move**. A card's categories are ordered, and the **first one is its primary category**, which is what the site groups by. See [Categories in the list format](/list-format/#categories-namecategoriesjson) for the file itself.

## Usage

```bash
ritual categories list [listName]
ritual categories rename [listName] <from> <to>
ritual categories order [listName] <value>
ritual categories remove [listName] <name>
```

`listName` names a list of any type unless a type flag narrows it; see [List Names](/list-resolution/). Omit it to pick a list interactively.

## Subcommands

### `list`

Print the list's category vocabulary in display order, each with how many cards carry it, followed by one line per categorized card.

| Argument     | Description                              |
| ------------ | ---------------------------------------- |
| `[listName]` | The list to read (prompted when omitted) |

Read-only: it takes no `--dry-run`, it never writes, and it never prunes. It **does** report stale entries (see [Stale names](#stale-names)).

### `rename`

Rename a category throughout the list: in the vocabulary and on every card carrying it, with each card's own order preserved.

| Argument     | Description                   |
| ------------ | ----------------------------- |
| `[listName]` | The list to edit              |
| `<from>`     | The category to rename        |
| `<to>`       | The new name for the category |

A `<from>` the list does not use, neither in `order` nor on any card, compared case-insensitively, is a `not_found` (exit `3`).

### `order`

Set the display order of the list's vocabulary.

| Argument     | Description                                        |
| ------------ | -------------------------------------------------- |
| `[listName]` | The list to edit                                   |
| `<value>`    | The categories in their new order, comma-separated |

Names the list does not use yet are accepted: `order` declares a vocabulary. An empty value is a usage error (exit `2`), since clearing the order is not what "reorder" means; `remove` is how a name leaves.

### `remove`

Remove a category from the list's vocabulary **and** from every card that uses it. A card left with no categories loses its sidecar entry.

| Argument     | Description            |
| ------------ | ---------------------- |
| `[listName]` | The list to edit       |
| `<name>`     | The category to remove |

## Options

| Option              | Description                                                       | Default |
| ------------------- | ----------------------------------------------------------------- | ------- |
| `--deck`            | Resolve the name as a deck                                        |         |
| `--collection`      | Resolve the name as a collection                                  |         |
| `--wanted`          | Resolve the name as a wanted list                                 |         |
| `-n, --dry-run`     | Report what would change without writing anything (not on `list`) | `false` |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                        | `text`  |
| `--quiet`           | Suppress non-essential output                                     | `false` |

## Examples

```bash
ritual categories list --deck "Winota Stax"
ritual categories list --deck "Winota Stax" --output json
ritual categories rename --deck "Winota Stax" Draw "Card Draw"
ritual categories order --deck "Winota Stax" "Ramp, Card Draw, Removal"
ritual categories remove --collection main Ramp --dry-run
```

## Behavior

### What this command writes

Every mutating subcommand writes the list's `<list>.categories.json` sidecar and its `<list>.categories.json.sha256` **when the edit changes them**, then appends one entry to the list's `.changes.md` changelog. Those paths come back in `writtenFiles`. The list `.md` file is **never** rewritten. This command writes no card lines and reads no `&N`, which is also why it does not trigger the [card-ID backfill](/cli-conventions/#the-card-id-backfill).

An edit that changes nothing (`rename Draw Draw`, or an `order` equal to the one on disk) reports `wouldWrite: false`, writes no sidecar **and no changelog entry**, and comes back with an empty `writtenFiles`. A real run and its `--dry-run` preview therefore always agree about whether the command touches disk.

A sidecar left with no vocabulary and no cards is deleted rather than written as `{}`, and its `.sha256` goes with it.

The `.sha256` is refreshed only when it matched the sidecar before the write. A **hand-edited** sidecar therefore keeps its stale hash (its `.sha256` is not in `writtenFiles`), so [`detect-changes`](/commands/detect-changes/) still records the hand edit rather than treating it as already logged.

### Changelog entries

The English prose the changelog records is:

- `Renamed category "Draw" to "Card Draw"`
- `Set category order to Ramp, Draw, Removal` (or `Clear category order`)
- `Set categories of "Sol Ring" to Ramp, Artifacts` / `Cleared categories of "Sol Ring"`

`remove` has no event of its own. It is recorded as a `set-category-order` without the name plus one `set-categories` per affected card, which is exactly what it does.

### Stale names

A sidecar entry naming a card the list no longer holds is **kept**. `categories list` reports it on stderr:

```
Categories are recorded for cards this list no longer holds: Sol Ring. They are kept until the list is saved or cleaned up.
```

`--quiet` does not hide it, because it is data the next save will drop. The check needs a **complete** read of the list. When the file holds a body line the card-line parser cannot read, `categories list` reports that instead and names no entry stale, because a card it could not see is not a card that is gone.

Nothing in this command prunes. A read does not write, and the three mutating subcommands edit the vocabulary rather than the card lines. Pruning happens on the list's own save (an [editor](/commands/edit/) session, an admin save), on a cross-list [`move`](/commands/move/) that rewrites the list from a clean parse, and in [`ritual cleanup`](/commands/cleanup/).

### Dry runs

`-n` / `--dry-run` resolves the list, validates the arguments and computes the edit, then reports it and stops. Nothing is written: no sidecar, no `.sha256`, no changelog. `wouldWrite` says whether a real run would touch the sidecar. It is `false` for a no-op edit, which a real run then honours by writing nothing at all, changelog included. It is computed by the same preview the real save uses, so the two cannot disagree. Text output is prefixed `[dry-run]`; JSON output carries `"dryRun": true` alongside the usual fields.

### JSON payloads

`categories list`:

```json
{
  "type": "deck",
  "list": "Winota Stax",
  "order": ["Ramp", "Draw", "Removal"],
  "cards": [{ "name": "Sol Ring", "categories": ["Ramp", "Artifacts"] }],
  "warnings": []
}
```

`categories rename` / `order` / `remove`:

```json
{
  "type": "deck",
  "list": "Winota Stax",
  "action": "rename",
  "order": ["Ramp", "Card Draw", "Removal"],
  "cardsChanged": ["Rhystic Study"],
  "wouldWrite": true,
  "writtenFiles": [
    "/decks/Winota Stax.categories.json",
    "/decks/Winota Stax.categories.json.sha256",
    "/decks/Winota Stax.changes.md"
  ]
}
```

`cardsChanged` is computed from the record diff, so a rename (one list-level event that rewrites every card carrying the name) reports the cards it touched.

## On the site

The built site reads the same sidecar. On any single list view, **Group: Category** puts each card under its primary category, **Group: Categories** shows it under every category it holds (the non-primary appearances dimmed and badged), **Sort: Category** orders by primary, and a **Categories** filter row narrows the list. All of this is shareable in the view URL. On a deck the two groupings nest inside every board, so headings read `Main › Ramp` and `Sideboard › Draw`. See [Grouping, sorting and filtering by category](/public-site/filtering/#grouping-sorting-and-filtering-by-category).

Both the admin and the public in-browser editors edit categories directly: an **Edit Categories…** row in a card's `⋯` menu and a **Categories** (Manage categories) dialog for renaming, reordering and removing. See [Card Categories in the editors](/admin/editors/#card-categories).

## Related

- [`set-card --categories` / `--no-categories`](/commands/set-card/#category-updates) — set one card's categories.
- [`ritual edit`](/commands/edit/#card-categories) — the `🗂 Edit Categories` action and the list menu's `Rename Category…` / `Reorder Categories…` rows.
- [`defaultCategories`](/configuration/#default-categories) — the global vocabulary that seeds a list's resolved order.
- [`ritual export`](/commands/export/#properties) — the `categories` and `primaryCategory` columns.
- [`ritual import`](/commands/import/#value-normalization) — the `categories` CSV field, and how a board value in that cell routes to the section.

## Exit Codes

| Code | Meaning                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                      |
| `1`  | Runtime error (the `<list>.categories.json` sidecar could not be read — the command refuses rather than overwriting it)                      |
| `2`  | Usage error (a malformed category name, an empty `order` value, an ambiguous list name, prompts unavailable for the interactive list picker) |
| `3`  | Not found (missing list file, or a category the list does not use given to `rename`/`remove`)                                                |
