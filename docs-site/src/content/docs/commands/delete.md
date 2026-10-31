---
title: 'delete'
---

Delete a deck, collection, or wanted list, along with all of its companion files (called sidecar files in the prompt). The files move into the workspace's `.trash/` folder rather than being erased, so a deletion can be [undone by hand](#restoring-a-deleted-list).

## Usage

```bash
ritual delete <list> [options]
```

`<list>` names a list of any type; see [List Names](/list-resolution/). Pass `--deck`, `--collection`, or `--wanted` (or a `deck:`/`collection:`/`wanted:` prefix on the name) to fix the type or disambiguate.

Deletion is destructive, so you must confirm it with the list's **display name** (not its slug), the same confirmation the admin site asks for. Pass it with `--confirm`. Without the flag, an interactive terminal names the resolved target and prompts for its exact display name. A non-interactive run exits with a usage error pointing at `--confirm`:

```
About to delete deck 'Modern Burn' (decks/Modern Burn.md) and its sidecar files.
? Type 'Modern Burn' to confirm: ›
```

The two halves are matched differently on purpose. `<list>` is [resolved](/list-resolution/), so a partial, differently cased, or colon-carrying display name finds the list. `--confirm` must be the display name character for character.

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
ritual delete deck:burn --confirm "Modern Burn"
```

Delete a collection and capture the result as JSON:

```bash
ritual delete --collection main --confirm "Trade Binder" --output json
```

The JSON output is `{ type, slug, deleted: true, deletedFiles, trashDir }`, where `deletedFiles` lists every path removed (the list plus whichever companion files it had) and `trashDir` is the trash folder they moved into. Both are absolute paths.

## Behavior

Deleting a list moves the markdown file and every companion file it may have into the trash: the `.sha256` content hash, the `.changes.md` changelog, the `.art.json` [custom art](/custom-art/) map, the `.categories.json` [categories](/list-format/#categories-namecategoriesjson) file and its `.categories.json.sha256`, and, for decks, the `.primer.md` primer. Nothing is deleted until the confirmation name matches the display name exactly.

### Restoring a deleted list

Each deletion gets its own folder, `.trash/<time>-<type>-<slug>/` (for example `.trash/2026-10-05T14-03-22Z-deck-burn/`), and the files keep their path relative to the workspace inside it. To restore the list, move the files back; `-n` refuses to overwrite a list created under the same name since:

```bash
mv -n ".trash/2026-10-05T14-03-22Z-deck-burn/decks/"* decks/
```

A list whose folder lies outside the workspace (an absolute or `../` `decksDir`, `collectionsDir`, or `wantedDir`) is trashed flat: its files sit directly in the trash folder under their own names, so move them back to that folder.

The admin site and the MCP `delete_list` tool use the same trash. Ritual never empties `.trash/`; delete a folder there yourself once you no longer want it. `init-site` adds `.trash/` to the workspace's `.gitignore`.

## Exit Codes

| Code | Meaning                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                                                           |
| `2`  | Usage error (conflicting type flags, a `deck:`/`collection:`/`wanted:` prefix contradicting a type flag, ambiguous list, wrong confirmation name, no terminal and no `--confirm`) |
| `3`  | Not found (no list matches `<list>`)                                                                                                                                              |
| `1`  | Runtime error                                                                                                                                                                     |
