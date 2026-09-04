/** Translator metadata for the `site-pages` fragment. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { sitePagesMessages } from './site-pages'

export const sitePagesMeta = {
  // ── Shared list-page chrome ───────────────────────────────────────────
  'site.page.combineWithList': {
    description:
      'Header button on a deck/collection/wanted page that opens the "view several lists together" picker. The ellipsis marks it as opening a dialog.',
  },
  'site.list.readMore': {
    description:
      "Link that expands a truncated list description (any list type) or a deck's collapsed primer.",
  },
  'site.list.showLess': {
    description: 'Link that collapses an expanded list description or a deck primer.',
  },
  'site.page.viewChanges': {
    description:
      'Header button on a list page that opens the change history (changelog) modal for that list.',
  },
  'site.stats.total': {
    description:
      'Deck page summary line. {amount} is an already-formatted money value in the selected currency.',
  },
  'site.stats.cardsAndTotal': {
    description:
      'Collection / wanted / combined summary line: how many cards the list holds and what they are worth. {count} is a whole number, {amount} an already-formatted money value.',
  },

  // ── Group-by options ──────────────────────────────────────────────────
  'site.groupBy.section': {
    description: 'Toolbar "Group by" choice: group cards by the list section they are filed under.',
  },
  'site.groupBy.type': {
    description: 'Toolbar "Group by" choice: group cards by card type (Creature, Instant, …).',
  },
  'site.groupBy.cmc': {
    description:
      'Toolbar "Group by" choice: group cards by mana value (the Magic term for converted mana cost).',
  },
  'site.groupBy.colorIdentity': {
    description: 'Toolbar "Group by" choice: group cards by their Magic color identity.',
  },
  'site.groupBy.price': { description: 'Toolbar "Group by" choice: group cards into price bands.' },
  'site.groupBy.printing': {
    description:
      'Toolbar "Group by" choice: group cards by whether the entry pins a specific printing.',
  },
  'site.groupBy.source': {
    description:
      'Toolbar "Group by" choice in the combined view: group cards by which list they came from.',
  },
  'site.groupBy.tags': {
    description:
      'Toolbar "Group by" choice: group cards by the owner\'s own tag set (one group per distinct set of tags).',
  },
  'site.groupBy.untagged': {
    description:
      'Heading of the group holding cards that carry no tag at all when grouping by tags. Shown last.',
  },
  'site.groupBy.category': {
    description: 'Toolbar grouping that puts each card under its primary category only.',
  },
  'site.groupBy.categories': {
    description:
      'Toolbar grouping that shows a card under every category it holds; the non-primary appearances are dimmed.',
  },
  'site.groupBy.uncategorized': {
    description: 'Heading for the group of cards with no categories; always shown last.',
  },
  'site.cardSection.alsoMarker': {
    description:
      'Tiny badge on a card shown under a category that is not its primary one. Keep it very short — it sits on the card image.',
  },
  'site.cardSection.alsoTitle': {
    description: 'Tooltip on the "also" badge. {primary} is the card\'s own first category.',
  },
  'site.cardSection.secondaryCountNote': {
    description:
      'Note beside a group\'s card count under the "Categories" grouping, where one card can appear in several groups.',
  },
  'site.cardSection.boardCategoryHeading': {
    description:
      'Heading for a category group nested inside one board of a deck: the board name, then the category. Both halves are data — a deck section name and a category name — so translate only the separator and the order.',
  },
  'site.groupBy.none': { description: 'Toolbar "Group by" choice: do not group at all.' },
  'site.sortBy.tags': {
    description: 'Toolbar "Sort by" choice: order cards by their tag set, untagged cards last.',
  },
  'site.sortBy.category': {
    description: 'Toolbar sort field: orders cards by their primary category, uncategorized last.',
  },

  // ── Export menu ───────────────────────────────────────────────────────
  'site.export.copy': {
    description: 'Export menu button that copies the serialized list to the clipboard.',
  },
  'site.export.download': {
    description: 'Export menu button that downloads the serialized list as a file.',
  },
  'site.export.copyFormat': {
    description: 'Accessible title of the dropdown listing the formats the Copy button can copy.',
  },
  'site.export.downloadFormat': {
    description:
      'Accessible title of the dropdown listing the formats the Download button can write.',
  },
  'site.export.copied': {
    description: 'Brief confirmation shown after the list was copied to the clipboard.',
  },
  'site.export.copyFailed': {
    description: 'Brief notice shown when the browser refused clipboard access.',
  },
  'site.export.downloaded': {
    description: 'Brief confirmation shown after a file was downloaded.',
  },
  'site.export.formatTxt': {
    description: 'Export format choice: plain text. Keep the ".txt" extension as written.',
  },
  'site.export.formatMd': {
    description: 'Export format choice: Markdown. Keep the ".md" extension as written.',
  },
  'site.export.formatCsv': {
    description: 'Export format choice: CSV. Keep the ".csv" extension as written.',
  },
  'site.export.buyerCart': {
    description:
      'Export format choice for a buylist cart file. {buyer} is a store name such as "Card Kingdom"; keep the ".csv" extension as written.',
  },

  // ── App shell ─────────────────────────────────────────────────────────
  'site.app.live': {
    description: 'Header badge shown when a live backend is answering. Keep it very short.',
    maxLen: 10,
  },
  'site.app.offline': {
    description:
      'Header badge shown when the live backend is unreachable and baked data is being used. Keep it very short.',
    maxLen: 10,
  },
  'site.app.liveTitle': { description: 'Tooltip explaining the "Live" header badge.' },
  'site.app.offlineTitle': { description: 'Tooltip explaining the "Offline" header badge.' },
  'site.app.quickSwitch': {
    description: 'Label on the header button that opens the quick-switch list jumper.',
    maxLen: 18,
  },
  'site.app.quickSwitchTitle': {
    description:
      'Tooltip on the quick-switch button. "Ctrl+K" is a key combination and stays as written.',
  },
  'site.app.quickSwitchAria': {
    description:
      'Screen-reader label for the quick-switch button. "Ctrl+K" is a key combination and stays as written.',
  },
  'site.app.allSelected': {
    description:
      'Label on the header button summarising the cross-list card selection; a count in parentheses is appended by the component.',
    maxLen: 18,
  },
  'site.app.clearAllSelections': {
    description: 'Menu action that clears the card selection across every list.',
  },
  'site.app.showDisplayOptions': {
    description:
      'Screen-reader label for the phone-layout gear button when the display-options row is collapsed.',
  },
  'site.app.hideDisplayOptions': {
    description:
      'Screen-reader label for the phone-layout gear button when the display-options row is open.',
  },
  'site.app.displayOptions': { description: 'Tooltip on the phone-layout gear button.' },
  'site.app.editModeHint': {
    description:
      'Banner shown when site-wide edit mode is on but the current page has no list to edit.',
  },
  'site.app.export': {
    description:
      'Edit-mode banner button that opens the export panel. The ellipsis marks it as opening a dialog.',
  },
  'site.app.pricesDate': {
    description:
      'Line under the header stating how fresh the prices are. {date} is an already-formatted long date.',
  },
  'site.app.generatedBy': {
    description:
      'Site footer credit. {tool} is rendered as a link to the project and reads "ritual" — the program name, which is not translated.',
  },
  'site.app.tradeToastAdded': {
    description:
      'Transient toast confirming a card joined the trade board. {name} is the card name. "Trade" is the name of the trade page.',
  },
  'site.app.removeSelectedConfirm': {
    description:
      'Confirm button in the dialog that removes every selected card from its list. Destructive.',
  },
  'site.app.keepTradeTitle': {
    description:
      'Title of the dialog shown when adding a card labeled "To keep" to a trade. {name} is the card name; the quoted phrase is the label\'s own name (domain.label.keep).',
  },
  'site.app.keepTradeMessage': {
    description:
      'Body of the "To keep" trade confirmation. The quoted phrase is the label\'s own name (domain.label.keep).',
  },
  'site.app.keepTradeConfirm': {
    description: 'Confirm button on the "To keep" trade dialog: add the card despite the label.',
  },

  // ── Deck page ─────────────────────────────────────────────────────────
  'site.deck.allCardsPrice': {
    description:
      'Parenthetical after a deck total, giving the price including maybeboard and token sections. {amount} is an already-formatted money value.',
  },
  'site.deck.importedFrom': {
    description:
      'Link under a deck title crediting where it was imported from. {source} is a site name such as Moxfield or Archidekt; the arrow marks an external link.',
  },
  'site.deck.sourceGeneric': {
    description:
      'Fallback for {source} in site.deck.importedFrom when the deck\'s URL matches no known site — "Source" as a generic noun.',
  },
  'site.deck.lowestPrice': {
    description:
      'Toolbar toggle that swaps each card for its cheapest printing rather than the one the deck pins.',
    maxLen: 20,
  },
  'site.deck.lowestPriceEditDisabled': {
    description:
      'Hover tooltip on the disabled "Lowest Price" toolbar toggle, explaining that edit mode pins the view to the printings the deck actually names.',
  },
  'site.deck.hasPrimer': {
    description:
      'Teaser shown when a deck has a long-form primer that is currently collapsed. A "primer" is a written deck guide.',
  },
  'site.deck.primerContents': {
    description: 'Heading of the primer sidebar listing its section links — a table of contents.',
  },

  // ── Collection page ───────────────────────────────────────────────────
  'site.collection.groupDuplicates': {
    description:
      'Toolbar toggle that merges identical copies of a card into one tile with a count.',
    maxLen: 22,
  },

  // ── Wanted list page ──────────────────────────────────────────────────
  'site.wanted.anyPrinting': {
    description:
      'Card modal note: this wanted entry names only a card, so any printing of it satisfies the want.',
  },
  'site.wanted.anyFinish': {
    description:
      'Card modal note: this wanted entry pins a printing but no finish, so foil or nonfoil satisfies it.',
  },

  // ── Combined list view ────────────────────────────────────────────────
  'site.combined.title': {
    description: 'Page title when several individually chosen lists are viewed together.',
  },
  'site.combined.allCards': {
    description: 'Page title when every list of every kind is viewed together.',
  },
  'site.combined.allOfType': {
    description:
      'Page title when every list of one kind is viewed together. Branches on the list type.',
  },
  'site.combined.viewingAll': {
    description: 'Sub-heading under site.combined.allCards, restating the scope of the view.',
  },
  'site.combined.viewingAllOfType': {
    description:
      'Sub-heading under site.combined.allOfType, restating the scope of the view. Branches on the list type.',
  },
  'site.combined.combining': {
    description:
      'Label introducing the comma-separated list of source lists being viewed together; the names follow as links.',
  },
  'site.combined.loadFailed': {
    description: 'Error banner shown when one or more of the combined lists could not be fetched.',
  },
  'site.combined.empty': {
    description: 'Shown when a combined view has loaded successfully but holds no cards.',
  },

  // ── Search results page ───────────────────────────────────────────────
  'site.searchResults.title': {
    description: 'Page title for the Find page\'s "View Selected as List" result view.',
  },
  'site.searchResults.empty': {
    description: 'Shown when the search-results view holds no cards.',
  },
  'site.searchResults.from': {
    description:
      'Label introducing the comma-separated list of lists the matched cards came from; the names follow as links.',
  },
  'site.searchResults.none': {
    description:
      'Shown when the search-results page is opened with no pending search. {link} is rendered as a link whose text is site.searchResults.goToFind.',
  },
  'site.searchResults.goToFind': {
    description: 'Link text inside site.searchResults.none, pointing at the Find page.',
  },

  // ── Find page ─────────────────────────────────────────────────────────
  'site.find.title': { description: 'Title of the Find page, which searches every list at once.' },
  'site.find.subtitle': { description: 'One-line explanation under the Find page title.' },
  'site.find.placeholder': {
    description:
      'Placeholder inside the Find page textarea. The three names after the blank line are example Magic cards and are not translated.',
  },
  'site.find.search': { description: 'Button that runs the Find page search.' },
  'site.find.searching': { description: 'Find page search button label while the search runs.' },
  'site.find.addCards': {
    description:
      'Find page button that runs another search and merges its matches into the existing results.',
  },
  'site.find.noMatches': { description: 'Shown when a Find search matched nothing at all.' },
  'site.find.summary': {
    description:
      'Find page result summary. {cards} and {lists} are already-pluralised counted phrases such as "3 cards" and "2 lists".',
  },
  'site.find.selectAll': { description: 'Find page button that selects every matched card.' },
  'site.find.addSelectedToTrade': {
    description: 'Find page button that adds the selected cards to the trade board.',
  },
  'site.find.viewSelectedAsList': {
    description: 'Find page button that opens the selected cards as a combined list view.',
  },
  'site.find.clearSelection': { description: 'Find page button that deselects every card.' },
  'site.find.selectGroupAria': {
    description:
      "Screen-reader label for the checkbox that selects every match from one source list. {name} is that list's name.",
  },
  'site.find.scopeLabel': {
    description:
      'Label ahead of the Find page search-scope controls, which choose the list types and lists a search covers.',
  },
  'site.find.scopeCount': {
    description:
      'Compact "enabled out of total" list tally beside a list-type name in the Find page search scope, e.g. "3/5".',
  },
  'site.find.scopeExpandAria': {
    description:
      'Screen-reader label for the button expanding one list type in the Find page search scope to its per-list checkboxes. {type} is the plural list-type name, e.g. "Decks".',
  },

  // ── Trade page ────────────────────────────────────────────────────────
  'site.trade.title': {
    description: 'Title of the trade page, where two sides of a card trade are compared.',
  },
  'site.trade.updatePrices': {
    description:
      'Trade page button that refetches prices for every card on the board. The leading arrow is a refresh glyph.',
  },
  'site.trade.updatingPrices': {
    description: 'Label on the trade price-refresh button while it is running.',
  },
  'site.trade.reset': { description: 'Trade page button that clears both sides of the trade.' },
  'site.trade.copyLink': {
    description: 'Trade page button that copies a shareable link encoding the current trade.',
  },
  'site.trade.difference': {
    description:
      'Label for the money difference between the two sides of the trade; a signed amount follows.',
  },
  'site.trade.offering': {
    description: 'Heading for the left trade column — the cards you are giving away.',
  },
  'site.trade.receiving': {
    description: 'Heading for the right trade column — the cards you are getting.',
  },
  'site.trade.decodeWarningsHead': {
    description:
      'Heading of the banner listing problems found while restoring a trade from a shared link.',
  },
  'site.trade.dismissWarnings': {
    description: 'Screen-reader label for the button that closes the trade warning banner.',
  },
  'site.trade.unknownSource': {
    description:
      'Trade link warning: the list a card came from no longer exists. {sourceKind} is a raw list kind (deck, collection, wanted) and {sourceName} the list name.',
  },
  'site.trade.unknownScryfallId': {
    description:
      'Trade link warning: a card identified by Scryfall id could not be fetched. {id} is that raw identifier.',
  },
  'site.trade.malformedToken': {
    description:
      'Trade link warning: part of the link could not be parsed. {token} is the raw text that failed.',
  },
  'site.trade.clearTitle': { description: 'Title of the confirmation dialog for Reset.' },
  'site.trade.clearMessage': { description: 'Body of the confirmation dialog for Reset.' },
  'site.trade.clearConfirm': {
    description: 'Confirm button in the Reset dialog. Destructive.',
  },
  'site.trade.linkCopied': {
    description: 'Toast confirming the trade link reached the clipboard.',
  },
  'site.trade.linkCopyFailed': {
    description:
      'Toast shown when the clipboard was refused; the link is still in the browser address bar.',
  },
  'site.trade.noCardsToUpdate': {
    description: 'Toast shown when the price refresh ran with no priceable cards on the board.',
  },
  'site.trade.priceUpdateFailed': {
    description: 'Toast shown when the price refresh returned nothing.',
  },
  'site.trade.cacheNote': {
    description:
      "Note under the right column's search box on a hosted site, explaining that searches are answered from the server's card cache rather than Scryfall.",
  },
  'site.trade.searchScryfall': {
    description:
      'Toggle that switches the right column\'s search from your wanted lists to Scryfall. "Scryfall" is a product name.',
  },
  'site.trade.includeDecks': {
    description: "Toggle that widens the left column's search to include cards already in decks.",
  },

  // ── Trade column ──────────────────────────────────────────────────────
  'site.tradeColumn.sort': { description: "Label before a trade column's sort buttons." },
  'site.tradeColumn.sortName': {
    description: 'Trade column sort button: order rows by card name.',
  },
  'site.tradeColumn.sortPrice': { description: 'Trade column sort button: order rows by price.' },
  'site.tradeColumn.reverse': {
    description:
      'Trade column button that reverses the sort order; shown while the order is normal. The leading arrows are a glyph.',
  },
  'site.tradeColumn.reversed': {
    description:
      'Trade column button that reverses the sort order; shown while the order is already reversed. The leading arrows are a glyph.',
  },
  'site.tradeColumn.total': {
    description: 'Label for the money total at the foot of a trade column.',
  },
  'site.tradeColumn.noSuggestions': {
    description: 'Shown in a trade search dropdown when the query matched nothing.',
  },
  'site.tradeColumn.fromDeck': {
    description:
      'Sub-line under a trade search suggestion sourced from a deck. {name} is the deck name.',
  },
  'site.tradeColumn.fromWanted': {
    description:
      'Sub-line under a trade search suggestion sourced from a wanted list. {name} is the list name.',
  },
  'site.tradeColumn.priceUnavailable': {
    description:
      'Shown in place of a price when a trade suggestion has none. Abbreviation for "not available"; keep it short.',
    maxLen: 8,
  },

  // ── Trade column search modes ─────────────────────────────────────────
  'site.tradeMode.collection.label': {
    description: 'Pill naming what the left trade column searches: your collections.',
  },
  'site.tradeMode.collection.placeholder': {
    description: 'Placeholder in the left trade column search box when it covers collections only.',
  },
  'site.tradeMode.collection.empty': {
    description: 'Shown in an empty left trade column when it covers collections only.',
  },
  'site.tradeMode.collectionDecks.label': {
    description: 'Pill naming what the left trade column searches: collections and decks together.',
  },
  'site.tradeMode.collectionDecks.placeholder': {
    description: 'Placeholder in the left trade column search box when it also covers decks.',
  },
  'site.tradeMode.collectionDecks.empty': {
    description: 'Shown in an empty left trade column when it also covers decks.',
  },
  'site.tradeMode.wanted.label': {
    description: 'Pill naming what the right trade column searches: your wanted lists.',
  },
  'site.tradeMode.wanted.placeholder': {
    description: 'Placeholder in the right trade column search box when it covers wanted lists.',
  },
  'site.tradeMode.wanted.empty': {
    description: 'Shown in an empty right trade column when it covers wanted lists.',
  },
  'site.tradeMode.scryfall.label': {
    description: 'Pill naming what the right trade column searches: Scryfall, a product name.',
  },
  'site.tradeMode.scryfall.placeholder': {
    description:
      'Placeholder in the right trade column search box in Scryfall mode. The quoted text is Scryfall query syntax and must not be translated.',
  },
  'site.tradeMode.scryfall.empty': {
    description: 'Shown in an empty right trade column in Scryfall mode.',
  },
  'site.tradeMode.scryfall.searchLabel': {
    description:
      'Sub-line under a bare card-name suggestion in Scryfall mode, naming where it came from. A product name.',
  },
  'site.tradeMode.wantedCache.label': {
    description:
      "Pill naming what the right trade column searches on a hosted site: wanted lists plus the server's card cache.",
  },
  'site.tradeMode.wantedCache.placeholder': {
    description: 'Placeholder in the right trade column search box on a hosted site.',
  },
  'site.tradeMode.wantedCache.empty': {
    description: 'Shown in an empty right trade column on a hosted site.',
  },
  'site.tradeMode.wantedCache.searchLabel': {
    description:
      "Sub-line under a bare card-name suggestion on a hosted site, naming where it came from — the server's card cache.",
  },

  // ── Trade card row ────────────────────────────────────────────────────
  'site.tradeRow.sourceCollection': {
    description: 'Tag on a trade row showing the card came from one of your collections.',
    maxLen: 14,
  },
  'site.tradeRow.sourceDeck': {
    description:
      'Tag on a trade row showing the card came from a deck. {name} is the deck name; the middle dot is a separator.',
  },
  'site.tradeRow.sourceWanted': {
    description: 'Tag on a trade row showing the card came from a wanted list.',
    maxLen: 14,
  },
  'site.tradeRow.keepBadge': {
    description:
      'Small badge on a trade row reminding you the card carries the "To keep" label (domain.label.keep). Keep it very short.',
    maxLen: 8,
  },
  'site.tradeRow.editPrinting': {
    description:
      'Tooltip and screen-reader label for the pencil button that reopens the printing picker for a trade row.',
  },
  'site.tradeRow.remove': {
    description: 'Tooltip on the button that takes a card off the trade board.',
  },
  'site.tradeRow.maxAvailable': {
    description:
      'Tooltip explaining why a trade row cannot go higher: {count} is how many copies the source list holds.',
  },
  'site.tradeRow.priceEach': {
    description:
      'Per-copy price under the row total when a trade row holds more than one copy. {amount} is an already-formatted money value; "ea" abbreviates "each".',
  },

  // ── Sell mode ─────────────────────────────────────────────────────────
  'site.sell.overLimit': {
    description:
      'One clause of the parenthetical after a sell value, counting copies the buyer already has enough of. {count} is a whole number.',
  },

  // ── Primer renderer ───────────────────────────────────────────────────
  'site.primer.youtubeTitle': {
    description: 'Accessible title of an embedded video frame inside a deck primer.',
  },
  'site.primer.openCard': {
    description:
      'Screen-reader label for a card name inside a primer that opens the card detail modal. {name} is the card name.',
  },

  // ── Build-time detail loaders ─────────────────────────────────────────
  'site.detail.fileNotFound': {
    description:
      'Reason given when a list file is missing while building the site. {path} is the file path.',
  },
  'site.detail.noLanguageCard': {
    description:
      'Build warning: no card object exists in the requested language, so the default-language one is used. {language} is a Scryfall language code, {name} the card name, {printing} its set and collector number.',
  },
  'site.detail.artUnreadable': {
    description:
      "Build warning: a list's custom-art sidecar could not be read, so no custom art is used for that list. {reason} is the parser's English explanation.",
  },
  'site.detail.artUnknownCards': {
    description:
      'Build warning: the custom-art sidecar names card ids that the list no longer contains. {ids} is a comma-separated list of those raw numeric ids.',
  },
  'site.detail.categoriesUnreadable': {
    description:
      "Build/load warning when a list's `.categories.json` is malformed. {reason} is the parser's own English explanation.",
  },
  'site.detail.categoriesUnknownCards': {
    description:
      'Build/load warning listing sidecar entries with no matching card line. {names} is a comma-separated list of the names exactly as the sidecar stores them.',
  },
  'site.detail.listDescriptionInvalid': {
    description:
      "Build warning: a list's front-matter 'description' key holds a value that is not text, so no blurb is shown. {reason} is the parser's own English explanation and is not translated.",
  },
  'site.detail.listImageInvalid': {
    description:
      "Build warning: a list's front-matter 'image' key holds a value the cover grammar cannot read, so the built-in cover is used. {reason} is the parser's own English explanation of the shape problem and is not translated.",
  },
  'site.detail.listImageUnknownCard': {
    description:
      "Build warning: a list's front-matter 'image' key names a card line that the list no longer contains, so the built-in cover is used instead. {kind} selects the list type (machine value: deck, collection or wanted); {name} is the list's own name, never translated; {id} is the raw numeric card id, deliberately not resolved to a card name. Keep the leading '&' — it is how ids are written in the list files.",
  },
} as const satisfies MetaFor<typeof sitePagesMessages>
