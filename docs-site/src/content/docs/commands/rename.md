---
title: 'ritual rename'
description: 'Rename a list, moving its file and companion files together.'
sidebar:
  label: 'rename'
---

Rename a deck, collection, or wanted list. The file, its display name, and every companion file move together.

## Usage

```bash
ritual rename <list> <newName...> [options]
```

`<list>` names a list of any type; see [List Names](/list-resolution/). Pass `--deck`, `--collection`, or `--wanted` (or a `deck:`/`collection:`/`wanted:` prefix on the name) to fix the type or disambiguate.

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
ritual rename deck:burn "Modern Burn"
```

Rename a collection and capture the result as JSON:

```bash
ritual rename --collection main "Trade Binder" --output json
```

The JSON output is `{ listType, slug, name, oldSlug, newFilePath, oldFilePath, warnings }`, the same paths the text output prints. `warnings` is usually empty; it names the old file when the list was renamed but its old file could not be removed (a duplicate to delete by hand), which also prints on stderr.

## Behavior

The new file name is derived from the new name by the same rules every surface uses (see [List file names](/commands/new/#list-file-names)), and the list's first `# Title` heading is rewritten. A list's title and its file name are [one name](/list-resolution/#a-lists-title-is-its-file-name), so `rename` is how either changes: no two lists of a type share a title, and a name another list of the type already goes by is refused. When the new name maps to the slug the list already has, the file is updated in place.

To fix a `# Title` heading edited by hand (so the title no longer names its file), run [`ritual cleanup`](/commands/cleanup/), which renames the file to match through this same rename.

On a file move, the list's companion files move with it:

- the `.changes.md` changelog
- the `.art.json` [custom art](/custom-art/) map
- the `.categories.json` [categories](/list-format/#categories-namecategoriesjson) file with its `.categories.json.sha256` (a rename never rewrites the categories file, so its hash stays valid)
- for decks, the `.primer.md` primer

The old `.sha256` content hash is removed. A fresh one is written only when the old hash still matched the file, so a hand-edited list is left with no hash and [`detect-changes`](/commands/detect-changes/) still records its edits.

Renaming onto a name that already [resolves](/list-resolution/#names-that-would-collide-are-refused-at-creation) to another list of the same type is refused. That includes a name that merely folds onto it (`atraxa superfriends` onto `Atraxa Superfriends`), which would leave two lists sharing one addressable name.

Renaming a list to a different spelling of its own name is never a collision. Changing only capitalization (`burn` → `Burn`) or punctuation is a display-name change. On a case-insensitive file system (macOS, Windows) the new path names the same file, so the list and its companion files are moved through a temporary name so the new spelling takes effect. A failure part-way puts everything back.

## Exit Codes

| Code | Meaning                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                                                                   |
| `2`  | Usage error (conflicting type flags, a `deck:`/`collection:`/`wanted:` prefix contradicting a type flag, ambiguous list, unusable new name, a name that already resolves to another list) |
| `3`  | Not found (no list matches `<list>`)                                                                                                                                                      |
| `1`  | Runtime error                                                                                                                                                                             |
