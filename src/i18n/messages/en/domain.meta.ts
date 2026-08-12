/** Translator metadata for the `domain.*` namespace. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainMessages } from './domain'

const CONDITION_CONTEXT =
  'Trading-card grade shown next to a card. Use the wording collectors in the target language use.'

const CHANGE_CONTEXT =
  'One line of a list\'s change history, shown in the CLI and in both web UIs. {tense} selects the wording: "present" describes a change the user is about to save, "past" one that already happened. {name} is the card name and is never translated.'

const ID_CONTEXT =
  '{id} is a pre-rendered " &5" card-ID suffix (empty when absent) — keep it at the end and never translate it.'

const ANNOTATION_CONTEXT = `{annotation} is a pre-rendered, already space-prefixed printing tail like " (NEO:234) [foil] [ja]" (empty when absent) — keep it immediately after {name} with no space of your own, and never translate it. ${ID_CONTEXT}`

const NAV_CONTEXT =
  'A primary navigation destination on the public site, shown both as a header link and as a bottom tab-bar label on phones. The tab bar puts five or six of these side by side, so keep it to one short word.'

const SORT_CONTEXT =
  'A field the public site can sort cards by, shown in the toolbar\'s "Sort" dropdown. The stored value is an English slug, so translating this only changes what the reader sees.'

const GROUP_CONTEXT =
  'A field the public site can group cards by, shown in the toolbar\'s "Group" dropdown. Only offered while sell mode is on.'

const PRICE_SORT_CONTEXT =
  "A field the CLI's interactive price browser can sort by, shown in its sort menu."

const FORMAT_CONTEXT =
  'The name of a Magic deck format, shown on deck covers and in the format picker. The stored value is an English slug; translate this only if the local player community actually uses a different name.'

const NEW_LIST_CONTEXT =
  'A row in the CLI editor\'s list picker that creates a new list instead of opening an existing one. A "+" icon is prepended separately.'

const EXPORT_HINT_CONTEXT =
  'A short parenthetical shown beside an export column while the user is *choosing* columns. It never reaches the exported file — CSV header cells stay English by contract.'

const EXPORT_FORMAT_CONTEXT = "A row in the export wizard's output-format picker."

const CONFLICT_CONTEXT =
  'Why one change in an imported change bundle could not be applied. Shown in a comma-joined per-reason tally ("card not found: 2") and again beside each skipped change, so keep it a short lowercase noun phrase rather than a sentence.'

const SIDECAR_CONTEXT =
  'The state of a list file measured against its `.sha256` sidecar, printed by `ritual detect-changes --verify` in a `<file>: <state>` column. Keep it a short lowercase phrase.'

const ADMIN_PAGE_CONTEXT =
  "A page of the admin site, named identically in the sidebar, on its dashboard card, and in the page's own heading."

const COUNT_CONTEXT =
  'A count and the thing it counts, agreeing in number. Supply every plural category your language uses — English needs only "one" and "other", Russian needs "one", "few", "many" and "other". This is a *fragment* spliced into a longer sentence that is still English, so keep it a bare noun phrase with no leading capital and no final punctuation.'

export const domainMeta = {
  'domain.condition.nm': { description: `${CONDITION_CONTEXT} Best grade.`, maxLen: 20 },
  'domain.condition.lp': { description: `${CONDITION_CONTEXT} Second-best grade.`, maxLen: 20 },
  'domain.condition.mp': { description: `${CONDITION_CONTEXT} Middle grade.`, maxLen: 20 },
  'domain.condition.hp': { description: `${CONDITION_CONTEXT} Second-worst grade.`, maxLen: 20 },
  'domain.condition.dmg': { description: `${CONDITION_CONTEXT} Worst grade.`, maxLen: 20 },
  'domain.label.sale': {
    description: 'Card label meaning the owner is willing to sell this card.',
    maxLen: 16,
  },
  'domain.label.trade': {
    description: 'Card label meaning the owner is willing to trade this card.',
    maxLen: 16,
  },
  'domain.label.keep': {
    description: 'Card label meaning the owner will not part with this card.',
    maxLen: 16,
  },
  'domain.label.saleAndTrade': {
    description: 'Label picker row applying both the "for sale" and "for trade" labels at once.',
    maxLen: 24,
  },
  'domain.label.useListDefault': {
    description:
      "Label picker row clearing a card's own label override so the list's default applies again.",
    maxLen: 24,
  },
  'domain.label.noDefault': {
    description:
      'Row in the *list default* label picker meaning the list declares no default at all.',
    maxLen: 24,
  },
  'domain.listType.deck': { description: 'Plural name for the deck list type.', maxLen: 20 },
  'domain.listType.collection': {
    description: 'Plural name for the collection list type.',
    maxLen: 20,
  },
  'domain.listType.wanted': {
    description: 'Plural name for the wanted list type.',
    maxLen: 20,
  },
  'domain.listTypeSingular.deck': {
    description: 'Singular name for the deck list type.',
    maxLen: 20,
  },
  'domain.listTypeSingular.collection': {
    description: 'Singular name for the collection list type.',
    maxLen: 20,
  },
  'domain.listTypeSingular.wanted': {
    description: 'Singular name for the wanted list type.',
    maxLen: 20,
  },
  'domain.currency.tix': {
    description:
      'A price in Magic Online event tickets. "tix" is the community name for the currency and is normally left untranslated. {amount} is an already-formatted number.',
  },

  'domain.count.cards': { description: `${COUNT_CONTEXT} Magic cards.` },
  'domain.count.copies': {
    description: `${COUNT_CONTEXT} Copies of one card — how many of the same card a list holds.`,
  },
  'domain.count.rows': { description: `${COUNT_CONTEXT} Rows of a CSV file.` },
  'domain.count.items': {
    description: `${COUNT_CONTEXT} Raw entries returned by a Scryfall set query, before non-printings are filtered out.`,
  },
  'domain.count.files': { description: `${COUNT_CONTEXT} Files on disk.` },
  'domain.count.listFiles': {
    description: `${COUNT_CONTEXT} Markdown files holding a deck, collection, or wanted list.`,
  },
  'domain.count.lists': { description: `${COUNT_CONTEXT} Card lists of any type.` },
  'domain.count.decks': { description: `${COUNT_CONTEXT} Decks.` },
  'domain.count.collections': { description: `${COUNT_CONTEXT} Collections.` },
  'domain.count.wantedLists': { description: `${COUNT_CONTEXT} Wanted lists.` },
  'domain.count.sources': {
    description: `${COUNT_CONTEXT} Source lists a site build was asked to include.`,
  },
  'domain.count.changes': {
    description: `${COUNT_CONTEXT} Recorded changes to a list (one changelog entry each).`,
  },
  'domain.count.pickedCards': {
    description: `${COUNT_CONTEXT} Cards the user picked by hand in the export wizard, as opposed to whole lists.`,
  },
  'domain.count.cardEntries': {
    description: `${COUNT_CONTEXT} Entries in an imported deck file, counted while parsing.`,
  },
  'domain.count.unreadableLines': {
    description: `${COUNT_CONTEXT} Lines of a list file the parser could not understand.`,
  },
  'domain.count.printings': {
    description: `${COUNT_CONTEXT} Card printings (a specific set/collector-number/finish of a card), e.g. in a deck sync's "2 printings changed".`,
  },
  'domain.count.refusedRows': {
    description: `${COUNT_CONTEXT} Rows Archidekt rejected from an uploaded CSV.`,
  },
  'domain.count.requests': { description: `${COUNT_CONTEXT} HTTP requests made to a remote API.` },
  'domain.count.ambiguousRemovals': {
    description: `${COUNT_CONTEXT} Removals Ritual cannot attribute to one list on its own, because several lists hold the card.`,
  },
  'domain.count.skills': {
    description: `${COUNT_CONTEXT} Installable Claude Code agent skills.`,
  },
  'domain.count.agentSkills': {
    description: `${COUNT_CONTEXT} The same skills, named in full for the site-scaffolding command, which mentions them without prior context.`,
  },

  'domain.duration.lessThanMinute': {
    description:
      'A duration too short to name in minutes, e.g. "Prices were last updated less than a minute ago." Every longer duration is rendered by Intl and needs no translation.',
  },

  'domain.price.atLeastMissing': {
    description:
      'A list total that is known to be incomplete because some cards have no published price. {price} is an already-formatted money amount; {count} is how many cards were left out.',
  },

  'domain.sync.skippedRemovals': {
    description:
      'Reported when a sync was restricted to additions, so this many removals were left alone. "additions" and "removals" name the two halves of a sync and appear in the UI controls too.',
  },
  'domain.sync.skippedAdditions': {
    description: 'The mirror of the previous key: a sync restricted to removals skipped additions.',
  },
  'domain.sync.csvUncachedAdditions': {
    description:
      'Some cards cannot be uploaded in the bulk CSV because Ritual has no cached printing for them, so they are pushed individually instead. Note the pronoun agreement between the singular and plural forms.',
  },
  'domain.sync.rateLimitWait': {
    description:
      'Warns that Archidekt answered 429 and the sync is pausing before retrying the same request. {seconds} is a number that may carry one decimal place (e.g. 2 or 2.5), {retry} is the 1-based attempt about to be made, {maxRetries} the total budget.',
  },
  'domain.nav.decks': { description: `${NAV_CONTEXT} The deck index.`, maxLen: 12 },
  'domain.nav.collections': { description: `${NAV_CONTEXT} The collection index.`, maxLen: 12 },
  'domain.nav.wanted': { description: `${NAV_CONTEXT} The wanted-list index.`, maxLen: 12 },
  'domain.nav.all': {
    description: `${NAV_CONTEXT} Every list of every type, merged into one view.`,
    maxLen: 12,
  },
  'domain.nav.trade': {
    description: `${NAV_CONTEXT} The trade builder, where two people compare wants against each other's cards.`,
    maxLen: 12,
  },
  'domain.nav.find': {
    description: `${NAV_CONTEXT} Card search across every list.`,
    maxLen: 12,
  },

  'domain.sortBy.name': { description: `${SORT_CONTEXT} Alphabetical by card name.`, maxLen: 24 },
  'domain.sortBy.cmc': {
    description: `${SORT_CONTEXT} Mana value (converted mana cost) — the game's own term.`,
    maxLen: 24,
  },
  'domain.sortBy.price': { description: `${SORT_CONTEXT} Retail price per copy.`, maxLen: 24 },
  'domain.sortBy.buylistPrice': {
    description: `${SORT_CONTEXT} What the selected buyer pays per copy.`,
    maxLen: 24,
  },
  'domain.sortBy.buylistSpread': {
    description: `${SORT_CONTEXT} The buylist offer measured against the retail price — how close a buyer's offer comes to what the card sells for.`,
    maxLen: 24,
  },
  'domain.sortBy.edhrec': {
    description: `${SORT_CONTEXT} Popularity rank from the EDHREC site. "EDHRec" is a product name — do not translate it.`,
    maxLen: 24,
  },
  'domain.sortBy.fileOrder': {
    description: `${SORT_CONTEXT} The order the cards appear in the list's own markdown file.`,
    maxLen: 24,
  },
  'domain.sortBy.setCode': {
    description: `${SORT_CONTEXT} The three-to-five letter code of the set a card was printed in.`,
    maxLen: 24,
  },
  'domain.sortBy.colorIdentity': {
    description: `${SORT_CONTEXT} The card's colour identity (white/blue/black/red/green).`,
    maxLen: 24,
  },
  'domain.sortBy.listOrder': {
    description: `${SORT_CONTEXT} What "file order" is called in the combined view, where the cards come from several files at once.`,
    maxLen: 24,
  },

  'domain.groupBy.buylistPrice': {
    description: `${GROUP_CONTEXT} Buckets by what the selected buyer pays.`,
    maxLen: 24,
  },
  'domain.groupBy.onBuylist': {
    description: `${GROUP_CONTEXT} Splits cards the buyer is currently buying from those it is not.`,
    maxLen: 24,
  },

  'domain.priceSort.name': { description: `${PRICE_SORT_CONTEXT} Card name.`, maxLen: 24 },
  'domain.priceSort.price': {
    description: `${PRICE_SORT_CONTEXT} The price of the printing the list names.`,
    maxLen: 24,
  },
  'domain.priceSort.lowest': {
    description: `${PRICE_SORT_CONTEXT} The cheapest printing of the card, whichever the list names.`,
    maxLen: 24,
  },
  'domain.priceSort.set': { description: `${PRICE_SORT_CONTEXT} Set code.`, maxLen: 24 },
  'domain.priceSort.cmc': {
    description: `${PRICE_SORT_CONTEXT} Mana value (converted mana cost).`,
    maxLen: 24,
  },
  'domain.priceSort.edhrec': {
    description: `${PRICE_SORT_CONTEXT} Popularity rank from the EDHREC site; "EDHREC" is a product name.`,
    maxLen: 24,
  },
  'domain.priceSort.quantity': {
    description: `${PRICE_SORT_CONTEXT} How many copies the list holds.`,
    maxLen: 24,
  },

  'domain.buyer.cardkingdom': {
    description:
      'Card Kingdom, the store Ritual can fetch buylist offers from. A company name — leave it untranslated.',
    maxLen: 20,
  },

  'domain.deckFormat.commander': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.oathbreaker': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.standard': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.modern': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.pioneer': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.legacy': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.vintage': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.pauper': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.historic': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.alchemy': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.explorer': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.timeless': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.pennyDreadful': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.brawl': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.historicBrawl': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.duelCommander': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.pauperCommander': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.preDh': {
    description: `${FORMAT_CONTEXT} "PreDH" is the community abbreviation for pre-Dominaria-Horizons Commander.`,
    maxLen: 24,
  },
  'domain.deckFormat.preModern': { description: `${FORMAT_CONTEXT}`, maxLen: 24 },
  'domain.deckFormat.limited': {
    description: `${FORMAT_CONTEXT} Covers both draft and sealed.`,
    maxLen: 24,
  },

  'domain.newList.deck': { description: `${NEW_LIST_CONTEXT} A deck.`, maxLen: 24 },
  'domain.newList.collection': { description: `${NEW_LIST_CONTEXT} A collection.`, maxLen: 24 },
  'domain.newList.wanted': { description: `${NEW_LIST_CONTEXT} A wanted list.`, maxLen: 24 },

  'domain.exportHint.edition': {
    description: `${EXPORT_HINT_CONTEXT} The "edition" column, which pairs the set code with the collector number.`,
  },
  'domain.exportHint.scryfallId': {
    description: `${EXPORT_HINT_CONTEXT} The "Scryfall ID" column, whose value is looked up in the locally cached card database rather than stored in the list file.`,
  },
  'domain.exportHint.isFoil': {
    description: `${EXPORT_HINT_CONTEXT} The "is foil" column, a true/false flag that covers both foil and etched-foil cards.`,
  },
  'domain.exportHint.language': {
    description: `${EXPORT_HINT_CONTEXT} The "language" column, which holds the *card printing's* language code (never the interface language) and is left blank for English cards.`,
  },
  'domain.exportHint.labels': {
    description: `${EXPORT_HINT_CONTEXT} The "labels" column, which exports the labels actually in force — a card's own override if it has one, otherwise the list's default.`,
  },
  'domain.exportFormat.csv': {
    description: `${EXPORT_FORMAT_CONTEXT} Comma-separated values. A file-format name — normally left untranslated.`,
    maxLen: 48,
  },
  'domain.exportFormat.json': {
    description: `${EXPORT_FORMAT_CONTEXT} JSON. A file-format name — leave it untranslated.`,
    maxLen: 48,
  },
  'domain.exportFormat.text': {
    description: `${EXPORT_FORMAT_CONTEXT} Plain text, one card per line. The parenthetical is a literal sample line — keep it as-is.`,
    maxLen: 48,
  },
  'domain.exportFormat.md': {
    description: `${EXPORT_FORMAT_CONTEXT} Ritual's own list markdown. "&N" is the internal card-ID token and is never translated.`,
    maxLen: 48,
  },

  'domain.importConflict.targetNotFound': {
    description: `${CONFLICT_CONTEXT} The change names a card the target list does not contain.`,
    maxLen: 40,
  },
  'domain.importConflict.notApplicable': {
    description: `${CONFLICT_CONTEXT} The change is meaningless for this kind of list — setting a commander on a collection, for instance.`,
    maxLen: 40,
  },

  'domain.sidecar.clean': {
    description: `${SIDECAR_CONTEXT} The file matches its sidecar: Ritual wrote every change in it.`,
    maxLen: 16,
  },
  'domain.sidecar.diverged': {
    description: `${SIDECAR_CONTEXT} The file has been edited by hand since Ritual last wrote it.`,
    maxLen: 16,
  },
  'domain.sidecar.missing': {
    description: `${SIDECAR_CONTEXT} The file has no sidecar at all, so nothing can be compared.`,
    maxLen: 16,
  },

  'domain.adminPage.dashboard': {
    description: `${ADMIN_PAGE_CONTEXT} The landing page of shortcuts.`,
    maxLen: 24,
  },
  'domain.adminPage.listEditor': {
    description: `${ADMIN_PAGE_CONTEXT} Editing the cards in a list.`,
    maxLen: 24,
  },
  'domain.adminPage.moveCards': {
    description: `${ADMIN_PAGE_CONTEXT} Moving cards from one list to another.`,
    maxLen: 24,
  },
  'domain.adminPage.listManager': {
    description: `${ADMIN_PAGE_CONTEXT} Creating, renaming, and deleting whole lists.`,
    maxLen: 24,
  },
  'domain.adminPage.history': {
    description: `${ADMIN_PAGE_CONTEXT} Browsing what changed in each list over time.`,
    maxLen: 24,
  },
  'domain.adminPage.importDeck': {
    description: `${ADMIN_PAGE_CONTEXT} Importing a deck from another site.`,
    maxLen: 24,
  },
  'domain.adminPage.importCsv': {
    description: `${ADMIN_PAGE_CONTEXT} Importing cards from a spreadsheet export.`,
    maxLen: 24,
  },
  'domain.adminPage.importChanges': {
    description: `${ADMIN_PAGE_CONTEXT} Applying a change bundle exported from the public site.`,
    maxLen: 24,
  },
  'domain.adminPage.buildSite': {
    description: `${ADMIN_PAGE_CONTEXT} Publishing the read-only public site.`,
    maxLen: 24,
  },
  'domain.adminPage.cacheRefresh': {
    description: `${ADMIN_PAGE_CONTEXT} Re-downloading the local card database.`,
    maxLen: 24,
  },
  'domain.adminPage.deckSync': {
    description: `${ADMIN_PAGE_CONTEXT} Two-way sync of decks with an external site.`,
    maxLen: 24,
  },
  'domain.adminPage.collectionSync': {
    description: `${ADMIN_PAGE_CONTEXT} Two-way sync of a collection with an external site.`,
    maxLen: 24,
  },
  'domain.adminPage.archidektLogin': {
    description: `${ADMIN_PAGE_CONTEXT} Signing in to Archidekt, an external deck site. A product name — leave it untranslated.`,
    maxLen: 24,
  },
  'domain.adminPage.settings': {
    description: `${ADMIN_PAGE_CONTEXT} Configuration.`,
    maxLen: 24,
  },
  'domain.adminPage.auditLog': {
    description: `${ADMIN_PAGE_CONTEXT} The record of who did what through the admin server.`,
    maxLen: 24,
  },

  'domain.change.add': {
    description: `${CHANGE_CONTEXT} A card was added to a list. ${ANNOTATION_CONTEXT}`,
  },
  'domain.change.addToBoard': {
    description: `${CHANGE_CONTEXT} A card was added to a named deck board. {board} is the board name (Sideboard, Maybeboard, Commander) and is file-format vocabulary — leave it untranslated. ${ANNOTATION_CONTEXT}`,
  },
  'domain.change.remove': {
    description: `${CHANGE_CONTEXT} A card was removed from a list. ${ANNOTATION_CONTEXT}`,
  },
  'domain.change.removeFromBoard': {
    description: `${CHANGE_CONTEXT} A card was removed from a named deck board. {board} is the untranslated board name. ${ANNOTATION_CONTEXT}`,
  },
  'domain.change.setCommander': {
    description: `${CHANGE_CONTEXT} A card was made the deck's commander. ${ID_CONTEXT}`,
  },
  'domain.change.unsetCommander': {
    description: `${CHANGE_CONTEXT} A card stopped being the deck's commander. ${ID_CONTEXT}`,
  },
  'domain.change.setFinish': {
    description: `${CHANGE_CONTEXT} A card's finish changed. {finish} is one of the untranslated file tokens nonfoil / foil / etched. ${ID_CONTEXT}`,
  },
  'domain.change.setPrinting': {
    description: `${CHANGE_CONTEXT} A card was pinned to a specific printing. {printing} is a pre-rendered descriptor like "NEO:234 [foil] [ja]" — never translate it. ${ID_CONTEXT}`,
  },
  'domain.change.setPrintingNone': {
    description: `${CHANGE_CONTEXT} A card's pinned printing was cleared, so any printing of the card counts again. ${ID_CONTEXT}`,
  },
  'domain.change.setLanguage': {
    description: `${CHANGE_CONTEXT} A card's *printing* language changed — the language the physical card is printed in, not the interface language. {language} is that language's name, already rendered in the reader's locale. ${ID_CONTEXT}`,
  },
  'domain.change.setNote': {
    description: `${CHANGE_CONTEXT} A free-text note was written on a card. {note} is the user's own text; keep it inside quotation marks appropriate to the target language. ${ID_CONTEXT}`,
  },
  'domain.change.clearNote': {
    description: `${CHANGE_CONTEXT} A card's note was deleted. ${ID_CONTEXT}`,
  },
  'domain.change.setLabels': {
    description: `${CHANGE_CONTEXT} A card's labels were set. {labels} is a comma-joined list of the untranslated tokens sale / trade / keep; keep the square brackets, which are file-format punctuation. ${ID_CONTEXT}`,
  },
  'domain.change.clearLabels': {
    description: `${CHANGE_CONTEXT} A card's label override was cleared, so the list default applies again. ${ID_CONTEXT}`,
  },
  'domain.change.moveToList': {
    description: `${CHANGE_CONTEXT} A card moved out of this list into another one. {list} is the destination's rendered name, e.g. Deck 'Standard Burn'. ${ANNOTATION_CONTEXT}`,
  },
  'domain.change.moveFromList': {
    description: `${CHANGE_CONTEXT} A card moved into this list from another one. {list} is the source's rendered name. ${ANNOTATION_CONTEXT}`,
  },
  'domain.change.addSection': {
    description: `${CHANGE_CONTEXT} A section (a named group of cards within one list) was created. {section} is the user's own section name.`,
  },
  'domain.change.removeSection': {
    description: `${CHANGE_CONTEXT} A section was deleted. {section} is the user's own section name.`,
  },
  'domain.change.renameSection': {
    description: `${CHANGE_CONTEXT} A section was renamed. Both names are the user's own text.`,
  },
  'domain.change.setSection': {
    description: `${CHANGE_CONTEXT} A card moved into a different section of the same list. ${ID_CONTEXT}`,
  },
} as const satisfies MetaFor<typeof domainMessages>
