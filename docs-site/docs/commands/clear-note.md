---
sidebar_position: 12
---

# clear-note

Remove the note attached to a card in a deck, collection, or wanted list.

This is the dedicated counterpart to [`add-note`](./add-note). Card resolution (name fuzzy match, `--card-id`, ambiguity errors, interactive prompts) is identical. There is no `--note` flag — the command always clears.

## Usage

```bash
./ritual clear-note [type] [targetName] [cardName...] [options]
```

If invoked with no arguments, the command runs interactively, prompting for the list type, the list name, and the card. Any argument or option you supply skips the corresponding prompt.

## Arguments

| Argument        | Description                                                         | Required |
| --------------- | ------------------------------------------------------------------- | -------- |
| `[type]`        | Target type: `deck`, `collection`, or `wanted`                      | No       |
| `[targetName]`  | Name of the deck, collection, or wanted list (filename without ext) | No       |
| `[cardName...]` | Card name whose note should be cleared (fuzzy match)                | No       |

## Options

| Option              | Description                                                                                                 | Default |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ------- |
| `--card-id <id>`    | Disambiguate by card ID (the `&N` suffix in list files). Required when name search hits multiple printings. |         |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                                                  | `text`  |
| `--quiet`           | Suppress non-essential output                                                                               | `false` |

## Examples

Clear a note on a deck card:

```bash
./ritual clear-note deck "My Deck" "Sol Ring"
```

Disambiguate by card ID:

```bash
./ritual clear-note deck "My Deck" --card-id 17
```

Pipe a JSON record for scripting:

```bash
./ritual clear-note collection main "Sol Ring" --output json
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

### Card Resolution

Identical to [`add-note`](./add-note#card-resolution).

### Change Tracking

A successful clear is recorded in the list's `.changes.md` changelog as `Cleared note on <Card> &N`.

## Exit Codes

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| `0`  | Success (note cleared, or no-op when no note existed)              |
| `2`  | Usage error (invalid type, ambiguous match, malformed `--card-id`) |
| `3`  | Not found (missing list file, missing card, missing card ID)       |
| `1`  | Runtime error (file changed concurrently, etc.)                    |
