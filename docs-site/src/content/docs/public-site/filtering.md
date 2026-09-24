---
title: 'Filtering Cards'
description: The toolbar's Filters menu, its match modes, filtering against other lists, and sharing a configured view by link.
---

Every list view on the public site (decks, collections, wanted lists, and the [Combined List view](/public-site/combined-view/)) has a **Filters** button in the toolbar. It opens a panel of filters (a [bottom sheet on touch devices](/public-site/mobile/)) that narrow the cards shown without changing the list itself.

- The button shows a badge with the number of active filters.
- **Clear** at the top of the panel resets every filter. It is greyed out until a filter is active.
- Filters combine: a card must pass every active filter to be shown.
- The typed filters (Name, Mana Value, Price, Copies, and Buylist ($) in sell mode) apply a moment after you stop typing, not on every keystroke.

## Quick filter

You don't have to open the panel to search by name. On any list view, **just start typing**. A **Quick filter** tab drops out of the bottom-right corner of the toolbar with your text in it, already focused, and the cards narrow as you type. It is the same **Name** filter the panel holds, so it appears in the panel's field, counts toward the Filters badge, and travels in a [shared link](#sharing-a-configured-view).

To dismiss the tab, empty the field, press **Escape** in it, use its **×**, or hit **Clear** in the Filters panel. Typing into a field, a search box, or an open dialog never triggers the quick filter.

## Match modes

Every filter that takes several values (Color Identity, Sets, Card Type, Oracle Tags, Art Tags, Categories, and Tags) has the same toggle beside its heading:

- **Include**: keep cards matching **any** of the selected values.
- **Exclude**: keep cards matching **none** of them.
- **Exact**: keep cards matching **all** of them.

**Exact** is the default for Card Type, Oracle Tags, Art Tags, Categories, and Tags, so adding a second value narrows the results.

A few filters differ:

- **Sets** has only **Include** and **Exclude**. A card belongs to exactly one set, so "all of them" could never match.
- **Copies** has its own **Name / Number / Exact** toggle, which is not a match mode. It decides what counts as the same card when copies are added up. See [What counts as a copy](#what-counts-as-a-copy).
- **Color Identity** adds a fourth mode, **Subset**, which is its default. A card's color identity is its complete color set, so two containment questions make sense here. **Subset** keeps cards that fit _inside_ your selection (anything playable in a deck of those colors). **Exact** keeps only cards whose identity _equals_ the selection ("exactly Azorius"). **Include** and **Exclude** keep their any-of / none-of meaning.
- **Shares Cards With** and **Doesn't Share Cards With** have two toggles of their own. **Any / All** (include row only) decides whether a card must appear in at least one or in every selected list. **Name / Printing** decides what counts as the same card across lists. See [Filtering against other lists](#filtering-against-other-lists).

### Colorless

The Color Identity row has a sixth swatch, **Colorless**, for cards with no color identity. Because colorless is the absence of color, it reads slightly differently per mode:

- On its own, **Subset**, **Include**, and **Exact** all show exactly the colorless cards.
- **Exclude** with only Colorless selected hides the colorless cards and keeps everything else.
- Combined with colors, it is one more thing a card may match. **Include** with Green + Colorless shows every green card plus the colorless ones. **Exact** with Green + Colorless shows mono-green cards plus colorless ones.
- Under **Subset** it is redundant once any color is selected, because a colorless card already fits inside every selection.

## Available filters

- **Hide Lands**: hides cards whose type line includes _Land_ and whose mana value is 0.
- **Hide Unpriced**: hides cards with no price in the active currency. It reads the price, not the reason, so it also hides cards that are [priceless by rule](/public-site/prices/#cards-priced-at-zero): proxies and custom-art copies price at `0` and are hidden too.
- **Hide Extras** _(deck pages only)_: hides the maybeboard and token sections.
- **Name**: space-separated terms. Every term must appear in the card name, in any order, ignoring case and accents.
- **Color Identity**: pick any of the five colors plus **Colorless**, then choose a [match mode](#match-modes) (**Subset** is the default).
- **Sets**: a tag input of set codes, with autocomplete over the sets in the current list. **Include** (the default) keeps only cards from the selected sets; **Exclude** hides them.
- **Labels** _(views whose lists carry [labels](/list-format/#card-labels))_: chips matching each card's effective labels: **For sale**, **For trade**, **To keep**, **Proxy**, and **Unlabeled**. Sale and trade combine as an OR. **To keep**, **Proxy**, and **Unlabeled** are each exclusive and replace whatever was picked, mirroring the label rules. There is no match-mode toggle. **Each page offers only the chips its lists can answer**: a collection page shows all five, a deck page shows just **Proxy** and **Unlabeled**, a combined view shows the union of its lists' vocabularies, and a wanted list hides the row. On the collections home tab, the **View all…** dropdown opens the all-collections view with this filter pre-set (for sale, for trade, for sale or trade, to keep, or proxies), or unfiltered via **View all collections**.
- **Shares Cards With**: a multi-select of your other lists. Keeps only cards that also appear in them (**Any** of them by default, or **All**).
- **Doesn't Share Cards With**: hides cards present in **any** of the selected lists. Exclusion always wins over the include row. See [Filtering against other lists](#filtering-against-other-lists) for both rows.
- **Buylist ($)** _(sell mode only)_: a comparison against the buyer's per-copy offer, like **Price**. It is always in dollars whatever currency the page shows, so it survives a currency switch (the Price filter does not). Cards with no active offer never match. See [Sell mode](/public-site/sell/).
- **Buylist** _(sell mode only)_: two chips, **On buylist** and **Not on buylist**, matching whether the selected buyer is currently buying the card's printing. A paused offer (a published price the buyer is not taking today) counts as **Not on buylist**. The chips combine as an OR, so selecting both or neither matches everything. See [Sell mode](/public-site/sell/).
- **Card Type**: a tag input of card types and subtypes. See [Card Type filter](#card-type-filter).
- **Oracle Tags** / **Art Tags**: tag inputs backed by [Scryfall Tagger](https://tagger.scryfall.com/) data. See [Oracle Tag and Art Tag filters](#oracle-tag-and-art-tag-filters).
- **Categories** _(lists whose cards carry [categories](/commands/categories/))_: a tag input of the list's category names. See [Grouping, sorting and filtering by category](#grouping-sorting-and-filtering-by-category).
- **Tags** _(lists whose cards carry [tags](/list-format/#card-tags))_: a tag input of your own card tags, not the Scryfall tags above. See [Grouping, sorting and filtering by tags](#grouping-sorting-and-filtering-by-tags).
- **Mana Value**: pick an operator (`=`, `<`, `≤`, `>`, `≥`) and type a value to compare against the card's mana value.
- **Price**: an operator (`=`, `<`, `≤`, `>`, `≥`) and an amount (up to two decimals), compared against the card's price in the header's selected currency. The label shows the currency: **Price ($)**, **Price (€)**. Cards with no price in that currency never match. Switching the currency or the [price store](/public-site/prices/) clears the field, since the threshold is currency-specific.
- **Copies**: an operator (`=`, `<`, `≤`, `>`, `≥`) against how many copies of the card the list holds. **Copies = 1** finds cards you have exactly one of; **Copies ≥ 2** finds your duplicates. A **Name / Number / Exact** toggle decides what counts as the same card (see below).

The tag inputs (Sets, Card Type, Oracle Tags, Art Tags, Categories, and Tags) work the same way. Type a value and press space, comma, or Enter to add it, or pick from the suggestion list with **↑/↓** and **Enter** (or a click). Categories and Tags commit on **commas only**, since their values can contain spaces (`Board Wipes`, `Trade Binder`). **Backspace** on an empty input removes the last tag. The two share rows take list names and commit a little differently; see [Filtering against other lists](#filtering-against-other-lists).

### What counts as a copy

The Copies row's three-way toggle:

- **Name** _(default)_: every printing and finish of the card name counts together. A double-faced printing (stored as "Front // Back") is matched by its front face, so it groups with a single-sided printing of the same card.
- **Number**: only entries with the same set code _and_ collector number count together, across finishes. Use it to find printings you have several of.
- **Exact**: only the same set code, collector number, _and_ finish count together, so a foil and a nonfoil of one printing are two different things.

Under **Number** and **Exact**, language separates copies too: a `[ja]` copy counts apart from its English twin. Condition is never part of the comparison. Entries with no card data behind them are counted by name under all three modes.

On a deck page the count is per section: the mainboard, the sideboard, and the extras (maybeboard and tokens together) are each counted separately.

## Filtering against other lists

**Shares Cards With** and **Doesn't Share Cards With** compare the cards in the current view against your other decks, collections, and wanted lists. Typical uses: narrow a deck to the cards your collection already holds (or is missing), or find the collection cards no deck uses.

Both rows appear only when there are other lists to compare against, and a single list's page never offers the list itself. The [Combined List view](/public-site/combined-view/) offers every list, including the ones it shows; selecting a member list keeps its own cards, since a card always "shares" with the list it came from.

- **Any / All** _(include row only)_: **Any** (the default) keeps cards present in at least one selected list; **All** keeps only cards present in every one.
- **Name / Printing** _(each row, independently)_: **Name** (the default) matches on card name, ignoring case and accents, with a double-faced card matched by its front face. Any printing in the other list counts. **Printing** matches only the exact printing (set and collector number): the other list must hold the printing shown in the current view. A card with no resolved printing data never matches under **Printing**, so an include hides it and an exclude keeps it. A line that pins a printing (`SET:CN` in the file) always compares by its pin. A line that pins nothing compares by the printing the site displays for it, which follows the **Lowest Price** toggle and the selected [price store](/public-site/prices/), so two unpinned lines match only when both resolved the same printing. For lists that mostly leave printings unpinned, use **Name**.

Rules to know:

- **Exclusion wins.** The rows apply independently, and a card in any excluded list is hidden even when an included list also holds it.
- **One side only.** Selecting a list in one row removes it from the other.
- **Saved contents only.** The comparison reads the compared list's published copy: on the public site, the data the site was built with (another list's in-browser [editor session](/public-site/editing/) never counts, saved or not); on the admin site, the file on disk. Each list is read **once per browser session**, the first time you select it, so a later save is not reflected until you reload.
- **Loaded on demand.** A compared list's contents load the first time you select it and are cached for the session. While loading, it filters nothing; the view updates when the data arrives.
- **Presence, not quantity.** One copy anywhere in the other list is enough. For decks, every section counts, extras included.

The share rows' inputs take list names, so they behave a little differently from the other tag inputs. Suggestions match anywhere in a name. **Enter** commits the highlighted suggestion or a typed name, and a partial name works when it matches exactly one list. Space and comma never finish a chip (list names may contain both). **Backspace** on an empty input removes the last chip.

Like every filter, the selections travel in a [shared link](#sharing-a-configured-view). A link naming a list that no longer exists, or whose data fails to load, contributes nothing to either row and never narrows the view, even under **All**. Its chip stays in the panel showing the raw `type:slug` token so you can remove it. A link pasted onto the named list's own page drops that list from the comparison.

## Card Type filter

The **Card Type** filter matches the words in a card's type line: types, subtypes, and supertypes such as **Legendary**. For _Artifact Creature — Robot Elf_, the tags **Artifact**, **Creature**, **Robot**, and **Elf** are all available. Autocomplete offers only the types present in the cards you're viewing.

A space finishes a tag, so for a multi-word subtype such as **Time Lord** either wrap it in double quotes (`"Time Lord"`) or pick it from the autocomplete, which lists it as one entry.

The [match mode](#match-modes) toggle controls how the types combine. With **Artifact** and **Creature** selected, **Exact** (the default) shows only artifact creatures, **Include** shows all artifacts and all creatures, and **Exclude** hides any card that is either one.

## Oracle Tag and Art Tag filters

Cards carry community tags from [Scryfall Tagger](https://tagger.scryfall.com/), exposed as two filters:

- **Oracle Tags** describe what a card _does_ (`ramp`, `removal`, `mana-rock`). They are shared by every printing of a card.
- **Art Tags** describe what the _artwork depicts_ (`dragon`, `mountains`). They belong to a printing's illustration, so different printings of one card can carry different art tags.

Autocomplete offers only the tags present in the cards you're viewing. Both filters have the same [match mode](#match-modes) toggle as Card Type, defaulting to **Exact**.

To see every tag a card carries, open its detail modal and press **Tags**. It lists the card's oracle tags and the art tags of the printing shown. If the card has no tag data (it has none, or it was added after the site was built, through the editor for example), the button shows a notice that the card cache is incomplete.

Tags appear only when the local cache includes them. If the cache has no tags when you build the site, the build offers to download them, under the same refresh prompt and flags as the bulk cache. You can also add them at any time with `ritual cache refresh-tags`; see the [`cache` command](/commands/cache/).

## Grouping, sorting and filtering by tags

Your own [card tags](/list-format/#card-tags), written on a card line, are a toolbar choice on every list view, the combined view included:

- **Group: Tags** makes one section per distinct _set_ of tags, headed by the set itself (`Ramp`, `Ramp, Staple`, …) in alphabetical order, with **Untagged** last. A card lands in exactly one section: a card tagged `Ramp, Staple` sits under that heading, not under `Ramp` and `Staple` separately, so section counts add up to the list. **Reverse Sections** puts Untagged first.
- **Sort: Tags** orders cards by the same tag-set string, untagged cards last. Add it as a second layer to break another field's ties.
- The **Tags** filter row narrows to selected tags with **Include / Exclude / Exact** modes (**Exact** is the default). Matching is exact and case-sensitive (`Ramp` and `ramp` are two tags), and chips keep their spelling in a shared link. The row appears when the list's cards carry tags, and also whenever a shared link arrived with a tag selection, so its chips stay removable.
- The **card detail modal** lists a card's tags as chips under its note. The **Scryfall Tags** disclosure beneath them is a different vocabulary: the community oracle and art tags used by the [Oracle Tag and Art Tag filters](#oracle-tag-and-art-tag-filters).

All three travel in a [shared link](#sharing-a-configured-view): `group=tags`, `sort=tags`, and the filter row's `tags=Signed,Trade Binder` plus `tagMode=include|exclude|exact`.

## Grouping, sorting and filtering by category

[Card categories](/commands/categories/) describe a card's role in one list (`Ramp`, `Board Wipes`); the first one is its **primary** category. They are a toolbar choice on every single-list view. The two groupings and the **Category** sort are always offered (a list with no categories shows one **Uncategorized** group). The filter row appears only when the list's cards carry categories.

- **Group: Category** puts each card under its primary category only.
- **Group: Categories** shows a card under _every_ category it holds. Appearances outside the primary category are dimmed and carry a small **also** badge whose tooltip names the primary category, and the section heading notes that its count includes them. Under this grouping alone, section totals overlap.
- **Sort: Category** orders cards by primary category, uncategorized cards last.
- The **Categories** filter row narrows to selected categories with **Include / Exclude / Exact** modes (**Exact** is the default). Matching ignores case, and names keep their capitalization in the chips and in a shared link. The row appears when the list's cards carry categories, and also whenever a shared link arrived with a category selection, so its chips stay removable.
- The **card detail modal** lists a card's categories as chips, with the primary one outlined.

Section headings follow the list's own category order (the `order` in its `.categories.json` file, set with `ritual categories order`). Categories the order does not name come after the ones it does, and **Uncategorized** is last (on a deck, last within each board).

On a **deck**, the board comes first and the categories nest inside it: `Main › Ramp`, `Sideboard › Draw`, `Maybeboard › Ramp`. Every board takes part, in the order commander, mainboard, sideboard, then each extras section under its own name, with the category order inside each and **Uncategorized** last within each board. A `Ramp` card in the sideboard heads under **Sideboard › Ramp**, never under a flat **Ramp** shared with mainboard cards. **Reverse Sections** reverses the categories inside each board (Uncategorized first) but never the board order. **Hide Extras** still removes the extras boards with their nested headings. This nesting is specific to the two category groupings; grouping by type, mana value, tags, or anything else groups the mainboard only and leaves the commander, sideboard, and extras in their own ungrouped sections below.

All four travel in a [shared link](#sharing-a-configured-view): `group=category`, `group=categories`, `sort=category`, and the filter row's `cats=Ramp,Board Wipes` plus `catMode=include|exclude|exact`.

## Sharing a configured view

The page URL captures how you've set up a list view, so you can copy the link from your browser and share it. Whoever opens it sees the same view. The URL covers the whole toolbar:

- the **grouping** (and the price-bracket size when grouping by price), including the [**Tags**](#grouping-sorting-and-filtering-by-tags) and [**Category**](#grouping-sorting-and-filtering-by-category) groupings,
- the **sorting**, every layer of it, plus the **Reverse Sections** toggle,
- the **view layout** (binder, overlap, stack, or list) and **card size**,
- the chosen [**price store**](/public-site/prices/) when it differs from the default, and
- every active **filter**.

Sort layers stack with the **+** button beside the sort dropdown. The first layer is the primary sort, and each layer below it breaks ties within the one above (by name, then by price within cards of the same name). Each layer has its own **↑↓** reverse button, and a **−** button removes it once there is more than one.

Only settings that differ from the page's defaults go into the URL, so an untouched view has a clean URL and a link stays as short as your changes. The link updates in place as you adjust the toolbar, without adding browser-history steps. A link that omits a setting uses the page's default. Editing a list does not write these parameters; sharing applies to the normal read view.
