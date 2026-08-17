/** Translator metadata for the `site-chrome` fragment. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { siteChromeMessages } from './site-chrome'

/**
 * Toolbar chips sit in one horizontal row above the cards and wrap onto a
 * second line before they truncate — but a wrapped toolbar costs a row of the
 * card grid on every page, so keep these tight.
 */
const CHIP_MAX_LEN = 18

/**
 * Segmented match-mode buttons: three or four sit side by side inside a filter
 * row that also holds a heading and a field, in a 410px panel.
 */
const MODE_MAX_LEN = 10

const CURRENCY_CONTEXT =
  "A row of the public site header's currency picker, choosing which of the prices baked into the site are shown. The three-letter code is an ISO 4217 currency and never translates; the symbol in parentheses may follow local convention."

const EDIT_MODE_CONTEXT =
  "Tooltip on the public site's edit-mode button. Edit mode is local-only: changes are held in the browser and exported as a change file, never written to the server."

const MATCH_MODE_CONTEXT =
  'Tooltip on one button of a filter\'s Include / Exclude / Exact segmented control. "Selected" means the chips the user has added to that filter.'

const VIEW_MODE_CONTEXT =
  'Tooltip on a card-layout button in the list toolbar. Binder is a plain grid, Overlap and Stack fan cards out on hover, List is a text table.'

const BRACKET_CONTEXT =
  'A row of the "Brackets" picker, which chooses the price bands cards are grouped into while grouping by price. Archidekt reproduces that site\'s bands; the others are fixed-width bands in US dollars, which is what the underlying price data is denominated in.'

const INDEX_SORT_CONTEXT =
  'A row of the list-gallery "Sort" dropdown on the site\'s front page. The stored value is an English slug, so translating this only changes what the reader sees.'

const VIEW_ALL_CONTEXT =
  'A row of the collections index "View all..." dropdown. Each opens the combined view of every collection with a label filter pre-applied, so the wording should match the card-label vocabulary (domain.label.*).'

const QUICK_SWITCH_KIND_CONTEXT =
  'The small kind badge at the start of a Quick Switch result row, saying what kind of thing the row is. Rendered in a narrow pill — keep it to one word.'

const QUICK_SWITCH_PARENT_CONTEXT =
  'The subtitle under a Quick Switch result, naming the list the matched card or commander was found in. {name} is a user-supplied list name and is never translated.'

const QUICK_SWITCH_KEY_CONTEXT =
  'A verb in the Quick Switch footer legend, printed after a keycap glyph ("↑ ↓ navigate"). Lowercase, no trailing punctuation.'

const THEME_EDITOR_CONTEXT =
  'A control in the theme editor toolbar, which lets the reader retint the site and download the result as a JSON theme file.'

export const siteChromeMeta = {
  // ── Branding ──────────────────────────────────────────────────────────
  'site.brand.logoAlt': {
    description:
      'Accessible name of the candle-flame logo in the site header, the admin sidebar and the login card. "Ritual" is the product name — keep it untranslated.',
  },

  // ── Header utility controls ───────────────────────────────────────────
  'site.header.pricesLabel': {
    description:
      "Label beside the header control that picks which currency prices are shown in. Includes its trailing colon so the spacing convention is the translator's to set (French, for instance, wants a space before it).",
    maxLen: CHIP_MAX_LEN,
  },
  'site.header.currencyUsd': { description: CURRENCY_CONTEXT },
  'site.header.currencyEur': { description: CURRENCY_CONTEXT },
  'site.header.currencyTix': {
    description: `${CURRENCY_CONTEXT} "TIX" is Magic Online event tickets, an in-game currency with no ISO code and no symbol.`,
  },
  'site.header.editModeEdit': {
    description: 'Header button that turns on local edit mode. Verb, imperative.',
    maxLen: 12,
  },
  'site.header.editModeDone': {
    description:
      'The same header button while edit mode is on: clicking it leaves edit mode. Pending changes are kept, not discarded.',
    maxLen: 12,
  },
  'site.header.editModeLeave': { description: `${EDIT_MODE_CONTEXT} Shown while it is on.` },
  'site.header.editModeEditList': {
    description: `${EDIT_MODE_CONTEXT} Shown while it is off and a list is open, so clicking it starts editing that list.`,
  },
  'site.header.editModeEnter': {
    description: `${EDIT_MODE_CONTEXT} Shown while it is off and no list is open, so there is nothing to edit yet.`,
  },
  'site.header.theme': { description: 'Header button opening the colour-theme menu.', maxLen: 14 },
  'site.header.themeEditing': {
    description: 'The same header button while the full theme editor is open.',
    maxLen: 16,
  },
  'site.header.themeMenu': { description: 'Tooltip on the header theme button.' },
  'site.header.themeMenuEditing': {
    description: 'Tooltip on the header theme button while the full theme editor is open.',
  },
  'site.header.language': {
    description:
      "Accessible name of the header control that switches the language of the interface. This is Ritual's own text, not the language of the printed cards — those are two separate settings.",
  },
  'site.header.languageLabel': {
    description:
      'Visible label beside the language switcher, including its trailing colon. See site.header.language.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.header.primaryNav': {
    description:
      'Accessible name of the main navigation — the header links on desktop and the bottom tab bar on phones. Never shown on screen; screen readers announce it when the reader moves into the navigation.',
  },

  // ── List-page toolbar ─────────────────────────────────────────────────
  'site.toolbar.groupLabel': {
    description:
      'Label beside the toolbar dropdown that chooses how cards are split into sections, including its trailing colon.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.sortLabel': {
    description:
      'Label beside the toolbar controls that choose the order cards appear in, including its trailing colon.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.bracketsLabel': {
    description:
      'Label beside the toolbar dropdown that chooses the price bands cards are grouped into, including its trailing colon. Only shown while grouping by price.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.sortSheet': {
    description:
      'Phone-layout toolbar button that opens the sorting and grouping controls in a bottom sheet. A ▾ glyph is appended separately.',
    maxLen: 12,
  },
  'site.toolbar.sortSheetTitle': {
    description: 'Heading of the bottom sheet that button opens.',
    maxLen: 24,
  },
  'site.toolbar.sheetGroup': {
    description: 'Heading of the grouping control inside the phone-layout sort sheet.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.sheetBrackets': {
    description: 'Heading of the price-band control inside the phone-layout sort sheet.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.sheetSort': {
    description: 'Heading of the sort-order controls inside the phone-layout sort sheet.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.sheetOrder': {
    description:
      'Heading of the section-order control inside the phone-layout sort sheet — whether the sections themselves run forwards or backwards.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.sheetCardSize': {
    description: 'Heading of the card-size control inside the phone-layout sort sheet.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.sheetExtras': {
    description:
      'Heading of the per-page extra toggles inside the phone-layout sort sheet (e.g. grouping duplicate cards).',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.reverseSections': {
    description:
      'Toolbar toggle that reverses the order of the *sections*, leaving the cards inside each one alone. A ↑↓ glyph is prepended separately.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.reverse': {
    description:
      'Toolbar toggle on the front page that reverses the order of the list gallery. A ↑↓ glyph is prepended separately.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.selectMode': {
    description:
      'Touch-only toolbar toggle: while it is on, tapping a card selects it instead of opening it.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.selectModeTitle': { description: 'Tooltip on the selection-mode toggle.' },
  'site.toolbar.sellMode': {
    description:
      'Toolbar toggle that shows what a buyer will pay for each card (its "buylist" price) alongside the retail price.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.sellModeTitle': { description: 'Tooltip on the sell-mode toggle.' },
  'site.toolbar.sellModeBusyTitle': {
    description: 'Tooltip on the sell-mode toggle while buylist prices are still being fetched.',
  },
  'site.toolbar.sellModeBusyStatus': {
    description:
      'Screen-reader-only status announced while buylist prices are being fetched. Not shown on screen.',
  },
  'site.toolbar.buyerLabel': {
    description:
      "Label beside the dropdown choosing which shop's buylist prices are quoted, including its trailing colon.",
    maxLen: CHIP_MAX_LEN,
  },
  'site.toolbar.sortAscending': {
    description:
      "Tooltip on a sort layer's direction toggle, stating the direction currently in force (A→Z, cheapest first, and so on).",
  },
  'site.toolbar.sortDescending': {
    description: "Tooltip on a sort layer's direction toggle when the order is reversed.",
  },
  'site.toolbar.sortReverse': {
    description:
      "Accessible name of a sort layer's direction toggle. Sorting is multi-level, so this reverses one level, not the whole order.",
  },
  'site.toolbar.sortRemove': { description: "Accessible name of a sort layer's remove button." },
  'site.toolbar.sortAdd': {
    description:
      'Accessible name of the button adding another sort level, applied after the ones already listed as a tie-breaker.',
  },

  // ── View modes and card sizes ─────────────────────────────────────────
  'site.viewMode.binder': { description: VIEW_MODE_CONTEXT },
  'site.viewMode.overlap': { description: VIEW_MODE_CONTEXT },
  'site.viewMode.stack': { description: VIEW_MODE_CONTEXT },
  'site.viewMode.list': { description: VIEW_MODE_CONTEXT },
  'site.cardSize.large': { description: 'Tooltip on the large card-size button in the toolbar.' },
  'site.cardSize.medium': { description: 'Tooltip on the medium card-size button in the toolbar.' },
  'site.cardSize.small': { description: 'Tooltip on the small card-size button in the toolbar.' },

  // ── Price-bracket grouping ────────────────────────────────────────────
  'site.brackets.archidekt': {
    description: `${BRACKET_CONTEXT} Archidekt is a deckbuilding website and is a proper noun.`,
  },
  'site.brackets.five': { description: BRACKET_CONTEXT },
  'site.brackets.ten': { description: BRACKET_CONTEXT },

  // ── Filters menu ──────────────────────────────────────────────────────
  'site.filter.title': {
    description:
      "The toolbar button that opens the filters panel, and the panel's own heading. A count badge is appended separately when filters are active.",
    maxLen: CHIP_MAX_LEN,
  },
  'site.filter.ariaLabel': { description: 'Accessible name of the filters panel.' },
  'site.filter.hideLands': {
    description: 'Filter toggle that hides land cards.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.filter.hideUnpriced': {
    description: 'Filter toggle that hides cards Ritual has no price for.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.filter.hideExtras': {
    description:
      "Filter toggle that hides a deck's non-deck sections — sideboard, maybeboard and the like. Decks only.",
    maxLen: CHIP_MAX_LEN,
  },
  'site.filter.clear': {
    description: 'Button that resets every filter at once.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.filter.name': { description: 'Heading of the filter matching on card name.' },
  'site.filter.namePlaceholder': {
    description:
      "Placeholder of the name filter's field. Several space-separated words all have to match.",
  },
  'site.filter.colorIdentity': {
    description:
      "Heading of the filter matching on a card's colour identity — every colour of mana in its cost and rules text, which is what decides the decks it may go in.",
  },
  'site.filter.colorMode': {
    description: "Accessible name of the colour filter's match-mode control.",
  },
  'site.filter.labels': {
    description:
      "Heading of the filter matching on card labels — the reader's own for-sale / for-trade / to-keep marks (see domain.label.*).",
  },
  'site.filter.labelMode': { description: "Accessible name of the label filter's chip group." },
  'site.filter.labelUnlabeled': {
    description: 'Label filter chip selecting cards that carry no label at all.',
    maxLen: MODE_MAX_LEN,
  },
  'site.filter.labelSaleTitle': { description: 'Tooltip on the "for sale" label filter chip.' },
  'site.filter.labelTradeTitle': { description: 'Tooltip on the "for trade" label filter chip.' },
  'site.filter.labelKeepTitle': {
    description:
      'Tooltip on the "to keep" label filter chip. Keeping is exclusive: picking it clears the other label chips.',
  },
  'site.filter.labelProxyTitle': {
    description:
      'Tooltip on the "proxy" label filter chip. Proxying is exclusive: picking it clears the other label chips.',
  },
  'site.filter.labelNoneTitle': { description: 'Tooltip on the unlabelled label filter chip.' },
  'site.filter.buylist': {
    description:
      'Heading of the filter matching on whether the chosen shop is buying the card. Sell mode only.',
  },
  'site.filter.buylistMode': { description: "Accessible name of the buylist filter's chip group." },
  'site.filter.buylistOn': {
    description: 'Buylist filter chip selecting cards the shop is currently buying.',
    maxLen: MODE_MAX_LEN + 4,
  },
  'site.filter.buylistOnTitle': { description: 'Tooltip on the "on buylist" chip.' },
  'site.filter.buylistOff': {
    description: 'Buylist filter chip selecting cards the shop is not currently buying.',
    maxLen: MODE_MAX_LEN + 6,
  },
  'site.filter.buylistOffTitle': { description: 'Tooltip on the "not on buylist" chip.' },
  'site.filter.sets': {
    description:
      'Heading of the filter matching on set code — the three-to-five letter code of the release a card was printed in. Set codes themselves are never translated.',
  },
  'site.filter.setMode': { description: "Accessible name of the set filter's match-mode control." },
  'site.filter.setsPlaceholder': { description: "Placeholder of the set-code filter's field." },
  'site.filter.setsSuggestions': {
    description: 'Accessible name of the set-code autocomplete list.',
  },
  'site.filter.cardType': {
    description:
      "Heading of the filter matching on card type (Creature, Instant, Land…) and subtype, as printed on the card's type line.",
  },
  'site.filter.cardTypeMode': {
    description: "Accessible name of the card-type filter's match-mode control.",
  },
  'site.filter.cardTypePlaceholder': {
    description: "Placeholder of the card-type filter's field.",
  },
  'site.filter.cardTypeSuggestions': {
    description: 'Accessible name of the card-type autocomplete list.',
  },
  'site.filter.oracleTags': {
    description:
      'Heading of the filter matching on Scryfall oracle tags — community-maintained tags describing what a card *does* ("ramp", "removal"). The tag slugs themselves are English and are not translated.',
  },
  'site.filter.oracleTagMode': {
    description: "Accessible name of the oracle-tag filter's match-mode control.",
  },
  'site.filter.oracleTagsPlaceholder': {
    description: "Placeholder of the oracle-tag filter's field.",
  },
  'site.filter.oracleTagsSuggestions': {
    description: 'Accessible name of the oracle-tag autocomplete list.',
  },
  'site.filter.artTags': {
    description:
      'Heading of the filter matching on Scryfall art tags — community-maintained tags describing what a card\'s artwork *depicts* ("dragon", "forest"). The tag slugs themselves are English and are not translated.',
  },
  'site.filter.artTagMode': {
    description: "Accessible name of the art-tag filter's match-mode control.",
  },
  'site.filter.artTagsPlaceholder': { description: "Placeholder of the art-tag filter's field." },
  'site.filter.artTagsSuggestions': {
    description: 'Accessible name of the art-tag autocomplete list.',
  },
  'site.filter.manaValue': {
    description:
      'Heading of the filter matching on mana value — the total cost of a card, a whole number. The game\'s own term, previously "converted mana cost".',
  },
  'site.filter.manaValueCompare': {
    description: "Accessible name of the mana-value filter's =/</≤/>/≥ comparator group.",
  },
  'site.filter.price': {
    description:
      'Heading of the price filter when the active currency has no symbol to show. See site.filter.priceWithSymbol.',
  },
  'site.filter.priceWithSymbol': {
    description:
      'Heading of the price filter. {symbol} is the active currency\'s symbol ("$", "€") — it sits in the heading rather than beside the field so every numeric field stays the same width.',
  },
  'site.filter.priceCompare': {
    description: "Accessible name of the price filter's comparator group.",
  },
  'site.filter.buylistPrice': {
    description:
      'Heading of the filter matching on what the shop pays for a card. Always US dollars — a shop\'s offer is quoted in its own currency whatever the page displays — so the "$" is fixed and must not be swapped for the reader\'s currency.',
  },
  'site.filter.buylistPriceCompare': {
    description: "Accessible name of the buylist-price filter's comparator group.",
  },
  'site.filter.copies': {
    description: 'Heading of the filter matching on how many copies of a card the list holds.',
  },
  'site.filter.copiesCompare': {
    description: "Accessible name of the copies filter's comparator group.",
  },
  'site.filter.copiesMode': {
    description:
      'Accessible name of the copies filter\'s match-mode control, which chooses what counts as "the same card" when copies are added up.',
  },
  'site.filter.numericPlaceholder': {
    description:
      'Placeholder of every numeric filter field, meaning the filter is off and any value passes.',
    maxLen: MODE_MAX_LEN,
  },
  'site.filter.removeTag': {
    description:
      "Accessible name of the × button on a selected filter chip. {value} is the chip's own text (a set code, card type or tag) and is never translated.",
  },

  // ── Filter match modes ────────────────────────────────────────────────
  'site.filterMode.include': {
    description: 'Match-mode button: keep cards matching *any* of the selected values.',
    maxLen: MODE_MAX_LEN,
  },
  'site.filterMode.exclude': {
    description: 'Match-mode button: drop cards matching any of the selected values.',
    maxLen: MODE_MAX_LEN,
  },
  'site.filterMode.exact': {
    description: 'Match-mode button: keep only cards matching *all* of the selected values.',
    maxLen: MODE_MAX_LEN,
  },
  'site.filterMode.subset': {
    description:
      'Colour-filter-only match-mode button: keep cards whose colours are all among the selected ones, which is the set of cards a deck of those colours may legally play.',
    maxLen: MODE_MAX_LEN,
  },
  'site.filterMode.name': {
    description:
      'Copies-filter match-mode button: count every printing of a card name as the same card.',
    maxLen: MODE_MAX_LEN,
  },
  'site.filterMode.number': {
    description:
      'Copies-filter match-mode button: count only cards sharing a set code and collector number — i.e. one specific printing. Named for the collector-number field the reader types into.',
    maxLen: MODE_MAX_LEN,
  },
  'site.filterMode.cardTypeInclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.cardTypeExclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.cardTypeExact': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.oracleTagInclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.oracleTagExclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.oracleTagExact': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.artTagInclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.artTagExclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.artTagExact': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.colorSubset': {
    description: `${MATCH_MODE_CONTEXT} This one describes deck legality: every colour the card needs is among the selected ones.`,
  },
  'site.filterMode.colorInclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.colorExclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.colorExact': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.setInclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.setExclude': { description: MATCH_MODE_CONTEXT },
  'site.filterMode.copiesName': {
    description: 'Tooltip on the copies filter\'s "by name" match-mode button.',
  },
  'site.filterMode.copiesNumber': {
    description: 'Tooltip on the copies filter\'s "by printing" match-mode button.',
  },
  'site.filterMode.copiesFinish': {
    description:
      "Tooltip on the copies filter's strictest match-mode button: same printing *and* same finish, so a foil and a non-foil of one printing count separately.",
  },

  // ── Index (the three list-gallery tabs) ───────────────────────────────
  'site.index.decks': { description: "Heading of the front page's decks tab." },
  'site.index.collections': { description: "Heading of the front page's collections tab." },
  'site.index.wanted': {
    description:
      "Heading of the front page's wanted-lists tab. A wanted list records cards the reader is looking for.",
  },
  'site.index.viewAllDecks': {
    description:
      "Button beside the decks heading, opening every deck's cards together in one combined view.",
  },
  'site.index.viewAllWanted': {
    description: 'Button beside the wanted-lists heading, opening every wanted list together.',
  },
  'site.index.viewAllMenu': {
    description:
      'Button beside the collections heading, opening a menu of combined views. The trailing ellipsis marks it as opening a menu rather than navigating.',
  },
  'site.index.viewAllMenuTitle': { description: 'Accessible name of that menu.' },
  'site.index.viewAllCollections': { description: `${VIEW_ALL_CONTEXT} No filter: every card.` },
  'site.index.viewAllSale': { description: VIEW_ALL_CONTEXT },
  'site.index.viewAllTrade': { description: VIEW_ALL_CONTEXT },
  'site.index.viewAllSaleOrTrade': {
    description: `${VIEW_ALL_CONTEXT} Cards carrying either label.`,
  },
  'site.index.viewAllKeep': { description: VIEW_ALL_CONTEXT },
  'site.index.viewAllProxy': {
    description: `${VIEW_ALL_CONTEXT} Cards labeled as proxies — stand-in printouts rather than real cards.`,
  },
  'site.index.commander': {
    description:
      "Subtitle on a deck cover naming the deck's commander — the single legendary creature a Commander deck is built around. {name} is the card name and is never translated.",
  },
  'site.index.sortAlphabetical': { description: INDEX_SORT_CONTEXT },
  'site.index.sortRecent': {
    description: `${INDEX_SORT_CONTEXT} Newest first; lists with no recorded edit sort last.`,
  },
  'site.index.sortPrice': {
    description: `${INDEX_SORT_CONTEXT} By what the list is worth at today's prices, dearest first.`,
  },
  'site.index.sortLowestPrice': {
    description: `${INDEX_SORT_CONTEXT} By what the list would cost buying the cheapest printing of every card. Decks only.`,
  },
  'site.index.groupNone': {
    description: 'The "no grouping" row of the decks tab\'s Group dropdown.',
  },
  'site.index.groupFormat': {
    description:
      'The "group by format" row of the decks tab\'s Group dropdown — Commander, Modern and so on (see domain.deckFormat.*).',
  },
  'site.index.otherFormat': {
    description:
      'Heading of the trailing group holding decks whose format Ritual could not detect. Always sorts last.',
  },

  // ── Page stat line ────────────────────────────────────────────────────
  'site.stats.filtered': {
    description:
      'Label of the stat showing what the *visible* cards are worth while a filter is narrowing the page, shown beside the list total.',
  },
  'site.stats.selected': {
    description: 'Label of the stat showing what the currently selected cards are worth.',
  },
  'site.stats.sellValue': {
    description:
      'Label of the stat showing what a shop would pay for the selected cards, capped at the quantity it is actually buying. Sell mode only.',
  },
  'site.stats.buylistTotal': {
    description:
      'Label of the stat showing what a shop would pay for every card in the currently visible (filtered) list, capped at the quantities it is actually buying. Sell mode only.',
  },
  'site.stats.buylistUnavailable': {
    description:
      'Warning shown when sell mode can quote nothing at all. {reason} is a separate, already-rendered explanation and ends without punctuation.',
  },

  // ── Price refresh ─────────────────────────────────────────────────────
  'site.prices.update': {
    description:
      'Button that re-fetches prices for the cards on the page, replacing the ones baked in when the site was built.',
  },
  'site.prices.updating': {
    description: 'The same button while the fetch is in flight; it is disabled meanwhile.',
  },

  // ── Quick switch (Ctrl-K) ─────────────────────────────────────────────
  'site.quickSwitch.title': {
    description:
      'Accessible name of the Ctrl-K dialog that jumps to any list, commander, card or printing.',
  },
  'site.quickSwitch.placeholder': {
    description: 'Placeholder of the Quick Switch search field.',
  },
  'site.quickSwitch.noMatches': {
    description: 'Shown in place of the results when nothing matches what was typed.',
  },
  'site.quickSwitch.navigate': { description: QUICK_SWITCH_KEY_CONTEXT },
  'site.quickSwitch.open': { description: QUICK_SWITCH_KEY_CONTEXT },
  'site.quickSwitch.close': { description: QUICK_SWITCH_KEY_CONTEXT },
  'site.quickSwitch.kindDeck': { description: QUICK_SWITCH_KIND_CONTEXT },
  'site.quickSwitch.kindCollection': { description: QUICK_SWITCH_KIND_CONTEXT },
  'site.quickSwitch.kindWanted': { description: QUICK_SWITCH_KIND_CONTEXT },
  'site.quickSwitch.kindCommander': { description: QUICK_SWITCH_KIND_CONTEXT },
  'site.quickSwitch.kindCard': { description: QUICK_SWITCH_KIND_CONTEXT },
  'site.quickSwitch.kindPrinting': {
    description: `${QUICK_SWITCH_KIND_CONTEXT} A printing is one specific release of a card, identified by set code and collector number.`,
  },
  'site.quickSwitch.inDeck': { description: QUICK_SWITCH_PARENT_CONTEXT },
  'site.quickSwitch.inCollection': { description: QUICK_SWITCH_PARENT_CONTEXT },
  'site.quickSwitch.inWanted': { description: QUICK_SWITCH_PARENT_CONTEXT },
  'site.quickSwitch.quantity': {
    description:
      'Copy-count badge on a Quick Switch card or printing result row; {count} is how many copies the list holds. The English "×" is the multiplication sign used as a count marker.',
  },

  // ── Theme picker and editor ───────────────────────────────────────────
  'site.theme.pickerTitle': {
    description: 'Accessible name of the popover listing the built-in colour themes.',
  },
  'site.theme.builtIn': { description: 'Accessible name of the theme list inside that popover.' },
  'site.theme.customized': {
    description:
      'Badge in the theme popover meaning the reader has tweaked individual colours on top of the chosen theme.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.theme.customize': {
    description:
      'Footer button of the theme popover, opening the full editor. The trailing ellipsis marks it as opening something.',
  },
  'site.theme.closeEditor': {
    description:
      "The same footer button while the editor is open, and the tooltip of the editor's own ✕ button.",
  },
  'site.theme.discardTitle': {
    description:
      "Accessible name of the confirmation shown when switching theme would throw away the reader's own colour tweaks.",
  },
  'site.theme.discardMessage': {
    description:
      'Body of that confirmation. {theme} is the name of the theme being switched to and is rendered in bold — it may sit anywhere in the sentence.',
  },
  'site.theme.discardConfirm': {
    description:
      'The confirming button of that dialog: throw the tweaks away and switch anyway. The cancelling button uses ui.dialog.cancel.',
  },
  'site.theme.editorTitle': {
    description:
      'Title of the theme editor toolbar, and its accessible region name. It sits across the top of the viewport.',
  },
  'site.theme.baseLabel': {
    description:
      "Label of the theme editor's dropdown choosing which built-in theme the tweaks apply on top of, including its trailing colon.",
  },
  'site.theme.customNameLabel': {
    description:
      "Label of the field naming the theme being edited, including its trailing colon. The name becomes the downloaded file's name, so it stays a plain lowercase slug.",
  },
  'site.theme.resetAll': {
    description: `${THEME_EDITOR_CONTEXT} Drops every tweak, leaving the base theme untouched.`,
  },
  'site.theme.import': {
    description: `${THEME_EDITOR_CONTEXT} Loads a previously downloaded theme file.`,
  },
  'site.theme.downloadJson': {
    description: `${THEME_EDITOR_CONTEXT} Saves the current colours as a JSON file, which can be handed back to \`ritual build-site --theme-file\`. "JSON" is a file format and is not translated.`,
  },
  'site.theme.readError': {
    description: 'Error shown when a picked theme file could not be read from disk at all.',
  },
  'site.theme.invalidJson': {
    description:
      "Error shown when a picked theme file is not valid JSON. {error} is the parser's own English message.",
  },
  'site.theme.editVar': {
    description:
      "Accessible name of the popover editing one theme variable. {name} is that variable's display name.",
  },
  'site.theme.resetVar': {
    description:
      "Button inside that popover dropping this one variable's tweak, so the base theme shows through again.",
  },
  'site.theme.rawValue': {
    description:
      'Label of the fallback text field shown when a theme variable holds something the colour picker cannot parse, so it has to be edited as text.',
  },
  'site.theme.rawHint': { description: 'Hint under that fallback field.' },
  'site.theme.colorPreview': {
    description: 'Accessible name of the swatch previewing the colour being edited.',
  },
  // ── Theme editor: variable groups and swatches ────────────────────────
  // Evaluated once at import by `src/site/theme-vars-metadata.ts`, so that
  // table holds these keys and the editor resolves them per render.
  // ── Groups (the editor's tab row) ─────────────────────────────────────
  'site.themeGroup.surfaces.label': {
    description: 'Name of the "Surfaces" tab in the theme editor.',
  },
  'site.themeGroup.surfaces.description': {
    description: 'Tooltip on the "Surfaces" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.borders.label': {
    description: 'Name of the "Borders" tab in the theme editor.',
  },
  'site.themeGroup.borders.description': {
    description: 'Tooltip on the "Borders" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.text.label': { description: 'Name of the "Text" tab in the theme editor.' },
  'site.themeGroup.text.description': {
    description: 'Tooltip on the "Text" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.accent.label': { description: 'Name of the "Accent" tab in the theme editor.' },
  'site.themeGroup.accent.description': {
    description: 'Tooltip on the "Accent" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.buttons.label': {
    description: 'Name of the "Buttons" tab in the theme editor.',
  },
  'site.themeGroup.buttons.description': {
    description: 'Tooltip on the "Buttons" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.status.label': { description: 'Name of the "Status" tab in the theme editor.' },
  'site.themeGroup.status.description': {
    description: 'Tooltip on the "Status" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.overlays.label': {
    description: 'Name of the "Overlays" tab in the theme editor.',
  },
  'site.themeGroup.overlays.description': {
    description: 'Tooltip on the "Overlays" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.modals.label': { description: 'Name of the "Modals" tab in the theme editor.' },
  'site.themeGroup.modals.description': {
    description: 'Tooltip on the "Modals" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.flame.label': {
    description: 'Name of the "Flame icon" tab in the theme editor.',
  },
  'site.themeGroup.flame.description': {
    description: 'Tooltip on the "Flame icon" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.labels.label': { description: 'Name of the "Labels" tab in the theme editor.' },
  'site.themeGroup.labels.description': {
    description: 'Tooltip on the "Labels" tab, summarizing which theme variables it holds.',
  },
  'site.themeGroup.misc.label': { description: 'Name of the "Misc" tab in the theme editor.' },
  'site.themeGroup.misc.description': {
    description: 'Tooltip on the "Misc" tab, summarizing which theme variables it holds.',
  },

  // ── Variables (one swatch each) ───────────────────────────────────────
  'site.themeVar.bgBody.label': {
    description: 'Swatch label for the `--bg-body` CSS variable in the theme editor.',
  },
  'site.themeVar.bgBody.description': {
    description: 'Tooltip for the `--bg-body` swatch, explaining what the variable colors.',
  },
  'site.themeVar.bgPanel.label': {
    description: 'Swatch label for the `--bg-panel` CSS variable in the theme editor.',
  },
  'site.themeVar.bgPanel.description': {
    description: 'Tooltip for the `--bg-panel` swatch, explaining what the variable colors.',
  },
  'site.themeVar.bgHover.label': {
    description: 'Swatch label for the `--bg-hover` CSS variable in the theme editor.',
  },
  'site.themeVar.bgHover.description': {
    description: 'Tooltip for the `--bg-hover` swatch, explaining what the variable colors.',
  },
  'site.themeVar.bgActive.label': {
    description: 'Swatch label for the `--bg-active` CSS variable in the theme editor.',
  },
  'site.themeVar.bgActive.description': {
    description: 'Tooltip for the `--bg-active` swatch, explaining what the variable colors.',
  },
  'site.themeVar.bgSubtle.label': {
    description: 'Swatch label for the `--bg-subtle` CSS variable in the theme editor.',
  },
  'site.themeVar.bgSubtle.description': {
    description: 'Tooltip for the `--bg-subtle` swatch, explaining what the variable colors.',
  },
  'site.themeVar.border.label': {
    description: 'Swatch label for the `--border` CSS variable in the theme editor.',
  },
  'site.themeVar.border.description': {
    description: 'Tooltip for the `--border` swatch, explaining what the variable colors.',
  },
  'site.themeVar.borderHover.label': {
    description: 'Swatch label for the `--border-hover` CSS variable in the theme editor.',
  },
  'site.themeVar.borderHover.description': {
    description: 'Tooltip for the `--border-hover` swatch, explaining what the variable colors.',
  },
  'site.themeVar.borderFocus.label': {
    description: 'Swatch label for the `--border-focus` CSS variable in the theme editor.',
  },
  'site.themeVar.borderFocus.description': {
    description: 'Tooltip for the `--border-focus` swatch, explaining what the variable colors.',
  },
  'site.themeVar.borderSeparator.label': {
    description: 'Swatch label for the `--border-separator` CSS variable in the theme editor.',
  },
  'site.themeVar.borderSeparator.description': {
    description:
      'Tooltip for the `--border-separator` swatch, explaining what the variable colors.',
  },
  'site.themeVar.textPrimary.label': {
    description: 'Swatch label for the `--text-primary` CSS variable in the theme editor.',
  },
  'site.themeVar.textPrimary.description': {
    description: 'Tooltip for the `--text-primary` swatch, explaining what the variable colors.',
  },
  'site.themeVar.textBody.label': {
    description: 'Swatch label for the `--text-body` CSS variable in the theme editor.',
  },
  'site.themeVar.textBody.description': {
    description: 'Tooltip for the `--text-body` swatch, explaining what the variable colors.',
  },
  'site.themeVar.textSecondary.label': {
    description: 'Swatch label for the `--text-secondary` CSS variable in the theme editor.',
  },
  'site.themeVar.textSecondary.description': {
    description: 'Tooltip for the `--text-secondary` swatch, explaining what the variable colors.',
  },
  'site.themeVar.textMuted.label': {
    description: 'Swatch label for the `--text-muted` CSS variable in the theme editor.',
  },
  'site.themeVar.textMuted.description': {
    description: 'Tooltip for the `--text-muted` swatch, explaining what the variable colors.',
  },
  'site.themeVar.textDim.label': {
    description: 'Swatch label for the `--text-dim` CSS variable in the theme editor.',
  },
  'site.themeVar.textDim.description': {
    description: 'Tooltip for the `--text-dim` swatch, explaining what the variable colors.',
  },
  'site.themeVar.textAccent.label': {
    description: 'Swatch label for the `--text-accent` CSS variable in the theme editor.',
  },
  'site.themeVar.textAccent.description': {
    description: 'Tooltip for the `--text-accent` swatch, explaining what the variable colors.',
  },
  'site.themeVar.accent.label': {
    description: 'Swatch label for the `--accent` CSS variable in the theme editor.',
  },
  'site.themeVar.accent.description': {
    description: 'Tooltip for the `--accent` swatch, explaining what the variable colors.',
  },
  'site.themeVar.accentHover.label': {
    description: 'Swatch label for the `--accent-hover` CSS variable in the theme editor.',
  },
  'site.themeVar.accentHover.description': {
    description: 'Tooltip for the `--accent-hover` swatch, explaining what the variable colors.',
  },
  'site.themeVar.accentDim.label': {
    description: 'Swatch label for the `--accent-dim` CSS variable in the theme editor.',
  },
  'site.themeVar.accentDim.description': {
    description: 'Tooltip for the `--accent-dim` swatch, explaining what the variable colors.',
  },
  'site.themeVar.cardLink.label': {
    description: 'Swatch label for the `--card-link` CSS variable in the theme editor.',
  },
  'site.themeVar.cardLink.description': {
    description: 'Tooltip for the `--card-link` swatch, explaining what the variable colors.',
  },
  'site.themeVar.cardLinkHover.label': {
    description: 'Swatch label for the `--card-link-hover` CSS variable in the theme editor.',
  },
  'site.themeVar.cardLinkHover.description': {
    description: 'Tooltip for the `--card-link-hover` swatch, explaining what the variable colors.',
  },
  'site.themeVar.progressEnd.label': {
    description: 'Swatch label for the `--progress-end` CSS variable in the theme editor.',
  },
  'site.themeVar.progressEnd.description': {
    description: 'Tooltip for the `--progress-end` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnBg.label': {
    description: 'Swatch label for the `--btn-bg` CSS variable in the theme editor.',
  },
  'site.themeVar.btnBg.description': {
    description: 'Tooltip for the `--btn-bg` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnHover.label': {
    description: 'Swatch label for the `--btn-hover` CSS variable in the theme editor.',
  },
  'site.themeVar.btnHover.description': {
    description: 'Tooltip for the `--btn-hover` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnText.label': {
    description: 'Swatch label for the `--btn-text` CSS variable in the theme editor.',
  },
  'site.themeVar.btnText.description': {
    description: 'Tooltip for the `--btn-text` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnPrimary.label': {
    description: 'Swatch label for the `--btn-primary` CSS variable in the theme editor.',
  },
  'site.themeVar.btnPrimary.description': {
    description: 'Tooltip for the `--btn-primary` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnPrimaryHover.label': {
    description: 'Swatch label for the `--btn-primary-hover` CSS variable in the theme editor.',
  },
  'site.themeVar.btnPrimaryHover.description': {
    description:
      'Tooltip for the `--btn-primary-hover` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnDanger.label': {
    description: 'Swatch label for the `--btn-danger` CSS variable in the theme editor.',
  },
  'site.themeVar.btnDanger.description': {
    description: 'Tooltip for the `--btn-danger` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnDangerHover.label': {
    description: 'Swatch label for the `--btn-danger-hover` CSS variable in the theme editor.',
  },
  'site.themeVar.btnDangerHover.description': {
    description:
      'Tooltip for the `--btn-danger-hover` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnExport.label': {
    description: 'Swatch label for the `--btn-export` CSS variable in the theme editor.',
  },
  'site.themeVar.btnExport.description': {
    description: 'Tooltip for the `--btn-export` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnExportHover.label': {
    description: 'Swatch label for the `--btn-export-hover` CSS variable in the theme editor.',
  },
  'site.themeVar.btnExportHover.description': {
    description:
      'Tooltip for the `--btn-export-hover` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnAdd.label': {
    description: 'Swatch label for the `--btn-add` CSS variable in the theme editor.',
  },
  'site.themeVar.btnAdd.description': {
    description: 'Tooltip for the `--btn-add` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnAddHover.label': {
    description: 'Swatch label for the `--btn-add-hover` CSS variable in the theme editor.',
  },
  'site.themeVar.btnAddHover.description': {
    description: 'Tooltip for the `--btn-add-hover` swatch, explaining what the variable colors.',
  },
  'site.themeVar.btnOnColorText.label': {
    description: 'Swatch label for the `--btn-on-color-text` CSS variable in the theme editor.',
  },
  'site.themeVar.btnOnColorText.description': {
    description:
      'Tooltip for the `--btn-on-color-text` swatch, explaining what the variable colors.',
  },
  'site.themeVar.successBg.label': {
    description: 'Swatch label for the `--success-bg` CSS variable in the theme editor.',
  },
  'site.themeVar.successBg.description': {
    description: 'Tooltip for the `--success-bg` swatch, explaining what the variable colors.',
  },
  'site.themeVar.successBorder.label': {
    description: 'Swatch label for the `--success-border` CSS variable in the theme editor.',
  },
  'site.themeVar.successBorder.description': {
    description: 'Tooltip for the `--success-border` swatch, explaining what the variable colors.',
  },
  'site.themeVar.successText.label': {
    description: 'Swatch label for the `--success-text` CSS variable in the theme editor.',
  },
  'site.themeVar.successText.description': {
    description: 'Tooltip for the `--success-text` swatch, explaining what the variable colors.',
  },
  'site.themeVar.error.label': {
    description: 'Swatch label for the `--error` CSS variable in the theme editor.',
  },
  'site.themeVar.error.description': {
    description: 'Tooltip for the `--error` swatch, explaining what the variable colors.',
  },
  'site.themeVar.errorBg.label': {
    description: 'Swatch label for the `--error-bg` CSS variable in the theme editor.',
  },
  'site.themeVar.errorBg.description': {
    description: 'Tooltip for the `--error-bg` swatch, explaining what the variable colors.',
  },
  'site.themeVar.errorBorder.label': {
    description: 'Swatch label for the `--error-border` CSS variable in the theme editor.',
  },
  'site.themeVar.errorBorder.description': {
    description: 'Tooltip for the `--error-border` swatch, explaining what the variable colors.',
  },
  'site.themeVar.errorText.label': {
    description: 'Swatch label for the `--error-text` CSS variable in the theme editor.',
  },
  'site.themeVar.errorText.description': {
    description: 'Tooltip for the `--error-text` swatch, explaining what the variable colors.',
  },
  'site.themeVar.warningBg.label': {
    description: 'Swatch label for the `--warning-bg` CSS variable in the theme editor.',
  },
  'site.themeVar.warningBg.description': {
    description: 'Tooltip for the `--warning-bg` swatch, explaining what the variable colors.',
  },
  'site.themeVar.warningBorder.label': {
    description: 'Swatch label for the `--warning-border` CSS variable in the theme editor.',
  },
  'site.themeVar.warningBorder.description': {
    description: 'Tooltip for the `--warning-border` swatch, explaining what the variable colors.',
  },
  'site.themeVar.warningText.label': {
    description: 'Swatch label for the `--warning-text` CSS variable in the theme editor.',
  },
  'site.themeVar.warningText.description': {
    description: 'Tooltip for the `--warning-text` swatch, explaining what the variable colors.',
  },
  'site.themeVar.labelSale.label': {
    description: 'Swatch label for the `--label-sale` CSS variable in the theme editor.',
  },
  'site.themeVar.labelSale.description': {
    description: 'Tooltip for the `--label-sale` swatch, explaining what the variable colors.',
  },
  'site.themeVar.labelTrade.label': {
    description: 'Swatch label for the `--label-trade` CSS variable in the theme editor.',
  },
  'site.themeVar.labelTrade.description': {
    description: 'Tooltip for the `--label-trade` swatch, explaining what the variable colors.',
  },
  'site.themeVar.labelKeep.label': {
    description: 'Swatch label for the `--label-keep` CSS variable in the theme editor.',
  },
  'site.themeVar.labelKeep.description': {
    description: 'Tooltip for the `--label-keep` swatch, explaining what the variable colors.',
  },
  'site.themeVar.labelProxy.label': {
    description: 'Swatch label for the `--label-proxy` CSS variable in the theme editor.',
  },
  'site.themeVar.labelProxy.description': {
    description: 'Tooltip for the `--label-proxy` swatch, explaining what the variable colors.',
  },
  'site.themeVar.overlayLight.label': {
    description: 'Swatch label for the `--overlay-light` CSS variable in the theme editor.',
  },
  'site.themeVar.overlayLight.description': {
    description: 'Tooltip for the `--overlay-light` swatch, explaining what the variable colors.',
  },
  'site.themeVar.overlayMedium.label': {
    description: 'Swatch label for the `--overlay-medium` CSS variable in the theme editor.',
  },
  'site.themeVar.overlayMedium.description': {
    description: 'Tooltip for the `--overlay-medium` swatch, explaining what the variable colors.',
  },
  'site.themeVar.overlayHeavy.label': {
    description: 'Swatch label for the `--overlay-heavy` CSS variable in the theme editor.',
  },
  'site.themeVar.overlayHeavy.description': {
    description: 'Tooltip for the `--overlay-heavy` swatch, explaining what the variable colors.',
  },
  'site.themeVar.cardLabelText.label': {
    description: 'Swatch label for the `--card-label-text` CSS variable in the theme editor.',
  },
  'site.themeVar.cardLabelText.description': {
    description: 'Tooltip for the `--card-label-text` swatch, explaining what the variable colors.',
  },
  'site.themeVar.cardLabelMeta.label': {
    description: 'Swatch label for the `--card-label-meta` CSS variable in the theme editor.',
  },
  'site.themeVar.cardLabelMeta.description': {
    description: 'Tooltip for the `--card-label-meta` swatch, explaining what the variable colors.',
  },
  'site.themeVar.cardLabelPrice.label': {
    description: 'Swatch label for the `--card-label-price` CSS variable in the theme editor.',
  },
  'site.themeVar.cardLabelPrice.description': {
    description:
      'Tooltip for the `--card-label-price` swatch, explaining what the variable colors.',
  },
  'site.themeVar.cardLabelBuylist.label': {
    description: 'Swatch label for the `--card-label-buylist` CSS variable in the theme editor.',
  },
  'site.themeVar.cardLabelBuylist.description': {
    description:
      'Tooltip for the `--card-label-buylist` swatch, explaining what the variable colors.',
  },
  'site.themeVar.modalRadius.label': {
    description: 'Swatch label for the `--modal-radius` CSS variable in the theme editor.',
  },
  'site.themeVar.modalRadius.description': {
    description: 'Tooltip for the `--modal-radius` swatch, explaining what the variable colors.',
  },
  'site.themeVar.modalShadowColor.label': {
    description: 'Swatch label for the `--modal-shadow-color` CSS variable in the theme editor.',
  },
  'site.themeVar.modalShadowColor.description': {
    description:
      'Tooltip for the `--modal-shadow-color` swatch, explaining what the variable colors.',
  },
  'site.themeVar.flameOuter1.label': {
    description: 'Swatch label for the `--flame-outer-1` CSS variable in the theme editor.',
  },
  'site.themeVar.flameOuter1.description': {
    description: 'Tooltip for the `--flame-outer-1` swatch, explaining what the variable colors.',
  },
  'site.themeVar.flameOuter2.label': {
    description: 'Swatch label for the `--flame-outer-2` CSS variable in the theme editor.',
  },
  'site.themeVar.flameOuter2.description': {
    description: 'Tooltip for the `--flame-outer-2` swatch, explaining what the variable colors.',
  },
  'site.themeVar.flameOuter3.label': {
    description: 'Swatch label for the `--flame-outer-3` CSS variable in the theme editor.',
  },
  'site.themeVar.flameOuter3.description': {
    description: 'Tooltip for the `--flame-outer-3` swatch, explaining what the variable colors.',
  },
  'site.themeVar.flameInner1.label': {
    description: 'Swatch label for the `--flame-inner-1` CSS variable in the theme editor.',
  },
  'site.themeVar.flameInner1.description': {
    description: 'Tooltip for the `--flame-inner-1` swatch, explaining what the variable colors.',
  },
  'site.themeVar.flameInner2.label': {
    description: 'Swatch label for the `--flame-inner-2` CSS variable in the theme editor.',
  },
  'site.themeVar.flameInner2.description': {
    description: 'Tooltip for the `--flame-inner-2` swatch, explaining what the variable colors.',
  },
  'site.themeVar.flameInner3.label': {
    description: 'Swatch label for the `--flame-inner-3` CSS variable in the theme editor.',
  },
  'site.themeVar.flameInner3.description': {
    description: 'Tooltip for the `--flame-inner-3` swatch, explaining what the variable colors.',
  },
  'site.themeVar.cardRadius.label': {
    description: 'Swatch label for the `--card-radius` CSS variable in the theme editor.',
  },
  'site.themeVar.cardRadius.description': {
    description: 'Tooltip for the `--card-radius` swatch, explaining what the variable colors.',
  },
} as const satisfies MetaFor<typeof siteChromeMessages>
