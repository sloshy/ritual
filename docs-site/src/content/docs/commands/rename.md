---
title: 'rename'
---

Rename a deck, collection, or wanted list. The file, its display name, and every sidecar move together.

## Usage

```bash
ritual rename <list> <newName...> [options]
```

`<list>` names a list of any type; see [List Names](/list-resolution/). Pass `--deck`, `--collection`, or `--wanted` (or a `deck:`/`collection:`/`wanted:` prefix on the name) to pin the type or disambiguate.

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

The JSON payload is `{ type, oldSlug, newSlug, name, newFilePath, oldFilePath }`, the same paths the text output prints, so a script never has to rebuild them from the slug.

## Behavior

The new file name is derived from the new name by the same sanitization every surface uses (see [List file names](/commands/new/#list-file-names)), and the display name inside the file, its first `# Title` heading, is rewritten. When the new name sanitizes to the slug the list already has, the file is updated in place.

On a file move, the list's sidecars move with it: the `.changes.md` changelog, the `.art.json` [custom art](/custom-art/) map, the `.categories.json` [categories](/list-format/#categories-namecategoriesjson) sidecar with its still-valid `.categories.json.sha256`, and, for decks, the `.primer.md` primer. (A rename never rewrites the categories sidecar, so its hash travels with it; leaving it behind would read as a hand edit.) The old `.sha256` content hash is removed. A fresh hash is written only when the old sidecar still matched the file, so a hand-edited list is left with no sidecar and [`detect-changes`](/commands/detect-changes/) still records its edits.

Renaming onto a name that already [resolves](/list-resolution/#names-that-would-collide-are-refused-at-creation) to another list of the same type is refused. That includes a name that merely folds onto it (`atraxa superfriends` onto `Atraxa Superfriends`), which would otherwise leave two lists sharing one addressable name.

Renaming a list to a different spelling of **its own** name is never a collision. Changing only capitalization (`burn` → `Burn`) or punctuation is a display-name change. On a case-insensitive file system (macOS, Windows) the new path names the very same file, so the list and each of its sidecars are moved through a temporary name to make the new spelling stick. A failure part-way puts everything back.

## Exit Codes

| Code | Meaning                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                                                                   |
| `2`  | Usage error (conflicting type flags, a `deck:`/`collection:`/`wanted:` prefix contradicting a type flag, ambiguous list, unusable new name, a name that already resolves to another list) |
| `3`  | Not found (no list matches `<list>`)                                                                                                                                                      |
| `1`  | Runtime error                                                                                                                                                                             |
