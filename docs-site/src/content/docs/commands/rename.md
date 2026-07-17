---
title: 'rename'
---

Rename a deck, collection, or wanted list — the file, its display name, and every sidecar move together.

## Usage

```bash
./ritual rename <list> <newName...> [options]
```

`<list>` is resolved across all three list types (see [List Resolution](/commands/list-resolution/)); pass a `--deck`, `--collection`, or `--wanted` flag (or a `deck:`/`collection:`/`wanted:` prefix on the name) to pin the type or disambiguate.

## Arguments

| Argument       | Description                                                                               | Required |
| -------------- | ----------------------------------------------------------------------------------------- | -------- |
| `<list>`       | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | Yes      |
| `<newName...>` | New display name for the list                                                             | Yes      |

## Options

| Option              | Description                                | Default |
| ------------------- | ------------------------------------------ | ------- |
| `--deck`            | Resolve the name as a deck                 |         |
| `--collection`      | Resolve the name as a collection           |         |
| `--wanted`          | Resolve the name as a wanted list          |         |
| `--output <format>` | Output format: `text`, `json`, or `ndjson` | `text`  |
| `--quiet`           | Suppress non-essential output              | `false` |

## Examples

Rename a deck:

```bash
./ritual rename deck:burn "Modern Burn"
```

Rename a collection and capture the result as JSON:

```bash
./ritual rename --collection main "Trade Binder" --output json
```

The JSON payload is `{ type, oldSlug, newSlug, name }`.

## Behavior

The new file name is derived from the new name by the same sanitization every surface uses (see [List file names](/commands/new/#list-file-names)), and the display name inside the file is rewritten — a deck's front-matter `name:` (plus a legacy `# H1` matching the old name), a flat list's first `# H1`. When the new name sanitizes to the slug the list already has, the file is updated in place.

On a file move, the list's sidecars move with it: the `.changes.md` changelog and — for decks — the `.primer.md` primer are renamed alongside, the old `.sha256` content hash is removed, and a fresh one is written for the new file. Renaming onto a slug that already exists is refused.

## Exit Codes

| Code | Meaning                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                        |
| `2`  | Usage error (conflicting type flags, ambiguous list, unusable new name, target already exists) |
| `3`  | Not found (no list matches `<list>`)                                                           |
| `1`  | Runtime error                                                                                  |
