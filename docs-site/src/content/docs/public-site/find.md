---
title: 'Find Cards'
description: Paste a list of card names and see which of them appear in which lists on the site.
---

The **Find** page searches every list on the site for card names you supply. Paste in the names and Find shows which appear in which lists. It is handy for comparing someone else's collection against a list of cards you have or want.

Find is a public-site browsing feature only. There is no CLI or admin-site equivalent, and it never writes anything.

## Searching by name

Open **Find** in the navbar (next to **Trade**). Type or paste card names into the box, **one per line**, and press **Search**. Find loads every list in the [search scope](#choosing-where-to-search) and shows, grouped by source list, which names appear in each. Results use the card **list view**: hovering a row previews the art, foils shimmer, and clicking a row opens the card detail. Each row shows its printing and price.

Matching is by **card name**, ignoring case and accents:

- **Front faces only.** For a double-faced card written as `Front // Back`, only the front is searched. `Bruce Banner` matches `Bruce Banner // The Incredible Hulk`; `The Incredible Hulk` does not.
- **Double-art printings are included.** Some cards have two identical faces. The card cache stores them under the card's own name, but a list line may spell one `Steam Vents // Steam Vents`. A search for `Steam Vents` returns those lines too.

## Choosing where to search

By default a search covers **every** deck, collection, and wanted list. The **Search in** controls between the text box and the **Search** button narrow it:

- Each list type (**Decks**, **Collections**, **Wanted Lists**) has a checkbox that includes or excludes every list of that type. The tally next to the name shows how many of the type's lists are in scope (`3/5`).
- The arrow next to a type expands it to one checkbox **per list**, so you can search just one binder or a few decks. When only some of a type's lists are ticked, the type's checkbox shows a mixed (indeterminate) state; clicking it re-includes the whole type.

The scope applies when you press **Search** or **Add Cards to Search**. Results already on screen stay until your next search replaces them, even if you exclude their list afterwards. Find downloads only the lists it searches, so a narrower scope makes the first search on a large site faster. With every list excluded, the **Search** button is disabled.

## Cards that aren't found

If some names appear in no list, Find:

- leaves **only the unmatched names** in the text box (found names are removed), and
- shows a warning near the top: **"N cards could not be found. The unmatched names remain in the box above."**

Fix a typo or try another spelling, then search again.

## Adding to a search

After your first search, an **Add Cards to Search** button appears next to **Search**. It searches the names in the box and **merges** the matches into the results already shown. Pressing **Search** instead starts a fresh search.

## Selecting results

Results are multi-selectable, but these picks are **local to the Find page**. They do not join the global cross-list selection used elsewhere. Tick a row's checkbox (or Ctrl/Cmd-click the row), or use the checkbox in a source-list heading to **toggle every card from that list**.

An action bar above the results holds buttons that are disabled until you select something:

- **Select All** selects every card in the current results.
- **Add Selected to Trade** adds the selected cards to the active [trade](/public-site/trade/), each keeping its source list. Collection and deck cards go to the left column, wanted cards to the right. Name-only cards prompt for a printing.
- **View Selected as List** opens the selected cards as a list named **Search Results**, using the [Combined List view](/public-site/combined-view/). You get the full toolbar (grouping, sorting, filtering, multi-select, and **Add to Trade**) over just the cards you picked, each still carrying its source list.
- **Clear Selection** clears the page-local selection.
