/**
 * `domain.*` — the shared Magic vocabulary every surface renders: conditions,
 * finishes, list types, card labels, currencies. The highest-payoff namespace
 * per edit, because one entry translates the CLI and both SPAs at once.
 *
 * Persisted slugs never live here: `CARD_LABELS`, `DeckFormatKey`,
 * `CardLanguage`, set codes and the `[foil]`/`[ja]` line tokens are English by
 * contract (see the plan's §4.9 carve-out list).
 */

import type { MessageCatalogShape } from '../../types'

export const domainMessages = {
  'domain.condition.nm': 'Near Mint',
  'domain.condition.lp': 'Lightly Played',
  'domain.condition.mp': 'Moderately Played',
  'domain.condition.hp': 'Heavily Played',
  'domain.condition.dmg': 'Damaged',
  'domain.label.sale': 'For sale',
  'domain.label.trade': 'For trade',
  'domain.label.keep': 'To keep',
  'domain.label.saleAndTrade': 'For sale + trade',
  'domain.label.useListDefault': 'Use list default',
  'domain.label.noDefault': 'No default',
  'domain.listType.deck': 'Decks',
  'domain.listType.collection': 'Collections',
  'domain.listType.wanted': 'Wanted Lists',
  'domain.listTypeSingular.deck': 'Deck',
  'domain.listTypeSingular.collection': 'Collection',
  'domain.listTypeSingular.wanted': 'Wanted List',
  'domain.currency.tix': '{amount} tix',

  // ── Counted nouns ─────────────────────────────────────────────────────
  //
  // The one place a count and its noun agree. Nothing in the codebase may
  // append an `s` to a noun itself: English is the only language where that
  // works, and Ritual already renders Japanese card names.
  //
  // These are *fragments*, deliberately: they are spliced into a surrounding
  // sentence that is still an English literal until that surface's own
  // conversion lands. A translator can safely reorder inside the fragment but
  // cannot yet move it within its sentence.
  'domain.count.cards': { $plural: 'count', one: '{count} card', other: '{count} cards' },
  'domain.count.copies': { $plural: 'count', one: '{count} copy', other: '{count} copies' },
  'domain.count.rows': { $plural: 'count', one: '{count} row', other: '{count} rows' },
  'domain.count.items': { $plural: 'count', one: '{count} item', other: '{count} items' },
  'domain.count.files': { $plural: 'count', one: '{count} file', other: '{count} files' },
  'domain.count.listFiles': {
    $plural: 'count',
    one: '{count} list file',
    other: '{count} list files',
  },
  'domain.count.lists': { $plural: 'count', one: '{count} list', other: '{count} lists' },
  'domain.count.decks': { $plural: 'count', one: '{count} deck', other: '{count} decks' },
  'domain.count.collections': {
    $plural: 'count',
    one: '{count} collection',
    other: '{count} collections',
  },
  'domain.count.wantedLists': {
    $plural: 'count',
    one: '{count} wanted list',
    other: '{count} wanted lists',
  },
  'domain.count.sources': { $plural: 'count', one: '{count} source', other: '{count} sources' },
  'domain.count.changes': { $plural: 'count', one: '{count} change', other: '{count} changes' },
  'domain.count.pickedCards': {
    $plural: 'count',
    one: '{count} picked card',
    other: '{count} picked cards',
  },
  'domain.count.cardEntries': {
    $plural: 'count',
    one: '{count} card entry',
    other: '{count} card entries',
  },
  'domain.count.unreadableLines': {
    $plural: 'count',
    one: '{count} unreadable line',
    other: '{count} unreadable lines',
  },
  'domain.count.printings': {
    $plural: 'count',
    one: '{count} printing',
    other: '{count} printings',
  },
  'domain.count.refusedRows': {
    $plural: 'count',
    one: '{count} refused row',
    other: '{count} refused rows',
  },
  'domain.count.requests': { $plural: 'count', one: '{count} request', other: '{count} requests' },
  'domain.count.ambiguousRemovals': {
    $plural: 'count',
    one: '{count} ambiguous removal',
    other: '{count} ambiguous removals',
  },
  'domain.count.skills': { $plural: 'count', one: '{count} skill', other: '{count} skills' },
  'domain.count.agentSkills': {
    $plural: 'count',
    one: '{count} Ritual agent skill',
    other: '{count} Ritual agent skills',
  },

  // ── Durations ─────────────────────────────────────────────────────────
  //
  // Everything above a minute is rendered by `Intl.NumberFormat`'s unit style
  // and joined by `Intl.ListFormat`, so only the floor case needs wording.
  'domain.duration.lessThanMinute': 'less than a minute',

  // ── Money ─────────────────────────────────────────────────────────────
  //
  // The amount itself is an `Intl.NumberFormat` currency rendering; only the
  // sentence around a partially-known total lives here. `formatPriceInvariant`
  // (CSV and other machine paths) never reaches the catalog at all.
  'domain.price.atLeastMissing': {
    $plural: 'count',
    one: 'At least {price} (missing {count} card)',
    other: 'At least {price} (missing {count} cards)',
  },

  // ── Sync engines ──────────────────────────────────────────────────────
  //
  // Emitted by `src/collection-sync/` and `src/deck-sync/`, which render their
  // log lines once and hand them to the CLI, the admin site over SSE, and the
  // MCP report alike.
  'domain.sync.skippedRemovals': {
    $plural: 'count',
    one: 'Skipped {count} removal (applying additions only).',
    other: 'Skipped {count} removals (applying additions only).',
  },
  'domain.sync.skippedAdditions': {
    $plural: 'count',
    one: 'Skipped {count} addition (applying removals only).',
    other: 'Skipped {count} additions (applying removals only).',
  },
  'domain.sync.csvUncachedAdditions': {
    $plural: 'count',
    one: '{count} addition cannot ride the CSV (the printing is not in the Scryfall cache); it is added one at a time instead.',
    other:
      '{count} additions cannot ride the CSV (the printing is not in the Scryfall cache); they are added one at a time instead.',
  },
  'domain.sync.rateLimitWait':
    'Rate limited by Archidekt — waiting {seconds}s before retry {retry} of {maxRetries}.',

  // ── Site navigation ───────────────────────────────────────────────────
  //
  // The primary destinations, rendered by both the desktop header links and
  // the mobile tab bar. The tab bar is the tight one, hence the short budgets.
  'domain.nav.decks': 'Decks',
  'domain.nav.collections': 'Collections',
  'domain.nav.wanted': 'Wanted',
  'domain.nav.all': 'All',
  'domain.nav.trade': 'Trade',
  'domain.nav.find': 'Find',

  // ── Toolbar sort fields (public site) ─────────────────────────────────
  'domain.sortBy.name': 'Name',
  'domain.sortBy.cmc': 'Mana Value',
  'domain.sortBy.price': 'Price',
  'domain.sortBy.buylistPrice': 'Buylist Price',
  'domain.sortBy.buylistSpread': 'Buylist vs Price',
  'domain.sortBy.edhrec': 'EDHRec Rank',
  'domain.sortBy.fileOrder': 'File Order',
  'domain.sortBy.setCode': 'Set Code',
  'domain.sortBy.colorIdentity': 'Color Identity',
  'domain.sortBy.listOrder': 'List Order',

  // ── Toolbar group-by fields sell mode adds ────────────────────────────
  'domain.groupBy.buylistPrice': 'Buylist Price',
  'domain.groupBy.onBuylist': 'On Buylist',

  // ── Price browser sort fields (CLI) ───────────────────────────────────
  'domain.priceSort.name': 'Name',
  'domain.priceSort.price': 'Price',
  'domain.priceSort.lowest': 'Lowest price',
  'domain.priceSort.set': 'Set code',
  'domain.priceSort.cmc': 'Mana value',
  'domain.priceSort.edhrec': 'EDHREC rank',
  'domain.priceSort.quantity': 'Quantity',

  // ── Buyers ────────────────────────────────────────────────────────────
  'domain.buyer.cardkingdom': 'Card Kingdom',

  // ── Deck formats ──────────────────────────────────────────────────────
  //
  // Format names are the game's own proper nouns. A translator should only
  // change one where the local player community actually uses another word.
  'domain.deckFormat.commander': 'Commander',
  'domain.deckFormat.oathbreaker': 'Oathbreaker',
  'domain.deckFormat.standard': 'Standard',
  'domain.deckFormat.modern': 'Modern',
  'domain.deckFormat.pioneer': 'Pioneer',
  'domain.deckFormat.legacy': 'Legacy',
  'domain.deckFormat.vintage': 'Vintage',
  'domain.deckFormat.pauper': 'Pauper',
  'domain.deckFormat.historic': 'Historic',
  'domain.deckFormat.alchemy': 'Alchemy',
  'domain.deckFormat.explorer': 'Explorer',
  'domain.deckFormat.timeless': 'Timeless',
  'domain.deckFormat.pennyDreadful': 'Penny Dreadful',
  'domain.deckFormat.brawl': 'Brawl',
  'domain.deckFormat.historicBrawl': 'Historic Brawl',
  'domain.deckFormat.duelCommander': 'Duel Commander',
  'domain.deckFormat.pauperCommander': 'Pauper Commander',
  'domain.deckFormat.preDh': 'PreDH',
  'domain.deckFormat.preModern': 'Pre-Modern',
  'domain.deckFormat.limited': 'Limited',

  // ── New-list menu rows ────────────────────────────────────────────────
  'domain.newList.deck': 'New Deck',
  'domain.newList.collection': 'New Collection',
  'domain.newList.wanted': 'New Wanted List',

  // ── Export ────────────────────────────────────────────────────────────
  //
  // Column *labels* are CSV header cells and stay English by contract
  // (`EXPORT_PROPERTY_LABELS`); only the parenthetical hints shown while
  // *choosing* columns, and the format picker's rows, are localized.
  'domain.exportHint.edition': 'set + collector number',
  'domain.exportHint.scryfallId': 'resolved from the local Scryfall cache',
  'domain.exportHint.isFoil': 'true when foil or etched',
  'domain.exportHint.language': 'Scryfall language code; blank for English',
  'domain.exportHint.labels': "effective labels — the card's override or its list default",
  'domain.exportFormat.csv': 'CSV',
  'domain.exportFormat.json': 'JSON',
  'domain.exportFormat.text': 'Plain text (1 Name (SET:CN))',
  'domain.exportFormat.md': 'Markdown (canonical list markdown, no &N ids)',

  // ── Change-bundle import conflicts ────────────────────────────────────
  'domain.importConflict.targetNotFound': 'card not found',
  'domain.importConflict.notApplicable': 'not applicable to this list',

  // ── Content-hash sidecar states ───────────────────────────────────────
  'domain.sidecar.clean': 'clean',
  'domain.sidecar.diverged': 'diverged',
  'domain.sidecar.missing': 'no sidecar',

  // ── Admin pages ───────────────────────────────────────────────────────
  //
  // Each page's name, read by the sidebar, the dashboard cards, and the page's
  // own heading. These live here rather than in `admin.*` only because the
  // admin namespace is converted as a whole in a later phase.
  'domain.adminPage.dashboard': 'Dashboard',
  'domain.adminPage.listEditor': 'Edit Lists',
  'domain.adminPage.moveCards': 'Move Cards',
  'domain.adminPage.listManager': 'Manage Lists',
  'domain.adminPage.history': 'Change History',
  'domain.adminPage.importDeck': 'Import Deck',
  'domain.adminPage.importCsv': 'Import CSV',
  'domain.adminPage.importChanges': 'Import Changes',
  'domain.adminPage.buildSite': 'Build Site',
  'domain.adminPage.cacheRefresh': 'Refresh Cache',
  'domain.adminPage.deckSync': 'Sync Decks',
  'domain.adminPage.collectionSync': 'Sync Collection',
  'domain.adminPage.archidektLogin': 'Archidekt Login',
  'domain.adminPage.settings': 'Settings',
  'domain.adminPage.auditLog': 'Audit Log',

  // ── Change descriptions ───────────────────────────────────────────────
  //
  // The display half of the changelog. `formatChangeCore` in
  // `src/change-event.ts` still writes the English `.changes.md` line — these
  // keys never reach that writer (see the persistence fence). `changeMessage`
  // in `src/change-message.ts` is the only consumer, shared by the CLI, the
  // public site's changelog modal, and the admin editors.
  //
  // Two placeholders are pre-rendered fragments rather than words, and both
  // are attached to the preceding token with no space of their own:
  //
  //   {annotation} — ` (NEO:234) [foil] [LP] [ja]`, already space-prefixed,
  //                  empty when the change names no specific printing.
  //   {id}         — ` &5`, the card's internal line ID, empty when absent.
  //
  // Keep both immediately after the token they qualify; never translate their
  // contents (set codes and bracket tokens are file-format vocabulary).
  'domain.change.add': {
    $select: 'tense',
    present: 'Add {name}{annotation}{id}',
    past: 'Added {name}{annotation}{id}',
  },
  'domain.change.addToBoard': {
    $select: 'tense',
    present: 'Add {name}{annotation} to {board}{id}',
    past: 'Added {name}{annotation} to {board}{id}',
  },
  'domain.change.remove': {
    $select: 'tense',
    present: 'Remove {name}{annotation}{id}',
    past: 'Removed {name}{annotation}{id}',
  },
  'domain.change.removeFromBoard': {
    $select: 'tense',
    present: 'Remove {name}{annotation} from {board}{id}',
    past: 'Removed {name}{annotation} from {board}{id}',
  },
  'domain.change.setCommander': 'Set {name} as commander{id}',
  'domain.change.unsetCommander': 'Unset {name} as commander{id}',
  'domain.change.setFinish': 'Set {name} finish to {finish}{id}',
  'domain.change.setPrinting': 'Set {name} printing to {printing}{id}',
  'domain.change.setPrintingNone': 'Set {name} printing to no specific printing{id}',
  'domain.change.setLanguage': 'Set language of {name} to {language}{id}',
  'domain.change.setNote': 'Set note on {name}{id} to "{note}"',
  'domain.change.clearNote': {
    $select: 'tense',
    present: 'Clear note on {name}{id}',
    past: 'Cleared note on {name}{id}',
  },
  'domain.change.setLabels': 'Set labels on {name}{id} to [{labels}]',
  'domain.change.clearLabels': {
    $select: 'tense',
    present: 'Clear labels on {name}{id}',
    past: 'Cleared labels on {name}{id}',
  },
  'domain.change.moveToList': {
    $select: 'tense',
    present: 'Move {name}{annotation}{id} to {list}',
    past: 'Moved {name}{annotation}{id} to {list}',
  },
  'domain.change.moveFromList': {
    $select: 'tense',
    present: 'Move {name}{annotation}{id} from {list}',
    past: 'Moved {name}{annotation}{id} from {list}',
  },
  'domain.change.addSection': {
    $select: 'tense',
    present: 'Add section "{section}"',
    past: 'Added section "{section}"',
  },
  'domain.change.removeSection': {
    $select: 'tense',
    present: 'Remove section "{section}"',
    past: 'Removed section "{section}"',
  },
  'domain.change.renameSection': {
    $select: 'tense',
    present: 'Rename section "{section}" to "{newSection}"',
    past: 'Renamed section "{section}" to "{newSection}"',
  },
  'domain.change.setSection': {
    $select: 'tense',
    present: 'Move {name} to section "{section}"{id}',
    past: 'Moved {name} to section "{section}"{id}',
  },
} as const satisfies MessageCatalogShape
