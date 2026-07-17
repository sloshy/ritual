---
title: 'remove-card'
---

Remove a card from a deck, collection, or wanted list without opening an editor — a one-shot counterpart to removing a card in `ritual edit` or the admin site.

## Usage

```bash
./ritual remove-card [listName] [cardName...] [options]
```

`[listName]` is resolved across all three list types (see [List Resolution](/commands/list-resolution/)); pass a `--deck`, `--collection`, or `--wanted` flag (or a `deck:`/`collection:`/`wanted:` prefix on the name) to pin the type or disambiguate. If invoked with no list name, the command runs interactively, prompting you to pick a list and then a card. Both prompts require a terminal — without one, omitting `[listName]` or a card selector (`[cardName...]`/`--card-id`) exits with a usage error (code `2`) instead of prompting.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]`    | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |
| `[cardName...]` | Card name to remove (fuzzy match)                                                         | No       |

## Options

| Option               | Description                                                                                                 | Default |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------- |
| `--deck`             | Resolve the name as a deck                                                                                  |         |
| `--collection`       | Resolve the name as a collection                                                                            |         |
| `--wanted`           | Resolve the name as a wanted list                                                                           |         |
| `--card-id <id>`     | Disambiguate by card ID (the `&N` suffix in list files). Required when name search hits multiple printings. |         |
| `-q, --quantity <n>` | Number of copies to remove (decks only). Mutually exclusive with `--all-copies`.                            | `1`     |
| `--all-copies`       | Remove every copy on the card's line (decks only)                                                           | `false` |
| `--output <format>`  | Output format: `text`, `json`, or `ndjson`                                                                  | `text`  |
| `--quiet`            | Suppress non-essential output                                                                               | `false` |

## Examples

Remove one copy of a card from a deck:

```bash
./ritual remove-card --deck "My Deck" Sol Ring
```

Remove a specific printing by its card ID:

```bash
./ritual remove-card --deck "My Deck" --card-id 17
```

Remove two copies, or the whole line:

```bash
./ritual remove-card --deck "My Deck" Lightning Bolt -q 2
./ritual remove-card --deck "My Deck" Lightning Bolt --all-copies
```

Remove a collection entry and capture the result as JSON:

```bash
./ritual remove-card --collection main "Mana Crypt" --output json
```

The JSON payload is `{ type, list, cardName, cardId, removed, remaining }`, where `removed` is the number of copies taken off and `remaining` is what is left on the deck line (`0` once the line is gone, and always `0` for collections and wanted lists).

## Behavior

### Card Resolution

Cards are matched the same way as [`note`](/commands/note/): fuzzy name match (case-, accent-, and punctuation-insensitive; exact name preferred, then substring), `--card-id` for a precise target, or an interactive picker when neither is given. An ambiguous name match exits with a `usage_error` listing each candidate.

### Deck Quantities

A deck line like `4 Lightning Bolt &7` carries a quantity. `remove-card` removes one copy by default; `-q <n>` removes `n` copies and `--all-copies` removes the whole line. Removing more copies than the line has is a usage error that reports the actual quantity. The line is deleted when its quantity reaches zero, which releases the `&N` card ID back to the list's reuse pool.

### Flat Lists

Collection and wanted-list entries are one physical card each, so `-q` greater than 1 and `--all-copies` are rejected — remove each entry individually, using `--card-id` to pick between same-named entries.

### Change Tracking

Each removal is recorded in the list's `.changes.md` changelog (one `Removed "<Card>" ... &N` line per copy, in a single changelog block per invocation).

## Exit Codes

| Code | Meaning                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                                                    |
| `2`  | Usage error (conflicting flags, ambiguous list or card, `-q` on a flat list, `-q` above the deck line quantity, no terminal available for interactive list/card selection) |
| `3`  | Not found (missing list file, missing card, missing card ID)                                                                                                               |
| `1`  | Runtime error                                                                                                                                                              |
