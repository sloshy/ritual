---
title: 'Change History'
description: Compact and rewrite a list's change log from the browser.
---

The **Change History** page compacts and rewrites the change log (`.changes.md`) of a deck, collection, or wanted list from the browser. It mirrors the CLI [`history`](/commands/history/) command. Every edit is staged in memory and nothing is written until you save, and, like the command, it **only ever touches the change log**. The list's own `.md` file is never modified.

## Choosing a list

Pick a deck, collection, or wanted list from the **Edit history for** dropdown (grouped by type). Its change sets load newest-first, each shown as a collapsed row with its timestamp and how many change lines it holds. Click a row to expand it and read the individual change lines.

Switching to another list (or leaving the page) while you have unsaved edits prompts you to discard them first.

## Per-set actions

Each change-set row has three actions:

| Action        | Effect                                                                                                                                                                                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Combine**   | Opens a picker of the other change sets; the two sets' entries are merged into this one (which keeps its own timestamp) and the chosen set is deleted. Lines are ordered oldest-set-first (newest changes at the bottom) and opposite changes cancel out — see [Combining sets](#combining-sets). Disabled when the log holds only one change set. |
| **Edit time** | Replaces the set's timestamp. The new value must be a valid ISO-8601 timestamp (e.g. `2026-05-29T12:00:00.000Z`); on save, sets are re-sorted chronologically.                                                                                                                                                                                     |
| **Delete**    | Removes the change set from the log. The cards themselves are **not** removed from the list — only the history entry. Use **Undo** if you delete the wrong one.                                                                                                                                                                                    |

## Global actions

| Action                    | Effect                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rewrite with defaults** | After a confirmation, replaces **all** change sets with a single new set (timestamped now) describing the list exactly as it stands now — every card, plus sections, commander, notes, label overrides, tags, and printings. Disabled when the list has no parseable content (an empty list, or a file that can't be read). |
| **Undo**                  | Reverts the most recent edit. Edits are kept on an in-memory stack, so you can undo repeatedly back to the loaded state. The badge shows how many undo steps are available.                                                                                                                                                 |
| **Save**                  | Writes the edited change sets to the `.changes.md` file. Enabled only when there are unsaved changes.                                                                                                                                                                                                                       |
| **Discard**               | Reverts every edit back to the change log as it was loaded.                                                                                                                                                                                                                                                                 |

A summary line above the sets shows how the saved file will differ from what was loaded: the change-set and change-line counts before → after.

## Combining sets

When two change sets are combined, their lines are interleaved by age, with the older set's entries on top and the newer set's beneath, so newer changes always end up at the bottom no matter which set you combined into which. The merge then compacts the result the same way the card editor's live change log does. An **add** and a later **remove** of the same card (matching printing, finish, condition, board, and ID) annihilate, as do set/unset-commander and add/remove-section pairs. A combine that cancels everything leaves the set empty, so it is dropped. Lines that survive keep their exact original text, including their internal card IDs.

## Lossless editing

Apart from combine's compaction, change lines, including their internal card IDs, are moved around verbatim, each with the typed event from its entry's [`ritual-changes` block](/list-format/#the-changesmd-changelog). The editor never re-parses or reformats them. A legacy entry that has no block is carried as-is. It can be combined only with another legacy entry (merged as opaque prose, nothing cancels) and is never offered an entry that carries a block, nor is an entry whose prose and events are out of step.

Hand-written text between change sets is preserved as well. It stays attached to the set it follows (shown beneath its change lines when a set is expanded), travels with that set through edits, and is re-emitted on save with each line kept as written, always after the set's change lines. Deleting a set deletes its attached text with it, and **Rewrite with defaults** discards every set's attached text along with the sets it replaces. The rewrite otherwise regenerates lines from the current list contents.

:::note
Only the `.changes.md` file is written. When git auto-commit is enabled in the admin config, the save is recorded in a single commit (`Rewrite change history for <list>`), the same as the editor and move endpoints.
:::
