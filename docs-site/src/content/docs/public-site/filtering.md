---
title: 'Filtering Cards'
---

Every list view on the public site — decks, collections, wanted lists, and the [Combined List view](/public-site/combined-view/) — has a **Filters** button in the toolbar. It opens a dropdown of filters (a [bottom sheet on touch devices](/public-site/mobile/)) that narrow the cards shown without changing the underlying list. The button shows a badge with the number of active filters, and a **Clear all filters** action resets them. Filters are applied together: a card must pass every active filter to be shown.

## Available filters

- **Hide Lands** — hides lands (cards whose type line includes _Land_, with mana value 0).
- **Hide Unpriced** — hides cards with no price in the active currency.
- **Hide Extras** — _(deck pages only)_ hides the maybeboard and token sections.
- **Name** — space-separated terms; every term must appear in the card name, case- and accent-insensitively, in any order.
- **Color Identity** — pick any of the five colors. **Exclusive** matches cards whose identity is exactly the selected colors; **Inclusive** matches any card playable in a deck of those colors (its identity is a subset of the selection).
- **Sets** — a tag input of set codes. Type a code and press space, comma, or Enter to add it; autocomplete suggests the set codes present in the current list. Cards are kept if their printing is from any selected set.

All tag inputs (Sets, Card Type, Oracle Tags, and Art Tags) share the same autocomplete behavior: as you type, a suggestion list appears. Use the **↑/↓ arrow keys** to move through it and **Enter** to add the highlighted suggestion; with nothing highlighted, Enter adds whatever you've typed. You can also click a suggestion, and **Backspace** on an empty input removes the last tag.

- **Card Type** — a tag input of card types and subtypes (see below).
- **Oracle Tags** / **Art Tags** — tag inputs backed by [Scryfall Tagger](https://tagger.scryfall.com/) data (see below).
- **Mana Value** — pick a comparison operator (`=`, `<`, `≤`, `>`, `≥`) from the toggle buttons and type a value to compare against the card's mana value.
- **Price** — a comparison (`=`, `<`, `≤`, `>`, `≥`) against the card's price in the currency chosen by the header **Prices** selector. Pick the operator from the toggle buttons and type an amount (up to two decimals); the currency symbol next to the field shows which currency the threshold is in. Cards with no price in that currency never match. Because the threshold is currency-specific, switching the currency selector clears the field automatically.

## Card Type filter

The **Card Type** filter matches against the words in a card's type line — both its types and subtypes. For a card like _Artifact Creature — Robot Elf_, the tags **Artifact**, **Creature**, **Robot**, and **Elf** are all available (supertypes such as **Legendary** are included too). The autocomplete only offers the types actually present in the cards you're currently viewing.

Add types the same way as set codes: type a word and press space, comma, or Enter, or pick one from the autocomplete. Each type is normally a single word, so a space finishes the tag. The one exception is multi-word subtypes such as **Time Lord** (from the _Doctor Who_ set): wrap them in double quotes (`"Time Lord"`) to keep the space, or just pick them from the autocomplete, which lists them as one entry.

Two toggles control how the selected types are applied:

- **Any / All** — **Any** keeps cards that have at least one of the selected types; **All** keeps only cards that have every selected type. For example, with **Artifact** and **Creature** selected, **Any** shows all artifacts and all creatures, while **All** shows only artifact creatures.
- **Include / Exclude** — **Include** keeps cards of the selected types; **Exclude** hides them and keeps everything else.

## Oracle Tag and Art Tag filters

Cards carry community tags from [Scryfall Tagger](https://tagger.scryfall.com/), exposed as two separate filters:

- **Oracle Tags** describe what a card _does_ — its function (e.g. `ramp`, `removal`, `mana-rock`). Oracle tags are shared by every printing of a card.
- **Art Tags** describe what a card's _artwork depicts_ (e.g. `dragon`, `mountains`). Art tags are specific to a printing's illustration, so different printings of the same card can carry different art tags.

Add tags the same way as card types — type a tag and press space, comma, or Enter, or pick one from the autocomplete, which only offers the tags present in the cards you're currently viewing. Each filter has the same **Any / All** and **Include / Exclude** toggles as the Card Type filter.

To see every tag a card carries, open its detail modal (click the card) and press the **Tags** button — it lists the card's oracle tags and the art tags for the printing shown. If the card has no tag data — because it has none, or because it was added after the site was built (e.g. through the editor) — the button shows a notice that the card cache is incomplete instead.

Tags appear only when the local cache includes them. If the cache has no tags when you build the site, the build offers to download them automatically (under the same refresh prompt/flags as the bulk cache); you can also add them at any time with `ritual cache refresh-tags` — see the [`cache` command](/commands/cache/).

## Sharing a configured view

How you've set up a list view is captured in the page URL, so you can copy the link from your browser and share it — whoever opens it sees the same view. This covers the whole toolbar:

- the **grouping** (and the price-bracket size when grouping by price),
- the **sorting**, including the **Reverse** and **Reverse Sections** toggles,
- the **view layout** (binder, overlap, stack, or list) and **card size**, and
- every active **filter** from the Filters menu.

Only settings that differ from the page's defaults are added to the URL, so a link stays as short as the changes you've made — an untouched view has a clean URL. As you adjust the toolbar the link updates in place (it doesn't add browser-history steps), and opening a link that omits a setting simply uses that page's default for it. Editing a list does not write these parameters; sharing applies to the normal read view.
