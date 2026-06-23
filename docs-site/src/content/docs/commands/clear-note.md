---
title: 'clear-note'
---

Remove the note attached to a card in a deck, collection, or wanted list.

This is the dedicated counterpart to [`add-note`](/commands/add-note/). Card resolution (name fuzzy match, `--card-id`, ambiguity errors, interactive prompts) is identical. There is no `--note` flag — the command always clears.

## Usage

```bash
./ritual clear-note [listName] [cardName...] [options]
```

`[listName]` is resolved across all three list types (see [List Resolution](/commands/list-resolution/)); pass a `--deck`, `--collection`, or `--wanted` flag to pin the type or disambiguate. If invoked with no list name, the command runs interactively, prompting you to pick a list (filtered by the type flag if given) and the card. Any argument or option you supply skips the corresponding prompt.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]`    | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |
| `[cardName...]` | Card name whose note should be cleared (fuzzy match)                                      | No       |

## Options

| Option              | Description                                                                                                 | Default |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ------- |
| `--deck`            | Resolve the name as a deck                                                                                  |         |
| `--collection`      | Resolve the name as a collection                                                                            |         |
| `--wanted`          | Resolve the name as a wanted list                                                                           |         |
| `--card-id <id>`    | Disambiguate by card ID (the `&N` suffix in list files). Required when name search hits multiple printings. |         |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                                                  | `text`  |
| `--quiet`           | Suppress non-essential output                                                                               | `false` |

## Examples

Clear a note on a deck card (name resolved across all list types):

```bash
./ritual clear-note "My Deck" "Sol Ring"
```

Disambiguate by card ID (and pin the list type):

```bash
./ritual clear-note --deck "My Deck" --card-id 17
```

Pipe a JSON record for scripting:

```bash
./ritual clear-note --collection main "Sol Ring" --output json
```

## Behavior

### Idempotent

Clearing a card that has no note is a successful no-op. The file is not rewritten, and no changelog entry is appended. JSON output reports `{ "cleared": false, "previousNote": null }` for this case so scripts can distinguish a real clear from an idempotent run.

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

`[listName]` is matched case- and accent-insensitively across all list types (exact name first, then a unique substring), with ambiguous names rejected unless pinned by `--deck`, `--collection`, or `--wanted`. See [List Resolution](/commands/list-resolution/).

### Card Resolution

Identical to [`add-note`](/commands/add-note/#card-resolution).

### Change Tracking

A successful clear is recorded in the list's `.changes.md` changelog as `Cleared note on "<Card>" &N`.

## Exit Codes

| Code | Meaning                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| `0`  | Success (note cleared, or no-op when no note existed)                                                  |
| `2`  | Usage error (conflicting type flags, ambiguous list name, ambiguous card match, malformed `--card-id`) |
| `3`  | Not found (missing list file, missing card, missing card ID)                                           |
| `1`  | Runtime error (file changed concurrently, etc.)                                                        |
