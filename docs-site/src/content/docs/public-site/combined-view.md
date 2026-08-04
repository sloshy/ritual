---
title: 'Combined List View'
---

The **Combined List** view lets you browse the cards from several lists at once as a single, synthetic list. From any deck, collection, or wanted list on the public site, you can pull in any combination of your other lists and view them together — useful for seeing everything you own and want side by side, comparing decks, or checking a card's presence across lists.

There is no CLI or admin-site equivalent; the combined view is a public-site browsing feature only and never writes anything.

## Combining lists

Every single-list view (deck, collection, or wanted list) shows a **Combine with list…** button in the upper-right header. Clicking it opens a dialog that lists all of your _other_ lists, each showing:

- the list **name**,
- its **type** (deck, collection, or wanted list),
- the number of **card copies** it contains, and
- its **price total** in the active currency.

Use the **Sort** dropdown to order the lists by name, card count, or type. Tick any combination of lists, then press **View** to open the combined view — the list you started from is always included.

### The "All lists" switch

Toggling **All lists** selects every list at once (the individual checkboxes are disabled while it is on). When you view an all-lists combination, the header simply reads **"Viewing all cards from all lists"** rather than enumerating each one.

### Shortcuts: "All", "View all", and "Labels" buttons

You don't have to start from the combine dialog:

- The navbar's **All** link (between **Wanted** and **Trade**) jumps straight to the every-list combined view — the same as ticking **All lists**. The **All** link is highlighted while you're on that view.
- Each list-index tab (**Decks**, **Collections**, **Wanted Lists**) has a **View all…** button that opens a combined view of just that one type — every deck, every collection, or every wanted list. Each has its own URL (`#/combined?all=deck`, `?all=collection`, `?all=wanted`), and the matching navbar tab stays highlighted while you're viewing it.
- The **Collections** tab additionally has a **Labels** dropdown (**View all for sale / for trade / for sale or trade / to keep**) that opens the all-collections view with the [Labels filter](/public-site/filtering/#available-filters) pre-set — e.g. `#/combined?all=collection&labels=sale,trade`.

## How the combined view behaves

The combined list is titled **Combined List**. Below the card count and price total it names the lists being combined — each name is a link back to that individual list — or shows "Viewing all cards from all lists" (for **All**) or "Viewing all decks/collections/wanted lists" (for a single-type **View all…**).

Viewing rules are applied in a **lowest-common-denominator** fashion across the combined list types:

- **Cards are never merged.** Decks normally collapse copies onto one line, but because collections and wanted lists keep each card separate, the combined view does too: every entry stands on its own. (A deck entry keeps its own per-line quantity.)
- **Sections are preserved**, but a deck's special sections lose their special treatment — there is no commander pinning, no sideboard-at-the-bottom, and **no "extras" to hide**. A deck's mainboard, sideboard, maybeboard, and token sections all appear as ordinary sections.
- **Grouping and sorting** offer the options common to every combined list type, plus a new **Source List** grouping that groups cards by the list they came from. The **Printing** grouping is offered only when no collection is part of the combination (collection cards are always pinned to a specific printing, so the distinction is moot once one is mixed in).

## Selecting and trading

The combined view supports the same multi-select as individual lists. Selecting cards adds them to the global selection (visible in the navbar's **All Selected** menu), and the toolbar's selection menu lets you copy the selection as text or CSV and **Add to Trade** — each card carries its original list's identity, so trades and removals target the correct source list.

Adding a collection card labeled **To keep** to a trade asks for a one-time confirmation ("marked To keep — add anyway?"); confirming remembers the acknowledgement in the browser so it never asks again, while cancelling leaves the reminder in place for next time. Whether or not the dialog has been acknowledged, a keep-labeled card's row on the Trade page always carries an explicit **KEEP** tag beside its source tag — and a trade restored from a shared URL shows the tag without re-prompting.
