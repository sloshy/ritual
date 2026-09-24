---
title: 'Trade Planner'
description: Plan a trade from the cards on the site, with printing pickers, live price updates, and shareable links.
---

The **Trade Planner** (the **Trade** link in the navbar, at `#/trade`) lays out a trade in two columns: the cards you offer on the left, the cards the other party offers on the right, with a price total under each. It runs entirely in the browser. Nothing persists across page refreshes, but a trade can be shared by URL.

## Left Column — My Cards

The left column holds cards you are offering. It searches the collections on the site. An **Include Decks in Search** toggle (off by default) adds cards from your decks.

- Type a card name to get autocomplete suggestions showing the card name and source list.
- Results are deduplicated per source. A card in several collections appears once per collection.
- Each card shows a thumbnail, name, set code and collector number (with a language badge for a non-English copy, `2XM:270 · JA`), finish, condition, and price.
- Selecting a deck card with no pinned printing opens the printing picker. The deck source is kept on the resulting row.
- Sort by card name or price, each with its own ascending/descending toggle.
- A card with no price by rule (a [proxy](/public-site/prices/#cards-priced-at-zero), or a card with [custom art](/custom-art/)) shows **PROXY** / **CUSTOM** in place of its price and counts as $0 in the column total and the balance.
- The price total is at the bottom of the column.

**Quantity caps:** each row's quantity stepper caps at the number of that exact variant available in its source. For a collection, that is the count of identical note-less entries (same name, set, collector number, finish, condition). For a deck, it is the sum of that printing across mainboard, sideboard, and other sections. When only one copy exists, the stepper is hidden and a fixed quantity of 1 is shown.

**Editing picker-sourced rows:** rows added through the printing picker (everything on the right, and deck cards without a pinned printing on the left) have a small yellow pencil button left of the quantity controls. It re-opens the picker for that card, and choosing a printing replaces the row in place, keeping its quantity.

## Right Column — Their Cards

The right column holds cards the other party is offering. What it searches depends on whether the site has a [live backend](/public-site/hosted/).

- **Static site, wanted list mode (default):** searches every wanted list on the site. Results show the card name and source wanted list. Cards no wanted list holds are reachable only through the **Search Scryfall instead** toggle.
- **Static site, Scryfall mode:** with the toggle on, autocomplete calls the Scryfall API from the browser and shows only Scryfall's results.
- **Hosted site:** with `serve --api` behind the site, the server's card cache covers every card, so the toggle is replaced by a note. Each query searches your wanted lists **and** the cache at once. Wanted-list matches come first (with source, printing, and price), followed by cache matches labelled "Card cache". No request goes to Scryfall.

**Every right-column selection opens the printing picker.** A wanted list records the printing you'd _like_, not the one on offer, so picking a wanted card never assumes its printing. The printings your wanted lists ask for (across every list, for that name) float to the top badged **Wanted**, and you choose what's actually on the table. The row keeps its wanted-list source and quantity cap whichever printing you take.

The picker shows all printings, 8 per page, with a set-code / collector-number filter using the CLI's [collector mode](/commands/edit/#collector-number-mode) grammar: `mkm` matches set codes as a substring, a bare `12` also matches collector numbers as a prefix, and `ds 12`, `12 ds`, or `mkm:123` requires both halves. Term order never matters. Typing anywhere in the dialog feeds the filter box without focusing it (tap the box to type on a touch device). **Backspace** erases, and **Esc** clears the query before a second **Esc** closes the picker. Hovering an entry shows the full card art. Choose a printing and finish, then click **Add to Trade**.

Non-English printings carry the same language badge as trade rows (`2XM:270 · JA`). Confirming a printing that exists **only** in a non-English language pauses on a notice, `This printing is only available in Japanese (ja) — it will be recorded as [ja].`, with **Continue** to accept the language and **Back** to return to the list. Shared trade URLs preserve each row's language.

Rows added from a bare card name belong to no list of yours. They are tagged with the backend that answered the lookup (**Cache** on a hosted site, **Scryfall** on a static one) and encoded in the trade URL by Scryfall ID.

## Update Prices

The toolbar's **Update prices** button refetches prices for the cards on the trade page (only those) and updates each row's price and finish in place. A toast reports how many cards were updated. On a static site it batches requests through Scryfall's `/cards/collection` endpoint, 75 IDs per request. On a site with a [live API](/public-site/hosted/) it uses the backend's batch price endpoint, which also updates the server's shared card cache.

## Card Hover Previews

Hovering a card thumbnail in the trade list, autocomplete suggestions, or printing picker shows an enlarged preview of the card art that follows the cursor.

## Mobile Layout

On narrow screens (≤768px), the two columns collapse into a single pane. Tab buttons at the top switch between **My Cards** and **Their Cards**. Each pane fills the screen width with its own search, sort controls, card list, and price total.
