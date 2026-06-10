---
title: 'history'
---

Interactively compact and rewrite the change history (`.changes.md`) for a deck, collection, or wanted list.

Sometimes a list's change log gets noisy — many small sessions before a commit, mistimed entries, or sets you'd rather merge. `history` is a menu-driven editor for the change log **only**. It never touches the list's own `.md` file: every action operates on the change sets, and nothing is written until you explicitly choose to save.

The admin site offers the same editor in the browser — see the [Change History](/admin/history/) page.

## Usage

```bash
./ritual history [listName] [options]
```

`[listName]` is resolved across all three list types (see [List Resolution](/commands/list-resolution/)); pass a `--deck`, `--collection`, or `--wanted` flag to pin the type or disambiguate. If invoked with no list name, the command prompts you to pick one (filtered by the type flag if given).

## Arguments

| Argument     | Description                                                                   | Required |
| ------------ | ----------------------------------------------------------------------------- | -------- |
| `[listName]` | Name of the deck, collection, or wanted list (case-insensitive, no extension) | No       |

## Options

| Option         | Description                       |
| -------------- | --------------------------------- |
| `--deck`       | Resolve the name as a deck        |
| `--collection` | Resolve the name as a collection  |
| `--wanted`     | Resolve the name as a wanted list |

`--deck`, `--collection`, and `--wanted` are mutually exclusive.

## The editor

The main menu lists each change set (newest first) as a collapsed row — its timestamp and how many change lines it holds. Start typing to filter the list by timestamp (the global actions stay pinned); the list picker shown when no list name is given is filterable the same way. Selecting a set expands it (printing its lines) and opens a per-set action menu. Below the sets are the global actions.

### Per-set actions

| Action             | Effect                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Delete**         | Removes the selected change set from the log. The cards themselves are **not** removed from the list — only the history entry.                                |
| **Combine**        | Prompts for another change set; its entries are appended to the selected set and the other set is deleted. The selected set keeps its original timestamp.     |
| **Edit timestamp** | Replace the set's timestamp. The new value must be a valid ISO-8601 timestamp (e.g. `2026-05-29T12:00:00.000Z`); on save, sets are re-sorted chronologically. |

### Global actions

| Action                          | Effect                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rewrite with defaults**       | Replaces **all** change sets with a single new set (timestamped now) describing the list exactly as it stands now — every card, plus sections, commander, notes, and printings. |
| **Preview changes to be saved** | Summarizes how the saved file will differ: change-set and change-line counts before/after, and the resulting list of sets.                                                      |
| **Undo last change**            | Reverts the most recent edit. All edits are kept on an in-memory stack, so you can undo repeatedly back to the loaded state.                                                    |
| **Quit**                        | If there are unsaved changes, prompts: **Quit and save**, **Quit without saving**, or **Cancel** (keep editing). Nothing is written to disk until you choose _Quit and save_.   |

## Behavior

### List Resolution

`[listName]` is matched case-insensitively across all list types (exact name first, then a unique substring), and a name that exists in more than one type is rejected unless you pin it with a type flag. See [List Resolution](/commands/list-resolution/).

### Lossless editing

Change lines — including their `&N` card IDs — are moved around verbatim; the editor never re-parses or reformats them. The "rewrite with defaults" action is the one exception, since it regenerates lines from the current list contents.

### Only the change log is modified

Every action edits the `.changes.md` file alongside the list. The list's own `.md` file is never read for mutation (only "rewrite with defaults" reads it, to describe its current state) and never written.

## Exit Codes

| Code | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| `0`  | Success (saved, discarded, or nothing to save)            |
| `2`  | Usage error (conflicting type flags, ambiguous list name) |
| `3`  | Not found (no matching list, or no lists at all)          |
