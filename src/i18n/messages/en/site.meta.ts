/** Translator metadata for the `site.*` namespace. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { siteMessages } from './site'

export const siteMeta = {
  'site.prices.staleNotice': {
    description:
      'Collapsed warning on a list page: these cards were priced at an earlier moment than the others, so the totals mix two price dates. Expanding it names them.',
  },
  'site.tagFilter.untagged': {
    description:
      'Warning shown while a tag filter is active: cards added in this editing session carry no Scryfall tag data, so the filter cannot judge them.',
  },
  'site.deck.missingPricing': {
    description:
      'Banner naming cards with no price in the chosen currency. {currency} is a currency code already uppercased by the caller (USD, EUR, TIX) — leave it as-is.',
  },
  'site.find.notFound': {
    description:
      'Result of a Find search: these pasted names matched no card in any list, and are left in the paste box so they can be corrected.',
  },
  'site.find.selected': {
    description:
      'How many cards the Find page has selected. {count} counts copies, not distinct cards.',
  },
  'site.findPrintings.summary': {
    description:
      'Summary of the "find other printings" modal: how many copies were found, and in how many lists. {lists} is an already-rendered count phrase from ui.count.lists (e.g. "2 lists").',
  },
  'site.combine.selected': {
    description:
      'Footer of the combine-lists dialog: how many lists are ticked for the combined view.',
  },
  'site.trade.added': {
    description: 'Toast confirming cards were added to the trade board. {count} counts copies.',
  },
  'site.trade.pricesUpdated': {
    description:
      'Toast confirming the trade board re-fetched prices. {count} is how many cards got a new price.',
  },
  'site.trade.unknownCardIds': {
    description:
      'Warning while restoring a shared trade link: the link names card IDs the source list no longer holds. {ids} is a comma-separated list of numeric IDs; {sourceKind} is a list type and {sourceName} its name.',
  },
  'site.sell.notOnBuylist': {
    description:
      'Part of the parenthetical after a sell value: cards the buyer does not list at all.',
  },
  'site.sell.nonEnglish': {
    description:
      "Part of the parenthetical after a sell value: non-English copies, which the buyer's English-only feed can never quote.",
  },
} as const satisfies MetaFor<typeof siteMessages>
