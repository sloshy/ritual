---
title: 'Find Cards'
---

The **Find** page lets you search every list on a public site for a list of cards of your own. Paste in the names of the cards you're looking for and Find shows which of them appear in which lists — handy when you're browsing someone else's collection and want to compare it against a list of cards you have or want.

There is no CLI or admin-site equivalent; Find is a public-site browsing feature only and never writes anything.

## Searching by name

Open the **Find** link in the navbar (next to **Trade**). Paste or type card names into the box — **one card per line** — and press **Search**. Find loads every deck, collection, and wanted list and shows, grouped by source list, which of your names appear in each. Results are rendered as a card **list view**: hovering a row previews the card art, foils shimmer, and clicking a row opens the full card detail. Each row also shows its printing and price.

Matching is by **card name**, case- and accent-insensitive:

- **Front faces only.** For a double-faced card written as `Front // Back`, only the front side is searched — everything from the `//` onward is ignored. Searching `Bruce Banner` matches `Bruce Banner // The Incredible Hulk`; searching `The Incredible Hulk` does not.
- **Double-art printings are included.** Some cards are printed with two identical faces, e.g. `Steam Vents // Steam Vents`. A search for `Steam Vents` returns both the normal printings and those double-faced printings.

## Cards that aren't found

If any of your names don't appear in any list, Find:

- leaves **only the unmatched names** in the text box (the found ones are removed), and
- shows a warning near the top reading **"N cards could not be found. The unmatched names remain in the box above."**

This makes it easy to refine the leftover names — fix a typo, try an alternate spelling — and search again.

## Adding to a search

After your first search, an **Add Cards to Search** button appears next to **Search**. It searches the names currently in the box and **merges** the matches into the results already shown, rather than replacing them. Type more names, press it, and the new finds are added to the existing groups. (Pressing **Search** again instead starts a fresh search.)

## Selecting results

Results are multi-selectable, but these picks are **local to the Find page** — they do not join the global cross-list selection used elsewhere on the site. Tick the checkbox on any row (or Ctrl/Cmd-click the row), or use the checkbox in a source-list heading to **toggle every card from that list** at once.

An action bar sits above the results (its buttons are disabled until you select something):

- **Select All** — selects every card in the current results.
- **Add Selected to Trade** — adds every selected card to the active [trade](/public-site/combined-view/), each carrying its original source list (collection/deck cards go to the left side, wanted cards to the right). Name-only cards prompt for a printing, just like elsewhere.
- **View Selected as List** — opens the selected cards as a synthetic list named **Search Results**, using the same [Combined List view](/public-site/combined-view/). This gives you the full toolbar — grouping, sorting, filtering, multi-select, and **Add to Trade** — over just the cards you picked, each still carrying its original source list.
- **Clear Selection** — clears the page-local selection.
