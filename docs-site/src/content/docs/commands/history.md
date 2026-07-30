---
title: 'history'
---

Interactively compact and rewrite the change history (`.changes.md`) for a deck, collection, or wanted list.

Sometimes a list's change log gets noisy — many small sessions before a commit, mistimed entries, or sets you'd rather merge. `history` is a menu-driven editor for the change log **only**. It never edits the list's own `.md` file: every action operates on the change sets, and nothing is written until you explicitly choose to save. (Opening the editor does run the standard [card-ID backfill](/#the-card-id-backfill) first, since the _Rewrite with defaults_ action embeds `&N` IDs in the lines it generates; the read-only `--show` path skips it.)

For scripts (or a quick look), `--show` prints the history read-only and exits without opening the editor — see [Read-only output with --show](#read-only-output-with---show).

The admin site offers the same editor in the browser — see the [Change History](/admin/history/) page.

## Usage

```bash
./ritual history [listName] [options]
```

`[listName]` is resolved across all three list types (see [List Resolution](/commands/list-resolution/)); pass a `--deck`, `--collection`, or `--wanted` flag to pin the type or disambiguate. If invoked with no list name, the command prompts you to pick one (filtered by the type flag if given).

## Arguments

| Argument     | Description                                                                               | Required |
| ------------ | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]` | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |

## Options

| Option              | Description                                                               |
| ------------------- | ------------------------------------------------------------------------- |
| `--deck`            | Resolve the name as a deck                                                |
| `--collection`      | Resolve the name as a collection                                          |
| `--wanted`          | Resolve the name as a wanted list                                         |
| `--show`            | Print the change history and exit instead of opening the editor           |
| `--limit <n>`       | With `--show`: print only the newest `<n>` change sets (positive integer) |
| `--output <format>` | Output format for `--show`: `text` (default), `json`, or `ndjson`         |
| `--quiet`           | Suppress non-essential output                                             |

`--deck`, `--collection`, and `--wanted` are mutually exclusive. `--limit` and `--output json`/`ndjson` both require `--show`.

## Read-only output with `--show`

`--show` skips the editor entirely and prints the change history newest-first, then exits. Nothing is ever written — not even the [card-ID backfill](/#the-card-id-backfill) that runs when the editor opens.

```bash
./ritual history my-deck --show
./ritual history my-deck --show --limit 3
./ritual history my-deck --show --output json
```

Text output starts with a header line — `Change history for Deck 'my-deck' — 4 change set(s).` (the count is the full history, before any `--limit` truncation) — followed by each printed set: its timestamp and line count, then its raw change lines indented two spaces **verbatim**, including the leading `- ` and the `&N` card IDs, then any preserved hand-written lines attached to the set (see [Lossless editing](#lossless-editing)), indented the same way. A list with no recorded history prints `No change history recorded.` and still exits `0`.

`--limit <n>` keeps only the newest `n` sets, applied after the newest-first sort.

With `--output json`, the payload is deliberately the same shape as the admin site's `GET /api/history/:type/:slug` response, minus its `success` and `defaultLines` fields:

```json
{
  "header": "# Changelog for my-deck",
  "sets": [
    {
      "timestamp": "2026-02-01T10:00:00.000Z",
      "lines": ["- Removed \"Lightning Bolt\" (LEA:161) &2"]
    }
  ]
}
```

- `header` — everything before the first change set in the `.changes.md` file.
- `sets` — the change sets newest first (truncated to `--limit`), each `{ timestamp, lines }` with the raw `- ` lines verbatim, plus a `trailing` array when hand-written text follows the set's change lines (see [Lossless editing](#lossless-editing)). An empty history emits `"sets": []`.

Because `--show` output is meant for scripts, invoking it without a `[listName]` when [prompts are unavailable](/#when-prompts-are-unavailable) is a usage error (exit `2`) rather than a hang — the interactive list picker only runs on a TTY.

`--show` is also the only fork available to a script: the editor is interactive from its first screen, so running `history <list>` without `--show` when prompts are unavailable exits `2` (`Input required: the interactive history editor is unavailable …`) instead of rendering prompt UI and exiting `0` having changed nothing. For the same reason `--output json`/`ndjson` requires `--show`.

## The editor

The main menu lists each change set (newest first) as a collapsed row — its timestamp and how many change lines it holds. Start typing to filter the list by timestamp (the global actions stay pinned); the list picker shown when no list name is given is filterable the same way. Selecting a set expands it (printing its lines) and opens a per-set action menu. Below the sets are the global actions.

### Per-set actions

| Action             | Effect                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Delete**         | Removes the selected change set from the log. The cards themselves are **not** removed from the list — only the history entry.                                                                                                                                                                                                                                                                               |
| **Combine**        | Prompts for another change set; the two sets' entries are merged into the selected set (which keeps its original timestamp) and the other set is deleted. Lines are ordered so the older set's changes sit above the newer set's — newest changes always at the bottom — and opposite changes cancel out (see [Combining sets](#combining-sets) below). If the merge cancels everything, the set is dropped. |
| **Edit timestamp** | Replace the set's timestamp. The new value must be a valid ISO-8601 timestamp (e.g. `2026-05-29T12:00:00.000Z`); on save, sets are re-sorted chronologically.                                                                                                                                                                                                                                                |

### Global actions

These appear below the change sets, in the order listed — undo first, since it takes back whatever
you just did, and the destructive rewrite below the harmless preview rather than above it.

| Action                          | Effect                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Undo last change**            | Reverts the most recent edit. All edits are kept on an in-memory stack, so you can undo repeatedly back to the loaded state. Offered only once you have made an edit.           |
| **Preview changes to be saved** | Summarizes how the saved file will differ: change-set and change-line counts before/after, and the resulting list of sets.                                                      |
| **Rewrite with defaults**       | Replaces **all** change sets with a single new set (timestamped now) describing the list exactly as it stands now — every card, plus sections, commander, notes, and printings. |
| **Exit**                        | If there are unsaved changes, prompts: **Save and exit**, **Exit without saving**, or **Cancel** (keep editing). Nothing is written to disk until you choose _Save and exit_.   |

## Behavior

### List Resolution

`[listName]` is matched case- and accent-insensitively across all list types (exact name first, then a unique substring), and a name that exists in more than one type is rejected unless you pin it with a type flag. See [List Resolution](/commands/list-resolution/).

### Combining sets

When two change sets are combined, their lines are interleaved by age — the older set's entries on top, the newer set's beneath — so newer changes always end up at the bottom, no matter which set you combined into which. The merge then compacts the result the same way the card editor's live change log does: an **add** and a later **remove** of the same card (matching printing, finish, condition, board, and ID) annihilate, as do set/unset-commander and add/remove-section pairs. A combine that cancels everything leaves the set empty, so it is dropped. Lines that survive keep their exact original text, including their `&N` card IDs.

### Lossless editing

Apart from combine's compaction, change lines — including their `&N` card IDs — are moved around verbatim; the editor never re-parses or reformats them. The "rewrite with defaults" action regenerates lines from the current list contents.

Hand-written text between change sets is preserved too: non-change lines are attached to the set they follow (shown beneath its change lines, and carried in `--show`'s JSON as the set's `trailing` array), travel with that set through timestamp edits and combines, and are re-emitted on save — each line kept as written (indentation included), though blank lines between them are not kept and the block always lands after the set's change lines. Deleting a set deletes its attached text with it, and **Rewrite with defaults** discards every set's attached text along with the sets themselves (the confirmation says how many lines that is); text before the first set belongs to the header and always survives.

### Only the change log is modified

Every action edits the `.changes.md` file alongside the list. The list's own `.md` file is never read for mutation (only "rewrite with defaults" reads it, to describe its current state) and never edited — the only write outside the changelog is the startup [card-ID backfill](/#the-card-id-backfill) noted above.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success (saved, discarded, or nothing to save; with `--show`, printed — even an empty history)                                                                                                                                                            |
| `2`  | Usage error (conflicting type flags, ambiguous list name, `--limit` or `--output json`/`ndjson` without `--show`, or a run needing a prompt when [prompts are unavailable](/#when-prompts-are-unavailable) — the editor, or `--show` without a list name) |
| `3`  | Not found (no matching list, or no lists at all)                                                                                                                                                                                                          |
