---
title: 'Move Cards'
---

The **Move Cards** page moves cards between decks, collections, and wanted lists from the browser. It mirrors the CLI [`move`](/commands/move/) command — every move is staged in memory and nothing is written until you save — but presents a web-native UI built around the same standard list view used by the public site and the editors.

## Finding cards

There are two ways to surface the cards you want to move:

- **Browse a list** — Choose a deck, collection, or wanted list from the **Browse list** dropdown to view it in the standard list/grid view (the same one the public site uses, minus the editing controls), complete with the usual toolbar, sections, and view modes.
- **Search by name** — Type a card name into the **Search cards** box to find matching cards across every enabled source list. What you type is split on whitespace and every term must appear in the card name, in any order (`in tre` finds "In the Trenches"), ignoring case, accents, and punctuation — the same matching the [editors](/admin/editors/#step-1-search) and the CLI prompts use — with the closest matches first. Results are grouped per list and tagged with their source; hovering a result shows the card-image preview, and clicking anywhere on the row opens its destination menu.

## Moving a card

Each card shows a single rightward-arrow button (**→**) in place of the editor's edit controls. Hovering it shows a **Move To…** tooltip. Clicking it opens a menu of destination lists, grouped by type, excluding the card's current list and any lists disabled in [Filters](#filters).

- **Choosing a destination** queues the move. When more than one copy of the card is available to move (a deck entry with quantity > 1, a grouped collection tile, or several identical entries), a prompt asks how many copies to move.
- **Moving a printing-less card into a collection** — Collections require a specific printing. When a card without one (for example a name-only wanted-list entry) is moved into a collection, a printing picker opens so you can choose the exact set and collector number first.

Queued moves are reflected immediately in the list view: a card moved away disappears from its source list and appears under its destination when you browse there. Re-moving a card that is already queued updates its destination (a move chain `A → B → C` collapses to `A → C`); moving it back to its original list cancels the queued move.

## Switching lists in a session

Unlike the editor pages — which discard unsaved changes when you switch files — the Move Cards page keeps **all** queued moves in memory as you browse between lists. You can move cards out of several lists and into several others before committing, exactly like the CLI `move` command.

## Filters

The **Filters** toggle expands a panel for restricting which lists participate in the session, mirroring the CLI's session filters:

- **From** — which lists are browsed and searched as sources.
- **To** — which lists are offered as move destinations.

All lists are enabled by default. Selections persist across reloads in `localStorage` under `ritual:admin:move:disabled-sources` and `ritual:admin:move:disabled-dests`.

## Pending moves & saving

- **Pending** opens a dialog listing every queued move (`from → to`), with a badge showing the count. Individual moves can be removed, or all discarded at once.
- **Save Moves** commits every queued move atomically. Each source list records a `Moved … to …` changelog entry and each destination a `Moved … from …` entry, matching the CLI. Intermediate lists in a move chain are never touched.
- **Discard** clears all queued moves without writing anything.

Saving rebuilds the move state from disk, so any move whose card can no longer be found (for example because the underlying file changed) is skipped and reported rather than failing the whole batch.

:::note
Moves are written directly to the list files (and their changelogs). When git auto-commit is enabled in the admin config, the whole batch is recorded in a single commit (`Move N cards`), the same as the editor save endpoints.
:::
