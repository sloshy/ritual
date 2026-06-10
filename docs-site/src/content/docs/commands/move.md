---
title: 'move'
---

Interactively move cards between decks, collections, and wanted lists.

## Usage

```bash
./ritual move
```

## Overview

The `move` command launches an interactive session that lets you search across all your lists, select cards to relocate, and commit the changes in a batch. Changes are recorded in the source and destination changelog files, and only written to disk when you confirm.

Key behaviors:

- **Deck moves**: Moving a card from a deck decrements its quantity by 1. The line is removed when quantity reaches 0.
- **Note preservation**: Notes (`{note}`) on deck, collection, and wanted list entries are carried over to the destination list.
- **Name-only wanted entries**: If a card has no set/collector number (i.e., it is a name-only wanted list entry) and the destination requires a printing (e.g., a collection), you will be prompted to resolve a printing before the move is queued.
- **Single destination**: If only one valid destination is configured, the destination prompt is skipped and the card is queued immediately.
- **Change tracking**: Source files receive a `Moved … to …` changelog entry. Destination files receive a `Moved … from …` changelog entry.

## Interactive Flow

When launched, the tool shows an autocomplete search field. You can type a card name to search, or select from the menu:

| Option                         | Description                                                  |
| ------------------------------ | ------------------------------------------------------------ |
| `⚙️ Configure Session Filters` | Restrict which lists are eligible as sources or destinations |
| `📋 View Pending Changes (N)`  | Preview queued moves before committing                       |
| `✅ Done — Save N move(s)`     | Commit all pending moves and exit                            |
| `🚪 Exit Without Saving`       | Exit without writing any changes                             |

After searching, select a card and choose a destination (or confirm the single available one). The destination prompt is also an autocomplete field — type to filter the list of destinations instead of scrolling with the arrow keys. The move is queued as a pending change. You can queue multiple moves before committing.

Foil and etched cards are flagged in the search results, the pending-changes view, and the queued-move confirmation (e.g. `Lightning Bolt (LEA:161) [Foil]`). Normal non-foil printings are shown without a finish tag.

Pressing Escape shows a confirmation prompt if there are pending moves.

## Session Filters

Select **Configure Session Filters** to open the filter dialog. You can independently configure:

- **Move FROM** — which lists are valid sources
- **Move TO** — which lists are valid destinations

Inside each filter view, you can toggle lists by category (Decks, Collections, Wanted Lists) or individually:

```
[X] Decks (3/3)
[~] Collections (1/2)
[ ] Wanted Lists (0/1)
── Toggle All ON ──
── Toggle All OFF ──
← Done
```

The bracket indicator shows:

- `[X]` — all lists in this category are enabled
- `[~]` — some lists in this category are enabled
- `[ ]` — no lists in this category are enabled

At least one destination must remain enabled at all times.

## Chained Moves

If you move a card and then try to move the same card again (e.g., from B to C after already queuing A → B), the tool updates the pending move to reflect the final destination. Only the original source and the final destination are written to; intermediate lists are never touched.

For example, if you queue:

1. Sol Ring: Deck A → Collection B
2. Sol Ring: Collection B → Wanted C

The committed result is: Sol Ring removed from Deck A and added to Wanted C. Collection B is unchanged. Changelogs reflect `Deck A → Wanted C`.

## Changelog Format

Card names are written quoted so the name is unambiguously separated from trailing
annotations.

Source list changelog (`.changes.md`):

```
- Moved "Lightning Bolt" (LEA:161) [foil] &5 to Collection 'Red Binder'
```

Destination list changelog:

```
- Moved "Lightning Bolt" (LEA:161) [foil] &5 from Deck 'Ghyrson Starn Spellslinger'
```
