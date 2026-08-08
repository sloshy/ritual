/**
 * `site.*` — public-site chrome (nav, toolbar, filters, card modal). Never
 * imported by CLI-only modules; the SPA may import `site`, `admin`, `ui`,
 * `domain` and `errors`, never `cli` or `help`.
 */

import type { MessageCatalogShape } from '../../types'

export const siteMessages = {
  // ── Notices ───────────────────────────────────────────────────────────
  'site.prices.staleNotice': {
    $plural: 'count',
    one: '{count} card has an older price than the rest',
    other: '{count} cards have an older price than the rest',
  },
  'site.tagFilter.untagged': {
    $plural: 'count',
    one: '{count} added card has no tag data — the tag filter may not match it',
    other: '{count} added cards have no tag data — the tag filter may not match them',
  },
  'site.deck.missingPricing': {
    $plural: 'count',
    one: '{count} card missing {currency} pricing',
    other: '{count} cards missing {currency} pricing',
  },

  // ── Find page ─────────────────────────────────────────────────────────
  'site.find.notFound': {
    $plural: 'count',
    one: '{count} card could not be found. The unmatched name remains in the box above.',
    other: '{count} cards could not be found. The unmatched names remain in the box above.',
  },
  'site.find.selected': {
    $plural: 'count',
    one: '{count} card selected',
    other: '{count} cards selected',
  },
  'site.findPrintings.summary': {
    $plural: 'count',
    one: '{count} copy across {lists}',
    other: '{count} copies across {lists}',
  },

  // ── Combined view ─────────────────────────────────────────────────────
  'site.combine.selected': {
    $plural: 'count',
    one: '{count} list selected',
    other: '{count} lists selected',
  },

  // ── Trade board ───────────────────────────────────────────────────────
  'site.trade.added': {
    $plural: 'count',
    one: 'Added {count} card to trade',
    other: 'Added {count} cards to trade',
  },
  'site.trade.pricesUpdated': {
    $plural: 'count',
    one: 'Updated prices for {count} card',
    other: 'Updated prices for {count} cards',
  },
  'site.trade.unknownCardIds': {
    $plural: 'count',
    one: 'Card with ID {ids} not found in {sourceKind} "{sourceName}".',
    other: 'Cards with IDs {ids} not found in {sourceKind} "{sourceName}".',
  },

  // ── Sell mode ─────────────────────────────────────────────────────────
  'site.sell.notOnBuylist': {
    $plural: 'count',
    one: '{count} card not on buylist',
    other: '{count} cards not on buylist',
  },
  'site.sell.nonEnglish': {
    $plural: 'count',
    one: '{count} non-English card — not quotable',
    other: '{count} non-English cards — not quotable',
  },
} as const satisfies MessageCatalogShape
