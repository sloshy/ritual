---
title: 'note'
---

Set, replace, or clear the note on a card that already exists in a deck, collection, or wanted list.

Notes are stored in list files as `{note text}`, between the bracketed metadata and the `&N` card ID.

The edit is line-preserving: only the targeted card's line is rewritten. Everything else in the file, including prose, comments, and lines the parser cannot read, stays byte-for-byte intact.

## Usage

```bash
ritual note [listName] [cardName...] [options]
```

`[listName]` names a list of any type; see [List Names](/list-resolution/). Pass `--deck`, `--collection`, or `--wanted` (or a `deck:`/`collection:`/`wanted:` prefix on the name) to pin the type. A prefix that contradicts the flag is a usage error.

With no list name, the command prompts you to pick a list (filtered by the type flag if given), then the card, then the note text. Any argument or option you supply skips its prompt. When [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), a missing `[listName]` or card selector (`[cardName...]` or `--card-id`) is a usage error (exit `2`).

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]`    | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |
| `[cardName...]` | Card name whose note to set or clear (fuzzy match)                                        | No       |

## Options

| Option              | Description                                                                   | Default |
| ------------------- | ----------------------------------------------------------------------------- | ------- |
| `--deck`            | Resolve the name as a deck                                                    |         |
| `--collection`      | Resolve the name as a collection                                              |         |
| `--wanted`          | Resolve the name as a wanted list                                             |         |
| `-n, --note <text>` | Note text. Replaces any existing note. Cannot be empty; use `--clear` instead |         |
| `--clear`           | Remove the note from the card. Cannot be combined with `--note`               |         |
| `--card-id <id>`    | Select the card by its `&N` ID. Required when a name matches several entries  |         |
| `--dry-run`         | Report what the note would become without writing anything (no short form)    | `false` |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                    | `text`  |
| `--quiet`           | Suppress non-essential output                                                 | `false` |

With neither `--note` nor `--clear`, the command prompts for the note text, prefilled with the card's current note. When prompts are unavailable, one of the two flags is required; otherwise the command exits with code `2` (`Input required: …`).

## Examples

Fully interactive (prompts for everything):

```bash
ritual note
```

Set a note on a deck card (name resolved across all list types):

```bash
ritual note "My Deck" Sol Ring --note "starts the engine"
```

Pin the list type when a name is ambiguous, or to be explicit:

```bash
ritual note --deck "My Deck" --card-id 17 --note "alpha printing"
```

Replace an existing note. Setting always overwrites:

```bash
ritual note --collection "Main" "Mana Crypt" --note "tutor target"
```

Remove a note:

```bash
ritual note --collection "Main" "Mana Crypt" --clear
```

Pipe a JSON record for scripting:

```bash
ritual note --collection main "Sol Ring" --note "first edition" --output json
```

## Behavior

### Setting Replaces

Setting a note **replaces** any existing note, with no confirmation. The previous text is reported back (`previousNote` in JSON output), so scripts can detect a replacement.

```json
{
  "type": "deck",
  "list": "my-deck",
  "cardName": "Sol Ring",
  "cardId": 17,
  "note": "second",
  "previousNote": "first"
}
```

### Clearing Is Idempotent

`--clear` on a card with no note succeeds without rewriting the file or appending a changelog entry. JSON output reports `{ "cleared": false, "previousNote": null }` for this case.

When a note is removed, the response includes the removed text:

```json
{
  "type": "deck",
  "list": "my-deck",
  "cardName": "Sol Ring",
  "cardId": 17,
  "cleared": true,
  "previousNote": "starts the engine"
}
```

### List Resolution

`[listName]` follows the shared [List Names](/list-resolution/) rules. A name that exists in more than one type is rejected unless you pin it with `--deck`, `--collection`, or `--wanted`.

### Card Resolution

- **By name**: fuzzy match, ignoring punctuation, case, and accents (`seance` matches `Séance`). An exact name wins; otherwise substring matches are used. If several cards match (say, two printings of "Lightning Bolt"), the command exits with a `usage_error` listing each one. Narrow with `--card-id` or run interactively.
- **By card ID**: `--card-id <N>` targets one entry by its `&N` suffix. IDs are unique within a list file and must be positive integers.

When both a name and `--card-id` are given they must agree. A disagreement is a usage error naming both (`--card-id 3 is 'Demonic Tutor', which does not match 'Lightning Bolt'.`). IDs are reused after a removal, so a stale ID paired with a name usually means the wrong card is about to be touched.

### Dry Runs

`--dry-run` resolves the list, the card, and the note text, then reports what the note _would_ become. Nothing is written: no list file, changelog, `.sha256` sidecar, or card-ID backfill. There is no `-n` short form, since `-n` is `--note`. Text output is prefixed `[dry-run]`; JSON output carries `"dryRun": true`. The idempotent `--clear` no-op reports `cleared: false` and `previousNote: null` whether or not it is a dry run.

### Quantity Behavior

In a deck, copies of the same printing share one line and one `&N` ID (`4 Lightning Bolt`), so one note covers all of them. To give one copy a different note, split the line into separate entries first.

### Note Validation

Notes are single-line text. Surrounding whitespace is trimmed, and control characters (newlines, tabs, NUL, DEL, escape sequences) are rejected. Quotes and other printable punctuation are allowed. The admin UI applies the same validation. An empty or whitespace-only `--note` is rejected; clearing is only ever done with `--clear`.

### Change Tracking

A set is recorded in the list's `.changes.md` changelog as `Set note on "<Card>" &N to "<text>"`, and a clear as `Cleared note on "<Card>" &N`. An idempotent `--clear` records nothing.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success (note set or cleared, or no-op `--clear` when no note existed)                                                                                                                                                                                                                             |
| `2`  | Usage error (conflicting type flags, a type prefix contradicting a type flag, a `--card-id` that disagrees with the card name, ambiguous list name, ambiguous card match, empty note, no `--note`/`--clear` when prompts are unavailable, prompts unavailable for interactive list/card selection) |
| `3`  | Not found (missing list file, missing card, missing card ID)                                                                                                                                                                                                                                       |
| `1`  | Runtime error (file changed concurrently, etc.)                                                                                                                                                                                                                                                    |
