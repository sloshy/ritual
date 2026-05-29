---
sidebar_position: 11
---

# add-note

Attach a note to a card that already exists in a deck, collection, or wanted list.

Notes are stored in list files as `{note text}` between the bracketed metadata and the `&N` card ID.

## Usage

```bash
./ritual add-note [listName] [cardName...] [options]
```

`[listName]` is resolved across all three list types (see [List Resolution](./list-resolution)); pass a `--deck`, `--collection`, or `--wanted` flag to pin the type or disambiguate. If invoked with no list name, the command runs interactively, prompting you to pick a list (filtered by the type flag if given), then the card and note text. Any argument or option you supply skips the corresponding prompt — fully scripting-friendly.

## Arguments

| Argument        | Description                                                                   | Required |
| --------------- | ----------------------------------------------------------------------------- | -------- |
| `[listName]`    | Name of the deck, collection, or wanted list (case-insensitive, no extension) | No       |
| `[cardName...]` | Card name to attach the note to (fuzzy match)                                 | No       |

## Options

| Option              | Description                                                                                                   | Default |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ------- |
| `--deck`            | Resolve the name as a deck                                                                                    |         |
| `--collection`      | Resolve the name as a collection                                                                              |         |
| `--wanted`          | Resolve the name as a wanted list                                                                             |         |
| `-n, --note <text>` | Note text. If omitted, you will be prompted. Cannot be empty — use `clear-note` to remove a note.             |         |
| `--card-id <id>`    | Disambiguate by card ID (the `&N` suffix in list files). Required when name search hits multiple printings.   |         |
| `--overwrite`       | Replace an existing note. Without this flag, the command refuses to overwrite a card that already has a note. | `false` |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                                                    | `text`  |
| `--quiet`           | Suppress non-essential output                                                                                 | `false` |

## Examples

Fully interactive (prompts for everything):

```bash
./ritual add-note
```

Set a note on a deck card (name resolved across all list types):

```bash
./ritual add-note "My Deck" Sol Ring --note "starts the engine"
```

Pin the list type when a name is ambiguous, or to be explicit:

```bash
./ritual add-note --deck "My Deck" --card-id 17 --note "alpha printing"
```

Replace an existing note (without `--overwrite`, this fails):

```bash
./ritual add-note --collection "Main" "Mana Crypt" --note "tutor target" --overwrite
```

To remove a note, use the dedicated [`clear-note`](./clear-note) command instead.

Pipe a JSON record for scripting:

```bash
./ritual add-note --collection main "Sol Ring" --note "first edition" --output json
```

## Behavior

### List Resolution

`[listName]` is matched case-insensitively across all list types (exact name first, then a unique substring), and a name that exists in more than one type is rejected unless you pin it with `--deck`, `--collection`, or `--wanted`. See [List Resolution](./list-resolution) for the full rules.

### Card Resolution

- **By name**: the input is fuzzy-matched against the cards in the list. Punctuation and case are ignored; substring matches are accepted. If multiple cards match (e.g. two different printings of "Lightning Bolt"), the command exits with a `usage_error` listing each match. Disambiguate with `--card-id` or run interactively.
- **By card ID**: pass `--card-id <N>` to target an entry by its persistent `&N` suffix. Card IDs are unique within each list file, and must be positive integers.

### Quantity Behavior

For deck lists with more than one quantity of any card not separated by printing (e.g. `4 Lightning Bolt`), all copies share a single line and a single `&N` ID, so a single note attaches to all of them. To give one copy a different note, split the line into multiple entries first.

### Note Validation

Notes are single-line text. The command trims surrounding whitespace and rejects any control characters (newlines, tabs, NUL, DEL, escape sequences) and empty notes. Quotes and other printable punctuation are allowed. The same validation applies to notes coming from the admin UI. To remove a note from a card, use [`clear-note`](./clear-note).

### Existing Notes

If the target card already has a note, the command refuses to overwrite it unless `--overwrite` is set. This protects against accidental clobbering when scripting.

### Change Tracking

Each note change is recorded in the list's `.changes.md` changelog as `Set note on "<Card>" &N to "<text>"`.

## Exit Codes

| Code | Meaning                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                               |
| `2`  | Usage error (conflicting type flags, ambiguous list name, ambiguous card match, attempted overwrite without the flag) |
| `3`  | Not found (missing list file, missing card, missing card ID)                                                          |
| `1`  | Runtime error (file changed concurrently, etc.)                                                                       |
