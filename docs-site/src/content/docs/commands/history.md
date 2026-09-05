---
title: 'history'
---

Compact and rewrite a list's change history (`.changes.md`) in a menu-driven editor, or print it read-only with `--show`.

A list's change log can get noisy: many small sessions before a commit, mistimed entries, or sets you'd rather merge. `history` edits the change log **only**. It never edits the list's own `.md` file. Every action operates on the change sets, and nothing is written until you explicitly choose to save. Opening the editor does run the standard [card-ID backfill](/cli-conventions/#the-card-id-backfill) first, since the _Rewrite with defaults_ action embeds `&N` IDs in the lines it generates. The read-only `--show` path skips it.

The admin site offers the same editor in the browser. See the [Change History](/admin/history/) page.

## Usage

```bash
ritual history [listName] [options]
```

`[listName]` names a list of any type; see [List Names](/list-resolution/). Pass `--deck`, `--collection`, or `--wanted` to pin the type or disambiguate. With no list name, the command prompts you to pick one (filtered by the type flag if given).

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

`--show` prints its payload and the editor needs a terminal, so `history` registers no `--quiet` ([shared convention](/cli-conventions/#scripting-conventions)).

`--deck`, `--collection`, and `--wanted` are mutually exclusive. `--limit` and `--output json`/`ndjson` both require `--show`.

## Read-only output with `--show`

`--show` skips the editor entirely, prints the change history newest-first, and exits. Nothing is ever written, not even the [card-ID backfill](/cli-conventions/#the-card-id-backfill) that runs when the editor opens.

```bash
ritual history my-deck --show
ritual history my-deck --show --limit 3
ritual history my-deck --show --output json
```

Text output starts with a header line, `Change history for Deck 'my-deck' — 4 change set(s).`, where the count is the full history before any `--limit` truncation. Each printed set follows: its timestamp and line count, then its raw change lines indented two spaces **verbatim**, including the leading `- ` and the `&N` card IDs, then any preserved hand-written lines attached to the set (see [Lossless editing](#lossless-editing)), indented the same way. A list with no recorded history prints `No change history recorded.` and still exits `0`.

`--limit <n>` keeps only the newest `n` sets, applied after the newest-first sort.

With `--output json`, the payload is the same shape as the admin site's `GET /api/history/:type/:slug` response, minus its `success` and `defaultEvents` fields:

```json
{
  "header": "# Changelog for my-deck",
  "sets": [
    {
      "timestamp": "2026-02-01T10:00:00.000Z",
      "lines": ["- Removed \"Lightning Bolt\" (LEA:161) &2"],
      "events": [
        {
          "action": "remove",
          "cardName": "Lightning Bolt",
          "cardId": 2,
          "set": "lea",
          "collectorNumber": "161"
        }
      ]
    }
  ]
}
```

- `header` is everything before the first change set in the `.changes.md` file.
- `sets` holds the change sets newest first (truncated to `--limit`), each `{ timestamp, lines, events }`. `lines` are the raw `- ` lines verbatim. `events` are the set's typed change events from its [`ritual-changes` block](/list-format/#the-changesmd-changelog), one per line, in order, and empty for a legacy entry that has no block. A `trailing` array is present when hand-written text follows the set's change lines (see [Lossless editing](#lossless-editing)). An empty history emits `"sets": []`.

Because `--show` output is meant for scripts, invoking it without a `[listName]` when [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable) is a usage error (exit `2`) rather than a hang. The interactive list picker only runs on a TTY.

`--show` is also the only path available to a script. The editor is interactive from its first screen, so running `history <list>` without `--show` when prompts are unavailable exits `2` (`Input required: the interactive history editor is unavailable …`) instead of rendering prompt UI and exiting `0` having changed nothing. For the same reason `--output json`/`ndjson` requires `--show`.

## The editor

The main menu lists each change set (newest first) as a collapsed row: its timestamp and how many change lines it holds. Start typing to filter the list by timestamp (the global actions stay pinned); the list picker shown when no list name is given is filterable the same way. Selecting a set expands it, printing its lines, and opens a per-set action menu. Below the sets are the global actions.

### Per-set actions

| Action             | Effect                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Delete**         | Removes the selected change set from the log. The cards themselves are **not** removed from the list — only the history entry.                                                                                                                                                                                                                                                                               |
| **Combine**        | Prompts for another change set; the two sets' entries are merged into the selected set (which keeps its original timestamp) and the other set is deleted. Lines are ordered so the older set's changes sit above the newer set's — newest changes always at the bottom — and opposite changes cancel out (see [Combining sets](#combining-sets) below). If the merge cancels everything, the set is dropped. |
| **Edit timestamp** | Replace the set's timestamp. The new value must be a valid ISO-8601 timestamp (e.g. `2026-05-29T12:00:00.000Z`); on save, sets are re-sorted chronologically.                                                                                                                                                                                                                                                |

### Global actions

These appear below the change sets, in the order listed. Undo comes first, since it takes back whatever you just did, and the destructive rewrite sits below the harmless preview.

| Action                          | Effect                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Undo last change**            | Reverts the most recent edit. All edits are kept on an in-memory stack, so you can undo repeatedly back to the loaded state. Offered only once you have made an edit.                                              |
| **Preview changes to be saved** | Summarizes how the saved file will differ: change-set and change-line counts before/after, and the resulting list of sets.                                                                                         |
| **Rewrite with defaults**       | Replaces **all** change sets with a single new set (timestamped now) describing the list exactly as it stands now — every card, plus sections, commander, notes, label overrides, tags, categories, and printings. |
| **Exit**                        | If there are unsaved changes, prompts: **Save and exit**, **Exit without saving**, or **Cancel** (keep editing). Nothing is written to disk until you choose _Save and exit_.                                      |

## Behavior

### List Resolution

`[listName]` is matched case- and accent-insensitively across all list types (exact name first, then a unique substring). A name that exists in more than one type is rejected unless you pin it with a type flag. See [List Names](/list-resolution/).

### Combining sets

When two change sets are combined, their lines are interleaved by age, with the older set's entries on top and the newer set's beneath, so newer changes always end up at the bottom no matter which set you combined into which. The merge then compacts the result the same way the card editor's live change log does. An **add** and a later **remove** of the same card (matching printing, finish, condition, board, and ID) annihilate, as do set/unset-commander and add/remove-section pairs. This is decided on the sets' typed events, never by re-reading the prose. A combine that cancels everything leaves the set empty, so it is dropped.

Lines that survive keep their exact original text, including their `&N` card IDs, and their events. Two well-formed sets combine in lockstep (prose line _i_ with event _i_). A legacy set with no events block can only be combined with another legacy set; the two merge as opaque prose, and nothing cancels. A legacy set is never offered a set that carries a block, and a set whose prose and events are out of step is not offered at all.

### Lossless editing

Apart from combine's compaction, change lines, including their `&N` card IDs, are moved around verbatim, each with its typed event. The editor never re-parses or reformats them. The "rewrite with defaults" action regenerates both the lines and the events from the current list contents and from the list's [`.categories.json` sidecar](/list-format/#categories-namecategoriesjson), the only other file it reads. A sidecar that cannot be read is reported and simply contributes no category events rather than failing the rebuild.

Hand-written text between change sets is preserved too. Non-change lines are attached to the set they follow (shown beneath its change lines, and carried in `--show`'s JSON as the set's `trailing` array), travel with that set through timestamp edits and combines, and are re-emitted on save. Each line is kept as written, indentation included, though blank lines between them are not kept and the block always lands after the set's change lines. Deleting a set deletes its attached text with it, and **Rewrite with defaults** discards every set's attached text along with the sets themselves (the confirmation says how many lines that is). Text before the first set belongs to the header and always survives.

### Only the change log is modified

Every action edits the `.changes.md` file alongside the list. The list's own `.md` file is never edited. Only "rewrite with defaults" reads it, along with the categories sidecar beside it, to describe its current state. The only write outside the changelog is the startup [card-ID backfill](/cli-conventions/#the-card-id-backfill) noted above.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success (saved, discarded, or nothing to save; with `--show`, printed — even an empty history)                                                                                                                                                                            |
| `2`  | Usage error (conflicting type flags, ambiguous list name, `--limit` or `--output json`/`ndjson` without `--show`, or a run needing a prompt when [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable) — the editor, or `--show` without a list name) |
| `3`  | Not found (no matching list, or no lists at all)                                                                                                                                                                                                                          |
