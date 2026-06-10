---
title: 'Change History'
---

The **Change History** page compacts and rewrites the change log (`.changes.md`) of a deck, collection, or wanted list from the browser. It mirrors the CLI [`history`](/commands/history/) command — every edit is staged in memory and nothing is written until you save — and, like the command, it **only ever touches the change log**: the list's own `.md` file is never modified.

## Choosing a list

Pick a deck, collection, or wanted list from the **Edit history for** dropdown (grouped by type). Its change sets load newest-first, each shown as a collapsed row with its timestamp and how many change lines it holds. Click a row to expand it and read the individual change lines.

Switching to another list (or leaving the page) while you have unsaved edits prompts you to discard them first.

## Per-set actions

Each change-set row has three actions:

| Action        | Effect                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Combine**   | Opens a picker of the other change sets; the chosen set's entries are merged into this one and the chosen set is deleted. This set keeps its own timestamp. Disabled when the log holds only one change set. |
| **Edit time** | Replaces the set's timestamp. The new value must be a valid ISO-8601 timestamp (e.g. `2026-05-29T12:00:00.000Z`); on save, sets are re-sorted chronologically.                                               |
| **Delete**    | Removes the change set from the log. The cards themselves are **not** removed from the list — only the history entry. Use **Undo** if you delete the wrong one.                                              |

## Global actions

| Action                    | Effect                                                                                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rewrite with defaults** | After a confirmation, replaces **all** change sets with a single new set (timestamped now) describing the list exactly as it stands now — every card, plus sections, commander, notes, and printings. Disabled when the list has no parseable content (an empty list, or a file that can't be read). |
| **Undo**                  | Reverts the most recent edit. Edits are kept on an in-memory stack, so you can undo repeatedly back to the loaded state. The badge shows how many undo steps are available.                                                                                                                          |
| **Save**                  | Writes the edited change sets to the `.changes.md` file. Enabled only when there are unsaved changes.                                                                                                                                                                                                |
| **Discard**               | Reverts every edit back to the change log as it was loaded.                                                                                                                                                                                                                                          |

A summary line above the sets shows how the saved file will differ from what was loaded: the change-set and change-line counts before → after.

## Lossless editing

Change lines — including their internal card IDs — are moved around verbatim; the editor never re-parses or reformats them. The **Rewrite with defaults** action is the one exception, since it regenerates lines from the current list contents.

:::note
Only the `.changes.md` file is written. When git auto-commit is enabled in the admin config, the save is recorded in a single commit (`Rewrite change history for <list>`), the same as the editor and move endpoints.
:::
