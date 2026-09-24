---
title: 'Change History'
description: Compact and rewrite a list's change log from the browser.
---

The **Change History** page edits the change log (`.changes.md`) of a deck, collection, or wanted list. It mirrors the CLI [`history`](/commands/history/) command. Every edit is held in memory until you save, and saving **only ever writes the change log**. The list's own `.md` file is never modified.

## Choosing a list

Pick a list from the **Edit history for** dropdown (grouped by type). Its change sets load newest-first. Each is a collapsed row showing its timestamp and how many change lines it holds; click a row to expand it and read the lines.

Switching to another list or leaving the page with unsaved edits asks you to discard them first.

## Per-set actions

Each change-set row has three actions:

| Action        | Effect                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| **Combine**   | Pick another change set to merge into this one. This set keeps its timestamp; the chosen set is deleted. |
| **Edit time** | Replace the set's timestamp with a valid ISO-8601 value (e.g. `2026-05-29T12:00:00.000Z`).               |
| **Delete**    | Remove the change set from the log. The cards themselves stay in the list; only the history entry goes.  |

Notes:

- **Combine** is disabled when the log holds only one change set. How lines are merged is described under [Combining sets](#combining-sets).
- After **Edit time**, sets are re-sorted chronologically on save.
- Deleted the wrong set? Use **Undo**.

## Global actions

| Action                    | Effect                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Rewrite with defaults** | After a confirmation, replaces **all** change sets with one new set (timestamped now) describing the list as it stands. |
| **Undo**                  | Reverts the most recent edit. The badge shows how many undo steps are available.                                        |
| **Save**                  | Writes the edited change sets to the `.changes.md` file. Enabled only when there are unsaved changes.                   |
| **Discard**               | Reverts every edit back to the change log as it was loaded.                                                             |

Notes:

- The rewrite covers every card plus sections, commander, notes, label overrides, tags, and printings. It is disabled when the list has no parseable content (an empty list, or a file that cannot be read).
- Undo steps are kept in memory until you save, discard, or switch lists, so you can undo repeatedly back to the loaded (or last saved) state.

A summary line above the sets shows how the saved file will differ from what was loaded: change-set and change-line counts before → after.

## Combining sets

When two change sets are combined, their lines are interleaved by age: the older set's entries on top, the newer set's beneath. Newer changes always end up at the bottom no matter which set you combined into which.

The merge then compacts the result the same way the card editor's live change log does. An **add** and a later **remove** of the same card (matching printing, finish, condition, board, and ID) cancel out, as do set/unset-commander and add/remove-section pairs. A combine that cancels everything leaves the set empty, so the set is dropped. Lines that survive keep their exact original text, including their internal card IDs.

## Lossless editing

Apart from combine's compaction, change lines are moved around verbatim, each with the typed event from its entry's [`ritual-changes` block](/list-format/#the-changesmd-changelog). The editor never re-parses or reformats them.

A legacy entry with no block is carried as-is. It can be combined only with another legacy entry (merged as opaque prose; nothing cancels). It is never offered an entry that carries a block, nor an entry whose prose and events disagree.

Hand-written text between change sets is preserved too. It stays attached to the set it follows (shown beneath that set's change lines when expanded), travels with that set through edits, and is written back on save after the set's change lines, each line as written. Deleting a set deletes its attached text. **Rewrite with defaults** discards every set's attached text along with the sets it replaces, and regenerates lines from the current list contents.

:::note
Only the `.changes.md` file is written. When git auto-commit is enabled, the save is recorded in a single commit (`Rewrite change history for <list>`), the same as the editor and move endpoints.
:::
