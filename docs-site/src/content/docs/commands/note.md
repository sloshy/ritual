---
title: 'note'
---

Set, replace, or clear the note on a card that already exists in a deck, collection, or wanted list.

Notes are stored in list files as `{note text}` between the bracketed metadata and the `&N` card ID.

The edit is line-preserving: only the targeted card's line is rewritten. Everything else in the file — prose, comments, lines the parser cannot read — stays byte-for-byte intact.

## Usage

```bash
./ritual note [listName] [cardName...] [options]
```

`[listName]` is resolved across all three list types (see [List Resolution](/commands/list-resolution/)); pass a `--deck`, `--collection`, or `--wanted` flag to pin the type or disambiguate. If invoked with no list name, the command runs interactively, prompting you to pick a list (filtered by the type flag if given), then the card and note text. Any argument or option you supply skips the corresponding prompt — fully scripting-friendly. The list and card prompts require a terminal with prompts enabled too — with piped stdin or `--no-input`, a missing `[listName]` or card selector (`[cardName...]`/`--card-id`) exits with a usage error (code `2`) instead of prompting.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]`    | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |
| `[cardName...]` | Card name whose note to set or clear (fuzzy match)                                        | No       |

## Options

| Option              | Description                                                                                                 | Default |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ------- |
| `--deck`            | Resolve the name as a deck                                                                                  |         |
| `--collection`      | Resolve the name as a collection                                                                            |         |
| `--wanted`          | Resolve the name as a wanted list                                                                           |         |
| `-n, --note <text>` | Note text. Replaces any existing note. Cannot be empty — use `--clear` to remove a note.                    |         |
| `--clear`           | Remove the note from the card. Cannot be combined with `--note`.                                            |         |
| `--card-id <id>`    | Disambiguate by card ID (the `&N` suffix in list files). Required when name search hits multiple printings. |         |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                                                  | `text`  |
| `--quiet`           | Suppress non-essential output                                                                               | `false` |

If neither `--note` nor `--clear` is given, the command prompts for the note text (prefilled with the card's current note). When prompts are unavailable (stdin is not a terminal, or `--no-input` / `RITUAL_NO_INPUT` is in force), one of the two flags is required — instead of prompting, the command exits with code `2` (`Input required: …`).

## Examples

Fully interactive (prompts for everything):

```bash
./ritual note
```

Set a note on a deck card (name resolved across all list types):

```bash
./ritual note "My Deck" Sol Ring --note "starts the engine"
```

Pin the list type when a name is ambiguous, or to be explicit:

```bash
./ritual note --deck "My Deck" --card-id 17 --note "alpha printing"
```

Replace an existing note — setting always overwrites:

```bash
./ritual note --collection "Main" "Mana Crypt" --note "tutor target"
```

Remove a note:

```bash
./ritual note --collection "Main" "Mana Crypt" --clear
```

Pipe a JSON record for scripting:

```bash
./ritual note --collection main "Sol Ring" --note "first edition" --output json
```

## Behavior

### Setting Replaces

Setting a note **unconditionally replaces** any existing note — there is no overwrite guard or confirmation. The previous text is reported back (`previousNote` in JSON output), so scripts can detect that a replacement happened.

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

`--clear` on a card that has no note is a successful no-op. The file is not rewritten, and no changelog entry is appended. JSON output reports `{ "cleared": false, "previousNote": null }` for this case so scripts can distinguish a real clear from an idempotent run.

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

`[listName]` is matched case- and accent-insensitively across all list types (exact name first, then a unique substring), and a name that exists in more than one type is rejected unless you pin it with `--deck`, `--collection`, or `--wanted`. See [List Resolution](/commands/list-resolution/) for the full rules.

### Card Resolution

- **By name**: the input is fuzzy-matched against the cards in the list. Punctuation, case, and accents are ignored (so `seance` matches `Séance`); substring matches are accepted. If multiple cards match (e.g. two different printings of "Lightning Bolt"), the command exits with a `usage_error` listing each match. Disambiguate with `--card-id` or run interactively.
- **By card ID**: pass `--card-id <N>` to target an entry by its persistent `&N` suffix. Card IDs are unique within each list file, and must be positive integers.

### Quantity Behavior

For deck lists with more than one quantity of any card not separated by printing (e.g. `4 Lightning Bolt`), all copies share a single line and a single `&N` ID, so a single note attaches to all of them. To give one copy a different note, split the line into multiple entries first.

### Note Validation

Notes are single-line text. The command trims surrounding whitespace and rejects any control characters (newlines, tabs, NUL, DEL, escape sequences). Quotes and other printable punctuation are allowed. The same validation applies to notes coming from the admin UI. An empty or whitespace-only `--note` value is rejected — clearing is an explicit action via `--clear`, never an empty set.

### Change Tracking

A set is recorded in the list's `.changes.md` changelog as `Set note on "<Card>" &N to "<text>"`; a clear as `Cleared note on "<Card>" &N`. An idempotent `--clear` records nothing.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success (note set or cleared, or no-op `--clear` when no note existed)                                                                                                                                   |
| `2`  | Usage error (conflicting type flags, ambiguous list name, ambiguous card match, empty note, no `--note`/`--clear` when prompts are unavailable, prompts unavailable for interactive list/card selection) |
| `3`  | Not found (missing list file, missing card, missing card ID)                                                                                                                                             |
| `1`  | Runtime error (file changed concurrently, etc.)                                                                                                                                                          |
