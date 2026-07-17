---
title: 'delete'
---

Delete a deck, collection, or wanted list, along with all of its sidecar files.

## Usage

```bash
./ritual delete <list> [options]
```

`<list>` is resolved across all three list types (see [List Resolution](/commands/list-resolution/)); pass a `--deck`, `--collection`, or `--wanted` flag (or a `deck:`/`collection:`/`wanted:` prefix on the name) to pin the type or disambiguate.

Deletion is destructive, so it must be confirmed with the list's **display name** (not its slug) — the same confirmation the admin site asks for. Pass it with `--confirm`; without the flag, an interactive terminal prompts `Type the list name to confirm`, and a non-interactive run exits with a usage error pointing at `--confirm`.

## Arguments

| Argument | Description                                                                               | Required |
| -------- | ----------------------------------------------------------------------------------------- | -------- |
| `<list>` | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | Yes      |

## Options

| Option              | Description                                      | Default |
| ------------------- | ------------------------------------------------ | ------- |
| `--deck`            | Resolve the name as a deck                       |         |
| `--collection`      | Resolve the name as a collection                 |         |
| `--wanted`          | Resolve the name as a wanted list                |         |
| `--confirm <name>`  | The list's display name, confirming the deletion |         |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`       | `text`  |
| `--quiet`           | Suppress non-essential output                    | `false` |

## Examples

Delete a deck non-interactively:

```bash
./ritual delete deck:burn --confirm "Modern Burn"
```

Delete a collection and capture the result as JSON:

```bash
./ritual delete --collection main --confirm "Trade Binder" --output json
```

The JSON payload is `{ type, slug, deleted: true }`.

## Behavior

Deleting a list removes the markdown file and every sidecar it may have: the `.sha256` content hash, the `.changes.md` changelog, and — for decks — the `.primer.md` primer. Nothing is deleted until the confirmation name matches the display name exactly.

## Exit Codes

| Code | Meaning                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                       |
| `2`  | Usage error (conflicting type flags, ambiguous list, wrong confirmation name, no terminal and no `--confirm`) |
| `3`  | Not found (no list matches `<list>`)                                                                          |
| `1`  | Runtime error                                                                                                 |
