---
title: 'Combined List View'
description: Browse the cards from several lists at once as one synthetic list.
---

The **Combined List** view shows the cards from several lists as one list. From any deck, collection, or wanted list, you can pull in any combination of your other lists and view them together. Use it to see everything you own and want side by side, compare decks, or check a card's presence across lists.

The combined view is a public-site browsing feature only. There is no CLI or admin-site equivalent, and it never writes anything.

## Combining lists

Every single-list page has a **Combine with list…** button in the upper-right header. It opens a dialog of your _other_ lists, each showing:

- the list **name**,
- its **type** (deck, collection, or wanted list),
- its number of **card copies**, and
- its **price total** in the active currency.

The **Sort** dropdown orders the lists by name, card count, or type. Tick any combination, then press **View**. The list you started from is always included.

### The "All lists" switch

**All lists** selects every list at once and disables the individual checkboxes. The header of an all-lists view reads **"Viewing all cards from all lists"** instead of naming each list.

### Shortcuts: the "All" link and "View all" buttons

You can also reach a combined view directly:

- The navbar's **All** link (between **Wanted** and **Trade**) opens the every-list view, the same as ticking **All lists**. The link is highlighted while you're on that view.
- The **Decks** and **Wanted Lists** home tabs each have a **View all decks** / **View all wanted lists** button that opens a combined view of that one type. Each has its own URL (`#/combined?all=deck`, `?all=wanted`), and the matching navbar tab stays highlighted.
- The **Collections** tab has a **View all…** dropdown instead, because collections support label filtering. Its first entry, **View all collections**, opens the plain all-collections view (`#/combined?all=collection`). The other entries (**View all for sale / for trade / for sale or trade / to keep / all proxies**) open the same view with the [Labels filter](/public-site/filtering/#available-filters) pre-set, for example `#/combined?all=collection&labels=sale,trade`.

## How the combined view behaves

The combined list is titled **Combined List**. Below the card count and price total it names the lists being combined, each a link back to that list, or reads "Viewing all cards from all lists" (for **All**) or "Viewing all decks/collections/wanted lists" (for a single-type **View all…**).

Because the view can mix list types, it uses the rules every type can follow:

- **Cards are never merged.** Decks normally collapse copies onto one line, but collections and wanted lists keep each card separate, so the combined view does too. A deck entry keeps its own per-line quantity.
- **Sections are preserved**, but a deck's special sections lose their special treatment. There is no commander pinning, no sideboard-at-the-bottom, and **no "extras" to hide**. A deck's mainboard, sideboard, maybeboard, and token sections are all ordinary sections.
- **Grouping and sorting** offer the options common to every combined list type, plus a **Source List** grouping (by the list a card came from) and, in [sell mode](/public-site/sell/), the buylist groupings and sorts. The **Printing** grouping is offered only when no collection is in the combination, since collection cards are always pinned to a printing.
- **Categories are not offered here.** The **Category** and **Categories** groupings, the **Category** sort, and the **Categories** filter row are single-list features, because each list has its own category vocabulary and order.

## Selecting and trading

The combined view supports the same multi-select as single lists. Selected cards join the global selection (see the navbar's **All Selected** menu), and the toolbar's selection menu lets you copy the selection as text or CSV and **Add to Trade**. Each card keeps its original list's identity, so trades and removals target the right source list.

Adding a collection card labeled **To keep** to a trade asks for a one-time confirmation ("marked To keep — add anyway?"). Confirming remembers the acknowledgement in the browser so it never asks again; cancelling leaves the reminder for next time. Either way, a keep-labeled card's row on the Trade page always carries a **KEEP** tag beside its source tag, and a trade restored from a shared URL shows the tag without asking again.
