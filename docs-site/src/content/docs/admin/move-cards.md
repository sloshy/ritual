---
title: 'Move Cards'
description: Move cards between decks, collections, and wanted lists from the browser, staging many moves and saving them at once.
---

The **Move Cards** page moves cards between decks, collections, and wanted lists. It mirrors the CLI [`move`](/commands/move/) command: every move is queued in memory and nothing is written until you save. The page uses the same list view as the public site and the editors.

## Finding cards

There are two ways to find the cards you want to move:

- **Browse a list.** Choose a list from the **Browse list** dropdown to view it in the standard list/grid view, with the usual toolbar, sections, and view modes but no editing controls. The toolbar's **Filters** dropdown includes the [share filters](/public-site/filtering/#filtering-against-other-lists) (**Shares Cards With** / **Doesn't Share Cards With**). These compare against the **saved** files, so queued but unsaved moves don't count. They are separate from this page's own [Filters](#filters) panel, which picks the session's From/To lists.
- **Search by name.** Type into the **Search cards** box to search every enabled source list. Your text is split on whitespace and every term must appear in the card name, in any order, ignoring case, accents, and punctuation (`in tre` finds "In the Trenches"). Closest matches come first. This is the same matching the [editors](/admin/editors/#step-1-search) and the CLI prompts use. Results are grouped per list and tagged with their source. Hover a result for the card-image preview; click anywhere on the row to open its destination menu.

When [sell mode](/public-site/sell/) is enabled, the toolbar's **Sell mode** toggle works here too, so you can pick out what a buyer will take before moving it. Sell mode is off by default; turn it on with the **Offer sell mode** checkbox on the [Settings](/admin/dashboard/#settings) page (`site.sellMode`) or with [`ritual admin --sell-mode`](/commands/admin/#sell-mode).

## Moving a card

Each card shows a single arrow button (**→**) where the editor's edit controls would be. Hovering it shows a **Move To…** tooltip. Clicking it opens a menu of destination lists, grouped by type. The card's current list and any lists disabled in [Filters](#filters) are left out.

- **Choosing a destination** queues the move. When more than one copy is available (a deck entry with quantity > 1, a grouped collection tile, or several identical entries), a prompt asks how many copies to move.
- **Moving a card with no printing into a collection.** Collections require a specific printing. Moving a card without one (for example a name-only wanted-list entry) into a collection opens a printing picker so you can choose the set and collector number first.
- **Deck sections.** The CLI session asks which section a card lands in. Here a deck destination always uses the deck's default section: the first that is neither the commander nor the sideboard.

Queued moves show in the list view immediately. A moved card disappears from its source list and appears under its destination when you browse there. Moving an already-queued card again updates its destination (a chain `A → B → C` collapses to `A → C`). Moving it back to its original list cancels the queued move.

## Switching lists in a session

The editor pages discard unsaved changes when you switch files. The Move Cards page does not: **all** queued moves stay in memory as you browse between lists, so you can move cards out of several lists and into several others before saving, exactly like the CLI `move` command.

## Filters

The **Filters** toggle expands a panel that restricts which lists take part in the session, mirroring the CLI's session filters:

- **From**: which lists are browsed and searched as sources.
- **To**: which lists are offered as destinations.

All lists are enabled by default. Your selections persist across reloads in `localStorage` under `ritual:admin:move:disabled-sources` and `ritual:admin:move:disabled-dests`.

## Pending moves & saving

- **Pending** opens a dialog listing every queued move (`from → to`); its badge shows the count. You can remove individual moves or discard them all.
- **Save Moves** commits every queued move atomically. Each source list records a `Moved … to …` changelog entry and each destination a `Moved … from …` entry, matching the CLI. Intermediate lists in a move chain are never touched.
- **Discard** clears all queued moves without writing anything.

Queued moves live on this page until you save them, so leaving discards them. Navigating away with moves queued (a sidebar item, a dashboard card, the browser's back or forward button) asks for confirmation first. Reloading or closing the tab raises the browser's own "leave site?" prompt.

Saving rebuilds the move state from disk. A move whose card can no longer be found (because the file changed underneath, for example) is skipped and reported rather than failing the whole batch.

:::note
Moves are written directly to the list files and their changelogs. When git auto-commit is enabled, the whole batch is recorded in a single commit (`Move N cards`), the same as the editor save endpoints.
:::
