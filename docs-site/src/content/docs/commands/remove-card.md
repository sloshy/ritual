---
title: 'remove-card'
---

Remove a card from a deck, collection, or wanted list without opening an editor. It is the one-shot counterpart to removing a card in `ritual edit` or the admin site.

The edit is line-preserving: only the targeted card's line is removed (or its deck quantity rewritten). Everything else in the file, including prose, comments, and lines the parser cannot read, stays byte-for-byte intact.

## Usage

```bash
ritual remove-card [listName] [cardName...] [options]
```

`[listName]` names a list of any type; see [List Names](/list-resolution/). Pass `--deck`, `--collection`, or `--wanted` (or a `deck:`/`collection:`/`wanted:` prefix on the name) to pin the type.

With no list name, the command prompts you to pick a list and then a card. When [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), a missing `[listName]` or card selector (`[cardName...]` or `--card-id`) is a usage error (exit `2`).

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]`    | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |
| `[cardName...]` | Card name to remove (fuzzy match)                                                         | No       |

## Options

| Option               | Description                                                                     | Default |
| -------------------- | ------------------------------------------------------------------------------- | ------- |
| `--deck`             | Resolve the name as a deck                                                      |         |
| `--collection`       | Resolve the name as a collection                                                |         |
| `--wanted`           | Resolve the name as a wanted list                                               |         |
| `--card-id <id>`     | Select the card by its `&N` ID. Required when a name matches several entries    |         |
| `-q, --quantity <n>` | Number of copies to remove (decks only). Mutually exclusive with `--all-copies` | `1`     |
| `--all-copies`       | Remove every copy on the card's line (decks only)                               | `false` |
| `-n, --dry-run`      | Report what would be removed without writing anything                           | `false` |
| `--output <format>`  | Output format: `text`, `json`, or `ndjson`                                      | `text`  |
| `--quiet`            | Suppress non-essential output                                                   | `false` |

## Examples

Remove one copy of a card from a deck:

```bash
ritual remove-card --deck "My Deck" Sol Ring
```

Remove a specific printing by its card ID:

```bash
ritual remove-card --deck "My Deck" --card-id 17
```

Remove two copies, or the whole line:

```bash
ritual remove-card --deck "My Deck" Lightning Bolt -q 2
ritual remove-card --deck "My Deck" Lightning Bolt --all-copies
```

Remove a collection entry and capture the result as JSON:

```bash
ritual remove-card --collection main "Mana Crypt" --output json
```

The JSON payload is `{ type, list, cardName, cardId, removed, remaining }`. `removed` is the number of copies taken off. `remaining` is what is left on the deck line: `0` once the line is gone, and always `0` for collections and wanted lists.

## Behavior

### Card Resolution

Cards are matched the same way as in [`note`](/commands/note/):

- **By name**: fuzzy match, ignoring case, accents, and punctuation. An exact name wins; otherwise substring matches are used. An ambiguous match exits with a `usage_error` listing each candidate.
- **By card ID**: `--card-id` targets one entry by its `&N` suffix.
- **Interactively**: a picker, when neither is given.

When both a name and `--card-id` are given they must agree. A disagreement is a usage error naming both (`--card-id 3 is 'Demonic Tutor', which does not match 'Lightning Bolt'.`). IDs are reused after a removal, so a stale ID paired with a name usually means the wrong card is about to be touched.

### Dry Runs

`-n` / `--dry-run` resolves the list and the card, runs every validation, and reports the removal it _would_ perform. Nothing is written: no list file, changelog, or `.sha256` sidecar, and no card-ID backfill. Text output is prefixed `[dry-run]`; JSON output carries `"dryRun": true`. Use it before a fuzzy-name removal, which otherwise deletes on a single unique substring match with no confirmation.

### Deck Quantities

A deck line like `4 Lightning Bolt &7` carries a quantity. `remove-card` removes one copy by default; `-q <n>` removes `n` copies and `--all-copies` removes the whole line. Asking for more copies than the line has is a usage error that reports the actual quantity. When the quantity reaches zero the line is deleted and its `&N` ID returns to the list's reuse pool.

### Flat Lists

Collection and wanted-list entries are one physical card each, so `-q` greater than 1 and `--all-copies` are rejected. Remove each entry individually, using `--card-id` to pick between same-named entries.

### Change Tracking

Each removal is recorded in the list's `.changes.md` changelog: one `Removed "<Card>" ... &N` line per copy, in a single changelog block per invocation.

### Custom Art

Deleting a line also drops that card's entry from the list's [custom-art sidecar](/custom-art/#art-follows-the-card), so the released `&N` cannot hand the image to the next card added. A deck decrement that leaves copies on the line keeps both the ID and the art. Art writes record no changelog entry.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                                                                                                   |
| `2`  | Usage error (conflicting flags, a `--card-id` that disagrees with the card name, ambiguous list or card, `-q` on a flat list, `-q` above the deck line quantity, prompts unavailable for interactive list/card selection) |
| `3`  | Not found (missing list file, missing card, missing card ID)                                                                                                                                                              |
| `1`  | Runtime error                                                                                                                                                                                                             |
