/**
 * `site.*` — whole-page text on the public site: the app shell, the deck,
 * collection, wanted, combined, trade, find and search-results pages, their
 * export menus, and the build-time detail loaders that feed them.
 *
 * One of four `site` fragments (see `site-chrome.ts` for why the namespace is
 * split across files).
 */

import type { MessageCatalogShape } from '../../types'

export const sitePagesMessages = {
  // ── Shared list-page chrome ───────────────────────────────────────────
  'site.page.combineWithList': 'Combine with list…',
  'site.list.readMore': 'Read more',
  'site.list.showLess': 'Show less',
  'site.page.viewChanges': 'View Changes',
  'site.stats.total': 'Total: {amount}',
  'site.stats.cardsAndTotal': '{count} cards · Total: {amount}',

  // ── Group-by options offered by the list toolbars ─────────────────────
  'site.groupBy.section': 'Section',
  'site.groupBy.type': 'Type',
  'site.groupBy.cmc': 'Mana Value',
  'site.groupBy.colorIdentity': 'Color Identity',
  'site.groupBy.price': 'Price',
  'site.groupBy.printing': 'Printing',
  'site.groupBy.source': 'Source List',
  'site.groupBy.tags': 'Tags',
  'site.groupBy.untagged': 'Untagged',
  'site.groupBy.category': 'Category',
  'site.groupBy.categories': 'Categories',
  'site.groupBy.uncategorized': 'Uncategorized',
  'site.groupBy.none': 'None',

  // ── Group headings (the groups themselves, not the toolbar choices) ──
  'site.group.all': 'All Cards',
  'site.group.printing.specific': 'Specific Printing',
  'site.group.printing.any': 'Any Printing',
  'site.group.buylist.on': 'On Buylist',
  'site.group.buylist.off': 'Not on Buylist',
  'site.group.price.none': 'No Price Data',
  'site.group.price.range': '{low} – {high}',
  'site.group.price.atLeast': '{low}+',
  'site.group.type.creature': 'Creature',
  'site.group.type.planeswalker': 'Planeswalker',
  'site.group.type.instant': 'Instant',
  'site.group.type.sorcery': 'Sorcery',
  'site.group.type.artifact': 'Artifact',
  'site.group.type.enchantment': 'Enchantment',
  'site.group.type.land': 'Land',
  'site.group.type.other': 'Other',
  'site.group.source.unknown': 'Unknown',

  // ── Color identity names (group headings and the filter swatches) ────
  'site.colorIdentity.colorless': 'Colorless',
  'site.colorIdentity.white': 'White',
  'site.colorIdentity.blue': 'Blue',
  'site.colorIdentity.black': 'Black',
  'site.colorIdentity.red': 'Red',
  'site.colorIdentity.green': 'Green',
  'site.colorIdentity.azorius': 'Azorius ({colors})',
  'site.colorIdentity.orzhov': 'Orzhov ({colors})',
  'site.colorIdentity.boros': 'Boros ({colors})',
  'site.colorIdentity.selesnya': 'Selesnya ({colors})',
  'site.colorIdentity.dimir': 'Dimir ({colors})',
  'site.colorIdentity.izzet': 'Izzet ({colors})',
  'site.colorIdentity.simic': 'Simic ({colors})',
  'site.colorIdentity.rakdos': 'Rakdos ({colors})',
  'site.colorIdentity.golgari': 'Golgari ({colors})',
  'site.colorIdentity.gruul': 'Gruul ({colors})',
  'site.colorIdentity.esper': 'Esper ({colors})',
  'site.colorIdentity.jeskai': 'Jeskai ({colors})',
  'site.colorIdentity.bant': 'Bant ({colors})',
  'site.colorIdentity.mardu': 'Mardu ({colors})',
  'site.colorIdentity.abzan': 'Abzan ({colors})',
  'site.colorIdentity.naya': 'Naya ({colors})',
  'site.colorIdentity.grixis': 'Grixis ({colors})',
  'site.colorIdentity.sultai': 'Sultai ({colors})',
  'site.colorIdentity.temur': 'Temur ({colors})',
  'site.colorIdentity.jund': 'Jund ({colors})',
  'site.colorIdentity.fourColor': '{colors} (Four Color)',
  'site.colorIdentity.fiveColor': '{colors} (Five Color)',

  // ── Sort-by options (the rest live in the shared `domain.sortBy.*` set) ──
  'site.sortBy.tags': 'Tags',
  'site.sortBy.category': 'Category',

  // ── Card section chrome (the "Categories (all)" grouping's markers) ───
  'site.cardSection.alsoMarker': 'also',
  'site.cardSection.alsoTitle': 'Primary category: {primary}',
  'site.cardSection.secondaryCountNote': 'count includes secondary placements',
  'site.cardSection.boardCategoryHeading': '{board} › {category}',

  // ── Export menu ───────────────────────────────────────────────────────
  'site.export.copy': 'Copy',
  'site.export.download': 'Download',
  'site.export.copyFormat': 'Copy format',
  'site.export.downloadFormat': 'Download format',
  'site.export.copied': 'Copied!',
  'site.export.copyFailed': 'Copy failed',
  'site.export.downloaded': 'Downloaded!',
  'site.export.formatTxt': 'Text (.txt)',
  'site.export.formatMd': 'Markdown (.md)',
  'site.export.formatCsv': 'CSV (.csv)',
  'site.export.buyerCart': '{buyer} cart (.csv)',

  // ── App shell (header, footer, global dialogs) ────────────────────────
  'site.app.live': 'Live',
  'site.app.loadFailed': 'Failed to load data.',
  'site.app.loadFailedLog': 'Failed to load {url}:',
  'site.app.httpStatus': 'HTTP {status}',
  'site.app.offline': 'Offline',
  'site.app.liveTitle': 'Backed by a live API — list data and card search are served fresh',
  'site.app.offlineTitle': 'The live backend is unreachable — showing the built-in site data',
  'site.app.quickSwitch': 'Quick switch',
  'site.app.quickSwitchTitle': 'Quick switch (Ctrl+K)',
  'site.app.quickSwitchAria': 'Open quick switch (Ctrl+K)',
  'site.app.allSelected': 'All Selected',
  'site.app.clearAllSelections': 'Clear all selections',
  'site.app.showDisplayOptions': 'Show display options',
  'site.app.hideDisplayOptions': 'Hide display options',
  'site.app.displayOptions': 'Display options',
  'site.app.editModeHint':
    'Edit mode is on — open a single deck, collection, or wanted list to edit.',
  'site.app.export': 'Export…',
  'site.app.pricesDate': 'Prices accurate as of {date}',
  'site.app.sourceOffer':
    'Generated by {tool} {version}, free software under the {license}: {source}.',
  'site.app.sourceLink': 'source code',
  'site.app.fanContent':
    'This site is unofficial Fan Content permitted under the {policy}. Not approved or endorsed by Wizards of the Coast. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
  'site.app.fanContentPolicy': 'Fan Content Policy',
  'site.app.cardData':
    'Card data and images come from {scryfall}, which is not affiliated with this site.',
  'site.app.tradeToastAdded': '{name} added to Trade',
  'site.app.removeSelectedConfirm': 'Remove',
  'site.app.keepTradeTitle': '{name} is marked "To keep"',
  'site.app.keepTradeMessage':
    'This card is labeled "To keep". Add it to the trade anyway? You will not be asked again.',
  'site.app.keepTradeConfirm': 'Add anyway',

  // ── Deck page ─────────────────────────────────────────────────────────
  'site.deck.allCardsPrice': '(all cards: {amount})',
  'site.deck.importedFrom': 'Imported from {source} ↗',
  'site.deck.sourceGeneric': 'Source',
  'site.deck.lowestPrice': 'Lowest Price',
  'site.deck.lowestPriceEditDisabled':
    'Unavailable while editing — the deck shows its own printings.',
  'site.deck.hasPrimer': 'This deck has a primer.',
  'site.deck.primerContents': 'Contents',

  // ── Collection page ───────────────────────────────────────────────────
  'site.collection.groupDuplicates': 'Group Duplicates',

  // ── Wanted list page ──────────────────────────────────────────────────
  'site.wanted.anyPrinting': 'any printing',
  'site.wanted.anyFinish': 'any finish',

  // ── Combined list view ────────────────────────────────────────────────
  'site.combined.title': 'Combined List',
  'site.combined.allCards': 'All Cards',
  'site.combined.allOfType': {
    $select: 'listType',
    deck: 'All Decks',
    collection: 'All Collections',
    wanted: 'All Wanted Lists',
  },
  'site.combined.viewingAll': 'Viewing all cards from all lists',
  'site.combined.viewingAllOfType': {
    $select: 'listType',
    deck: 'Viewing all decks',
    collection: 'Viewing all collections',
    wanted: 'Viewing all wanted lists',
  },
  'site.combined.combining': 'Combining:',
  'site.combined.loadFailed': 'Failed to load one or more lists.',
  'site.combined.loadFailedLog': 'Combined view: failed to load {type}/{slug}:',
  'site.combined.empty': 'No cards to show.',

  // ── Search results page ───────────────────────────────────────────────
  'site.searchResults.title': 'Search Results',
  'site.searchResults.empty': 'No matching cards.',
  'site.searchResults.from': 'From:',
  'site.searchResults.none': 'No search results yet. {link} to search for cards.',
  'site.searchResults.goToFind': 'Go to Find',

  // ── Find page ─────────────────────────────────────────────────────────
  'site.find.title': 'Find Cards',
  'site.find.subtitle':
    'Search every list by card name. Paste your own list of cards to see which appear, and where.',
  'site.find.placeholder':
    'Paste card names, one per line, e.g.\n\nLightning Bolt\nSol Ring\nBruce Banner',
  'site.find.search': 'Search',
  'site.find.searching': 'Searching…',
  'site.find.addCards': 'Add Cards to Search',
  'site.find.noMatches': 'No matching cards found in any list.',
  'site.find.summary': 'Found {cards} across {lists}.',
  'site.find.selectAll': 'Select All',
  'site.find.addSelectedToTrade': 'Add Selected to Trade',
  'site.find.viewSelectedAsList': 'View Selected as List',
  'site.find.clearSelection': 'Clear Selection',
  'site.find.selectGroupAria': 'Select all cards from {name}',
  'site.find.scopeLabel': 'Search in:',
  'site.find.scopeCount': '{enabled}/{total}',
  'site.find.scopeExpandAria': 'Choose which {type} to search',

  // ── Trade page ────────────────────────────────────────────────────────
  'site.trade.title': 'Trade Editor',
  'site.trade.updatePrices': '↻ Update prices',
  'site.trade.updatingPrices': '↻ Updating…',
  'site.trade.reset': 'Reset',
  'site.trade.copyLink': 'Copy Link',
  'site.trade.difference': 'Difference',
  'site.trade.offering': 'Offering',
  'site.trade.receiving': 'Receiving',
  'site.trade.decodeWarningsHead': 'Some cards from this saved trade could not be loaded.',
  'site.trade.dismissWarnings': 'Dismiss warnings',
  'site.trade.unknownSource': '{sourceKind} "{sourceName}" was not found.',
  'site.trade.unknownScryfallId': 'Scryfall card "{id}" could not be loaded.',
  'site.trade.malformedToken': 'Could not parse trade URL token "{token}".',
  'site.trade.clearTitle': 'Clear this trade?',
  'site.trade.clearMessage':
    'This will remove every card from both sides. The link in your address bar will also be cleared.',
  'site.trade.clearConfirm': 'Clear trade',
  'site.trade.linkCopied': 'Link copied to clipboard',
  'site.trade.linkCopyFailed': 'Could not copy — link is in the address bar',
  'site.trade.noCardsToUpdate': 'No cards to update',
  'site.trade.priceUpdateFailed': 'Could not update prices',
  'site.trade.cacheNote': "Searches use the hosted API's card cache.",
  'site.trade.searchScryfall': 'Search Scryfall instead',
  'site.trade.includeDecks': 'Include cards in decks',

  // ── Trade column ──────────────────────────────────────────────────────
  'site.tradeColumn.sort': 'Sort',
  'site.tradeColumn.sortName': 'Name',
  'site.tradeColumn.sortPrice': 'Price',
  'site.tradeColumn.reverse': '↑↓ Reverse',
  'site.tradeColumn.reversed': '↑↓ Reversed',
  'site.tradeColumn.total': 'Total',
  'site.tradeColumn.noSuggestions': 'No matches. Try a different query.',
  'site.tradeColumn.fromDeck': 'In {name}',
  'site.tradeColumn.fromWanted': 'from {name}',
  'site.tradeColumn.priceUnavailable': 'N/A',

  // ── Trade column search modes ─────────────────────────────────────────
  'site.tradeMode.collection.label': 'Collection',
  'site.tradeMode.collection.placeholder': 'Search your collections…',
  'site.tradeMode.collection.empty': 'No cards yet. Search above to add from your collections.',
  'site.tradeMode.collectionDecks.label': 'Collection + Decks',
  'site.tradeMode.collectionDecks.placeholder': 'Search collections + decks…',
  'site.tradeMode.collectionDecks.empty':
    'No cards yet. Search above to add from your collections or decks.',
  'site.tradeMode.wanted.label': 'Wanted List',
  'site.tradeMode.wanted.placeholder': 'Search your wanted lists…',
  'site.tradeMode.wanted.empty': 'No cards yet. Search above to add from a wanted list.',
  'site.tradeMode.scryfall.label': 'Scryfall',
  'site.tradeMode.scryfall.placeholder': "Scryfall search: e.g. 't:creature c:r'",
  'site.tradeMode.scryfall.empty': 'No cards yet. Search Scryfall above to add any printing.',
  'site.tradeMode.scryfall.searchLabel': 'Scryfall',
  'site.tradeMode.wantedCache.label': 'Wanted List + Card Cache',
  'site.tradeMode.wantedCache.placeholder': 'Search your wanted lists and the card cache…',
  'site.tradeMode.wantedCache.empty':
    'No cards yet. Search above to add from a wanted list or any card in the cache.',
  'site.tradeMode.wantedCache.searchLabel': 'Card cache',

  // ── Trade card row ────────────────────────────────────────────────────
  'site.tradeRow.sourceCollection': 'Collection',
  'site.tradeRow.sourceDeck': 'Deck · {name}',
  'site.tradeRow.sourceWanted': 'Wanted',
  'site.tradeRow.keepBadge': 'Keep',
  'site.tradeRow.editPrinting': 'Edit printing',
  'site.tradeRow.remove': 'Remove from trade',
  'site.tradeRow.maxAvailable': 'Only {count} available',
  'site.tradeRow.priceEach': '{amount} ea',

  // ── Sell mode ─────────────────────────────────────────────────────────
  'site.sell.overLimit': "{count} over the buyer's limit",

  // ── Primer renderer ───────────────────────────────────────────────────
  'site.primer.youtubeTitle': 'YouTube video',
  'site.primer.openCard': 'Open card: {name}',

  // ── Build-time detail loaders ─────────────────────────────────────────
  'site.detail.fileNotFound': 'File not found: {path}',
  'site.detail.noLanguageCard':
    "No {language} card object for '{name}' ({printing}); using the default-language object",
  'site.detail.artUnreadable': 'Custom art sidecar ignored: {reason}',
  'site.detail.artUnknownCards': 'Custom art is set for cards no longer in this list: {ids}',
  'site.detail.categoriesUnreadable': 'Categories sidecar could not be read: {reason}',
  'site.detail.categoriesUnknownCards':
    'Categories sidecar names cards this list no longer holds: {names}',
  'site.detail.listDescriptionInvalid': "Front matter 'description' ignored: {reason}",
  'site.detail.listImageInvalid': "Front matter 'image' ignored: {reason}",
  'site.detail.listImageUnknownCard': {
    $select: 'kind',
    deck: "List image for deck '{name}' references card &{id}, which is no longer in the list — using the default cover",
    collection:
      "List image for collection '{name}' references card &{id}, which is no longer in the list — using the default cover",
    wanted:
      "List image for wanted list '{name}' references card &{id}, which is no longer in the list — using the default cover",
  },
} as const satisfies MessageCatalogShape
