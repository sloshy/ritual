---
title: 'Filtering Cards'
---

Every list view on the public site — decks, collections, wanted lists, and the [Combined List view](/public-site/combined-view/) — has a **Filters** button in the toolbar. It opens a dropdown of filters (a [bottom sheet on touch devices](/public-site/mobile/)) that narrow the cards shown without changing the underlying list. The button shows a badge with the number of active filters, and a **Clear** action at the top of the panel resets them (it stays greyed out until at least one filter is active). Filters are applied together: a card must pass every active filter to be shown. The typed filters (Name, Mana Value, Price, Copies, and — in sell mode — Buylist ($)) apply a moment after you stop typing rather than on every keystroke, so fast typing stays smooth.

## Quick filter

You don't have to open the panel to search by name. On any list view, **just start typing**: a small **Quick filter** tab drops out of the bottom-right corner of the toolbar with what you typed in it, already focused, and the cards narrow as you go. It is the same **Name** filter the panel holds — one query, not two — so it shows up in the panel's field, counts toward the Filters badge, and travels in a [shared link](#sharing-a-configured-view) like any other filter.

Empty the field (or press **Escape** in it, or use its **×**, or hit **Clear** in the Filters panel) and the tab goes away again. Keys typed into a field, a search box, or an open dialog are left alone, so this never steals what you're typing somewhere else.

## Match modes

Every filter that takes more than one value — Color Identity, Sets, Card Type, Oracle Tags, and Art Tags — has the same toggle beside its heading, so one vocabulary covers the whole menu:

- **Include** — keep cards matching **any** of the values you selected.
- **Exclude** — keep cards matching **none** of them.
- **Exact** — keep cards matching **all** of them.

**Exact** is the default for Card Type, Oracle Tags, and Art Tags, so adding a second value narrows the results rather than widening them.

A few filters differ, because of what their values mean:

- **Sets** has only **Include** and **Exclude** — a card belongs to exactly one set, so "all of them" could never match.
- **Copies** has a toggle of its own — **Name**, **Number**, **Exact** — which is not a match mode at all: it picks what the filter treats as the same card when it adds copies up. See [What counts as a copy](#what-counts-as-a-copy).
- **Color Identity** adds a fourth mode, **Subset**, on the left, and it is that filter's default. A card's color identity is its _complete_ color set, which makes two containment questions meaningful that a tag list can't ask: **Subset** keeps cards that fit _inside_ your selection (anything playable in a deck of those colors), and **Exact** keeps only cards whose identity _equals_ it (the classic "exactly Azorius" query). **Include** and **Exclude** keep their usual any-of / none-of meaning.
- **Shares Cards With** and **Doesn't Share Cards With** carry two toggles of their own: **Any / All** (on the include row only) decides whether a card must appear in at least one or in every selected list, and **Name / Printing** decides what counts as the same card across lists. See [Filtering against other lists](#filtering-against-other-lists).

### Colorless

The Color Identity row has a sixth swatch for **Colorless**, matching cards with no color identity at all. Because colorless is the _absence_ of color rather than a color, it reads slightly differently per mode:

- On its own, **Subset**, **Include**, and **Exact** all give you exactly the colorless cards — so just clicking it does the obvious thing.
- **Exclude** with only Colorless selected hides the colorless cards and keeps everything else.
- Combined with colors, it acts as one more thing a card is allowed to match: **Include** with Green + Colorless shows everything green _plus_ the colorless cards, and **Exact** with Green + Colorless shows mono-green cards plus colorless ones.
- Under **Subset** it is redundant once any color is selected, since a colorless card already fits inside every color selection.

## Available filters

- **Hide Lands** — hides lands (cards whose type line includes _Land_, with mana value 0).
- **Hide Unpriced** — hides cards with no price in the active currency. It reads the price, not the reason, so it also hides cards that are [priceless by rule](/custom-art/#custom-art-carries-no-price) — proxies and custom-art copies price at `0` and go with the rest.
- **Hide Extras** — _(deck pages only)_ hides the maybeboard and token sections.
- **Name** — space-separated terms; every term must appear in the card name, case- and accent-insensitively, in any order.
- **Color Identity** — pick any of the five colors, plus a sixth **Colorless** swatch, then choose a [match mode](#match-modes). **Subset** (the default) matches any card playable in a deck of those colors; **Include** matches cards using at least one of them; **Exclude** matches cards using none of them; **Exact** matches cards whose identity is exactly the selection. Selecting **Colorless** on its own finds cards with no color identity at all.
- **Sets** — a tag input of set codes. Type a code and press space, comma, or Enter to add it; autocomplete suggests the set codes present in the current list. **Include** (the default) keeps only cards from the selected sets; **Exclude** hides them and keeps everything else. A card belongs to exactly one set, so this filter has no **Exact** mode.
- **Labels** — _(views whose lists carry [labels](/commands/edit/#card-labels))_ chips matching each card's effective labels: **For sale**, **For trade**, **To keep**, **Proxy**, and **Unlabeled**. Sale and trade combine as an OR (cards with either label show); **To keep**, **Proxy**, and **Unlabeled** are each exclusive selections that replace whatever was picked, mirroring the label rules themselves. There is no match-mode toggle — with this small a vocabulary, the chips already express every meaningful query. **Each page offers only the chips its lists can answer**: a collection page shows all five, a **deck** page shows just **Proxy** and **Unlabeled** (the only label a deck carries), a combined view shows the union of its selected lists' vocabularies, and a wanted list shows the row not at all. On the collections index page, the **View all…** dropdown opens the combined all-collections view with this filter pre-set (for sale, for trade, for sale or trade, to keep, or proxies) — or unfiltered, via its **View all collections** entry.
- **Shares Cards With** — a multi-select of your other lists; keeps only cards that also appear in them. **Any** (the default) keeps a card present in at least one selected list; **All** requires it in every one. A **Name / Printing** toggle picks what "the same card" means — see [Filtering against other lists](#filtering-against-other-lists).
- **Doesn't Share Cards With** — the exclusion counterpart: a card present in **any** of the selected lists is hidden. Exclusion always wins — a card in both an included and an excluded list stays hidden. It has its own **Name / Printing** toggle.
- **Buylist ($)** — _(sell mode only)_ a comparison against the buyer's per-copy offer, working like **Price**. Always in dollars whatever currency the page shows, so it survives a currency switch (the Price filter does not). Cards with no active offer never match. See [Sell mode](/public-site/sell/).
- **Buylist** — _(sell mode only)_ two chips, **On buylist** and **Not on buylist**, matching whether the selected buyer is **currently buying** the card's printing — a paused offer (a published price the buyer is not taking today) counts as **Not on buylist**. The two combine as an OR, so selecting both (or neither) matches everything. See [Sell mode](/public-site/sell/).

The token tag inputs (Sets, Card Type, Oracle Tags, and Art Tags) share the same autocomplete behavior: as you type, a suggestion list appears. Use the **↑/↓ arrow keys** to move through it and **Enter** to add the highlighted suggestion; with nothing highlighted, Enter adds whatever you've typed. You can also click a suggestion, and **Backspace** on an empty input removes the last tag. The two share rows take list names rather than tokens and commit them a little differently — see [Filtering against other lists](#filtering-against-other-lists).

- **Card Type** — a tag input of card types and subtypes (see below).
- **Oracle Tags** / **Art Tags** — tag inputs backed by [Scryfall Tagger](https://tagger.scryfall.com/) data (see below).
- **Mana Value** — pick a comparison operator (`=`, `<`, `≤`, `>`, `≥`) from the toggle buttons and type a value to compare against the card's mana value.
- **Price** — a comparison (`=`, `<`, `≤`, `>`, `≥`) against the card's price in the currency chosen by the header **Prices** selector. Pick the operator from the toggle buttons and type an amount (up to two decimals); the filter's label shows which currency the threshold is in — **Price ($)**, **Price (€)**, and so on. Cards with no price in that currency never match. Because the threshold is currency-specific, switching the currency selector — or the [price store](/public-site/price-sources/) — clears the field automatically.
- **Copies** — a comparison (`=`, `<`, `≤`, `>`, `≥`) against how many total copies of the card you have in the list, added up across every entry that counts as the same card. For example, searching **Copies = 1** finds cards you have exactly one of, while **Copies ≥ 2** finds everything you have duplicates of. A **Name / Number / Exact** toggle decides what "the same card" means (see below).

### What counts as a copy

The Copies row carries its own three-way toggle, beside the label:

- **Name** _(default)_ — every printing of the card name counts together, however it's printed or finished. **Copies ≥ 2** finds every name you have duplicates of, regardless of how those copies are split across printings. A double-faced printing (stored as "Front // Back") is matched by its front face, so it groups with a single-sided printing of the same card.
- **Number** — only entries with the same set code _and_ collector number count together, across finishes. Use it to find the printings you have several of, rather than the names.
- **Exact** — only the same set code, collector number, _and_ finish count together, so a foil and a nonfoil of one printing are two different things.

Under **Number** and **Exact**, language separates copies too: a `[ja]` copy counts apart from its English twin of the same printing. Condition is never part of the comparison: a played copy and a near-mint copy of the same printing are still two copies of it. Entries with no card data behind them fall back to counting by name under all three modes.

On a deck page the count is per section — the mainboard, the sideboard, and the extras (maybeboard, tokens) are counted separately, so a card in the maybeboard is compared against the maybeboard alone.

## Filtering against other lists

**Shares Cards With** and **Doesn't Share Cards With** compare the cards in the current view against your other lists — decks, collections, and wanted lists alike. Classic uses: narrow a deck to the cards your collection already holds (or is missing), or find the collection cards no deck is using.

Both rows appear only when there are other lists to compare against. On a single list's page the list itself is never offered — comparing a list with itself would say nothing. The [Combined List view](/public-site/combined-view/) offers every list, including the ones it is showing; a card trivially "shares" with the list it came from, so selecting a member list there keeps its own cards.

- **Any / All** _(include row only)_ — **Any** (the default) keeps cards present in at least one selected list; **All** keeps only cards present in every one.
- **Name / Printing** _(both rows, independently)_ — **Name** (the default) matches on the card name, case- and accent-insensitively, with a double-faced card matched by its front face — any printing in the other list counts. **Printing** matches only the exact printing (set and collector number): the printing shown in the current view must itself be held by the other list. A card with no resolved printing data never matches under **Printing**, so it is hidden by an include and kept by an exclude. A line that **pins** a printing (`SET:CN` in the file) always compares by its pin, whatever the view happens to display; a line that pins nothing compares by the printing the site resolved or displays for it — which follows the **Lowest Price** toggle and the selected [price store](/public-site/price-sources/) — so two unpinned lines match only when both sides resolved the same printing. For lists that mostly leave printings unpinned, **Name** is the toggle to reach for.

A few rules worth knowing:

- **Exclusion wins.** The two rows are applied independently, and a card present in any excluded list is hidden even when an included list also holds it.
- **One side only.** Selecting a list in one row removes it from the other, so the same list is never both included and excluded.
- **Saved contents only.** The comparison always reads a compared list's published copy: on the public site that is the data the site was built with — another list's in-browser [editor session](/commands/edit/) never counts, saved or not — and on the admin site it is the file on disk. Each list is read **once per browser session**, the first time you select it, so a save made after that point isn't reflected until you reload the page.
- **Loaded on demand.** Each compared list's contents load the first time you select it and are cached for the rest of the session. While one is still loading it filters nothing — the view updates the moment its data arrives.
- **Presence, not quantity.** One copy anywhere in the other list is enough; for decks, every section counts (mainboard, sideboard, and extras alike).

The rows' inputs work a little differently from the panel's other tag inputs, because their values are list names: as you type, the suggestions match anywhere in a name; **Enter** commits the highlighted suggestion or a typed name — a partial name works too, when it matches exactly one list; a space or comma never finishes a chip (list names may contain both); and **Backspace** on an empty input removes the last chip.

Like every filter, the selections travel in a [shared link](#sharing-a-configured-view). A link naming a list that no longer exists — or one whose data fails to load — contributes nothing to either row: it never narrows the view, even under **All**. Its chip stays in the panel, showing the raw `type:slug` token, so you can see it and remove it. A link pasted onto the named list's own page drops that list from the comparison.

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

## Grouping and sorting by tags

Your own [card tags](/commands/edit/#card-tags) — the tags written on a card line — are a toolbar choice on every list view (decks, collections, wanted lists, and the combined view):

- **Group: Tags** makes one section per distinct _set_ of tags, headed by the set itself (`Ramp`, `Ramp, Staple`, …) in alphabetical order, with an **Untagged** section last. A card lands in exactly one section — a card tagged `Ramp, Staple` sits under that heading, not under `Ramp` _and_ `Staple` — so section counts and totals add up to the list, like every other grouping. **Reverse Sections** puts Untagged first.
- **Sort: Tags** orders cards by the same tag-set string, untagged cards last; add it as a second layer to sort within another field's ties.
- The **card detail modal** lists a card's tags as chips under its note. The **Scryfall Tags** disclosure beneath them is a different vocabulary — the community tagger's oracle and art tags, which the [Oracle Tag and Art Tag filters](#oracle-tag-and-art-tag-filters) use.

Both choices travel in a [shared link](#sharing-a-configured-view) (`group=tags`, `sort=tags`).

## Sharing a configured view

How you've set up a list view is captured in the page URL, so you can copy the link from your browser and share it — whoever opens it sees the same view. This covers the whole toolbar:

- the **grouping** (and the price-bracket size when grouping by price) — including [**Tags**](#grouping-and-sorting-by-tags),
- the **sorting** — every layer of it. You can stack multiple sort layers with the **+** button beside the sort dropdown: the first layer is the primary sort and each layer below it breaks ties within the one above (e.g. sort by name, then by price within cards of the same name). Each layer has its own **↑↓** reverse button joined to its dropdown, and a **−** button removes it once there is more than one. The **Reverse Sections** toggle (group order) is captured too,
- the **view layout** (binder, overlap, stack, or list) and **card size**,
- the chosen [**price store**](/public-site/price-sources/) when it differs from the default, and
- every active **filter** from the Filters menu.

Only settings that differ from the page's defaults are added to the URL, so a link stays as short as the changes you've made — an untouched view has a clean URL. As you adjust the toolbar the link updates in place (it doesn't add browser-history steps), and opening a link that omits a setting simply uses that page's default for it. Editing a list does not write these parameters; sharing applies to the normal read view.
