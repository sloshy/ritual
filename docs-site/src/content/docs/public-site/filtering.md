---
title: 'Filtering Cards'
---

Every list view on the public site — decks, collections, wanted lists, and the [Combined List view](/public-site/combined-view/) — has a **Filters** button in the toolbar. It opens a dropdown of filters (a [bottom sheet on touch devices](/public-site/mobile/)) that narrow the cards shown without changing the underlying list. The button shows a badge with the number of active filters, and a **Clear** action at the top of the panel resets them (it stays greyed out until at least one filter is active). Filters are applied together: a card must pass every active filter to be shown. The typed filters (Name, Mana Value, Price, Copies, and — in sell mode — Buylist ($)) apply a moment after you stop typing rather than on every keystroke, so fast typing stays smooth.

## Match modes

Every filter that takes more than one value — Color Identity, Sets, Card Type, Oracle Tags, and Art Tags — has the same toggle beside its heading, so one vocabulary covers the whole menu:

- **Include** — keep cards matching **any** of the values you selected.
- **Exclude** — keep cards matching **none** of them.
- **Exact** — keep cards matching **all** of them.

**Exact** is the default for Card Type, Oracle Tags, and Art Tags, so adding a second value narrows the results rather than widening them.

Two filters differ, because of what their values mean:

- **Sets** has only **Include** and **Exclude** — a card belongs to exactly one set, so "all of them" could never match.
- **Color Identity** adds a fourth mode, **Subset**, on the left, and it is that filter's default. A card's color identity is its _complete_ color set, which makes two containment questions meaningful that a tag list can't ask: **Subset** keeps cards that fit _inside_ your selection (anything playable in a deck of those colors), and **Exact** keeps only cards whose identity _equals_ it (the classic "exactly Azorius" query). **Include** and **Exclude** keep their usual any-of / none-of meaning.

### Colorless

The Color Identity row has a sixth swatch for **Colorless**, matching cards with no color identity at all. Because colorless is the _absence_ of color rather than a color, it reads slightly differently per mode:

- On its own, **Subset**, **Include**, and **Exact** all give you exactly the colorless cards — so just clicking it does the obvious thing.
- **Exclude** with only Colorless selected hides the colorless cards and keeps everything else.
- Combined with colors, it acts as one more thing a card is allowed to match: **Include** with Green + Colorless shows everything green _plus_ the colorless cards, and **Exact** with Green + Colorless shows mono-green cards plus colorless ones.
- Under **Subset** it is redundant once any color is selected, since a colorless card already fits inside every color selection.

## Available filters

- **Hide Lands** — hides lands (cards whose type line includes _Land_, with mana value 0).
- **Hide Unpriced** — hides cards with no price in the active currency.
- **Hide Extras** — _(deck pages only)_ hides the maybeboard and token sections.
- **Name** — space-separated terms; every term must appear in the card name, case- and accent-insensitively, in any order.
- **Color Identity** — pick any of the five colors, plus a sixth **Colorless** swatch, then choose a [match mode](#match-modes). **Subset** (the default) matches any card playable in a deck of those colors; **Include** matches cards using at least one of them; **Exclude** matches cards using none of them; **Exact** matches cards whose identity is exactly the selection. Selecting **Colorless** on its own finds cards with no color identity at all.
- **Sets** — a tag input of set codes. Type a code and press space, comma, or Enter to add it; autocomplete suggests the set codes present in the current list. **Include** (the default) keeps only cards from the selected sets; **Exclude** hides them and keeps everything else. A card belongs to exactly one set, so this filter has no **Exact** mode.
- **Labels** — _(collection-bearing views only)_ four chips matching each card's effective [labels](/commands/edit/#collection-files): **For sale**, **For trade**, **To keep**, and **Unlabeled**. Sale and trade combine as an OR (cards with either label show); **To keep** and **Unlabeled** are each exclusive selections that replace whatever was picked, mirroring the label rules themselves. There is no match-mode toggle — with a four-value vocabulary, the chips already express every meaningful query. On the collections index page, the **View all…** dropdown opens the combined all-collections view with this filter pre-set (for sale, for trade, for sale or trade, or to keep) — or unfiltered, via its **View all collections** entry.
- **Buylist ($)** — _(sell mode only)_ a comparison against the buyer's per-copy offer, working like **Price**. Always in dollars whatever currency the page shows, so it survives a currency switch (the Price filter does not). Cards with no active offer never match. See [Sell mode](/public-site/sell/).
- **Buylist** — _(sell mode only)_ two chips, **On buylist** and **Not on buylist**, matching whether the selected buyer has a listing for the card's printing. The two combine as an OR, so selecting both (or neither) matches everything. See [Sell mode](/public-site/sell/).

All tag inputs (Sets, Card Type, Oracle Tags, and Art Tags) share the same autocomplete behavior: as you type, a suggestion list appears. Use the **↑/↓ arrow keys** to move through it and **Enter** to add the highlighted suggestion; with nothing highlighted, Enter adds whatever you've typed. You can also click a suggestion, and **Backspace** on an empty input removes the last tag.

- **Card Type** — a tag input of card types and subtypes (see below).
- **Oracle Tags** / **Art Tags** — tag inputs backed by [Scryfall Tagger](https://tagger.scryfall.com/) data (see below).
- **Mana Value** — pick a comparison operator (`=`, `<`, `≤`, `>`, `≥`) from the toggle buttons and type a value to compare against the card's mana value.
- **Price** — a comparison (`=`, `<`, `≤`, `>`, `≥`) against the card's price in the currency chosen by the header **Prices** selector. Pick the operator from the toggle buttons and type an amount (up to two decimals); the filter's label shows which currency the threshold is in — **Price ($)**, **Price (€)**, and so on. Cards with no price in that currency never match. Because the threshold is currency-specific, switching the currency selector clears the field automatically.
- **Copies** — a comparison (`=`, `<`, `≤`, `>`, `≥`) against how many total copies of that card name you have in the list, added up across every entry that shares the name (including different printings). For example, searching **Copies = 1** finds cards you have exactly one of, while **Copies ≥ 2** finds every name you have duplicates of, regardless of how those copies are split across printings. A double-faced printing (stored as "Front // Back") is matched by its front face, so it groups correctly with a single-sided printing of the same card.

## Card Type filter

The **Card Type** filter matches against the words in a card's type line — both its types and subtypes. For a card like _Artifact Creature — Robot Elf_, the tags **Artifact**, **Creature**, **Robot**, and **Elf** are all available (supertypes such as **Legendary** are included too). The autocomplete only offers the types actually present in the cards you're currently viewing.

Add types the same way as set codes: type a word and press space, comma, or Enter, or pick one from the autocomplete. Each type is normally a single word, so a space finishes the tag. The one exception is multi-word subtypes such as **Time Lord** (from the _Doctor Who_ set): wrap them in double quotes (`"Time Lord"`) to keep the space, or just pick them from the autocomplete, which lists them as one entry.

The [match mode](#match-modes) toggle controls how the selected types are applied. With **Artifact** and **Creature** selected, **Exact** (the default) shows only artifact creatures, **Include** shows all artifacts and all creatures, and **Exclude** hides anything that is either one.

## Oracle Tag and Art Tag filters

Cards carry community tags from [Scryfall Tagger](https://tagger.scryfall.com/), exposed as two separate filters:

- **Oracle Tags** describe what a card _does_ — its function (e.g. `ramp`, `removal`, `mana-rock`). Oracle tags are shared by every printing of a card.
- **Art Tags** describe what a card's _artwork depicts_ (e.g. `dragon`, `mountains`). Art tags are specific to a printing's illustration, so different printings of the same card can carry different art tags.

Add tags the same way as card types — type a tag and press space, comma, or Enter, or pick one from the autocomplete, which only offers the tags present in the cards you're currently viewing. Each filter has the same [match mode](#match-modes) toggle as the Card Type filter, defaulting to **Exact**.

To see every tag a card carries, open its detail modal (click the card) and press the **Tags** button — it lists the card's oracle tags and the art tags for the printing shown. If the card has no tag data — because it has none, or because it was added after the site was built (e.g. through the editor) — the button shows a notice that the card cache is incomplete instead.

Tags appear only when the local cache includes them. If the cache has no tags when you build the site, the build offers to download them automatically (under the same refresh prompt/flags as the bulk cache); you can also add them at any time with `ritual cache refresh-tags` — see the [`cache` command](/commands/cache/).

## Sharing a configured view

How you've set up a list view is captured in the page URL, so you can copy the link from your browser and share it — whoever opens it sees the same view. This covers the whole toolbar:

- the **grouping** (and the price-bracket size when grouping by price),
- the **sorting** — every layer of it. You can stack multiple sort layers with the **+** button beside the sort dropdown: the first layer is the primary sort and each layer below it breaks ties within the one above (e.g. sort by name, then by price within cards of the same name). Each layer has its own **↑↓** reverse button joined to its dropdown, and a **−** button removes it once there is more than one. The **Reverse Sections** toggle (group order) is captured too,
- the **view layout** (binder, overlap, stack, or list) and **card size**, and
- every active **filter** from the Filters menu.

Only settings that differ from the page's defaults are added to the URL, so a link stays as short as the changes you've made — an untouched view has a clean URL. As you adjust the toolbar the link updates in place (it doesn't add browser-history steps), and opening a link that omits a setting simply uses that page's default for it. Editing a list does not write these parameters; sharing applies to the normal read view.
