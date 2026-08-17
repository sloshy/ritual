import { describe, expect, test } from 'bun:test'
import {
  cardPriceText,
  cardPricelessMarkerText,
  cardPricelessReason,
  isPricelessCard,
  pricelessMarkerKey,
  pricelessMarkerText,
} from '../../../src/site/priceless'
import { PRICELESS_REASONS } from '../../../src/card-labels'
import { t } from '../../../src/i18n/t'

// The site's adapter over the one "no price, no quote, no sale" rule. What
// matters here is which card field feeds which half of that rule — the
// precedence between the two reasons belongs to `card-labels.test.ts` — and
// that a priceless copy never renders a currency amount: "$0.00" would read as
// a price rather than as the refusal to quote one.

describe('cardPricelessReason', () => {
  // The adapter, not the rule: which card field feeds which half of
  // `pricelessReason`. The precedence between the two is pinned once, in
  // `card-labels.test.ts`.
  test('maps a card’s labels and art onto the priceless rule', () => {
    expect(cardPricelessReason({ labels: ['proxy'] })).toBe('proxy')
    expect(cardPricelessReason({ customArt: 'https://example.com/bolt.png' })).toBe('custom-art')
  })

  test('an ordinary copy prices normally', () => {
    expect(cardPricelessReason({ labels: ['sale', 'trade'] })).toBeUndefined()
    expect(cardPricelessReason({})).toBeUndefined()
    expect(isPricelessCard({})).toBe(false)
    expect(isPricelessCard({ labels: ['keep'], customArt: 'art/bolt.png' })).toBe(true)
  })

  test('the baked fact outranks the display URL', () => {
    // A file the build could not deploy bakes no URL — the card falls back to
    // its real art — but the copy in hand still wears custom art, so it is
    // still priceless. This is the one thing the URL alone cannot say, and the
    // reason the bakers ship `hasCustomArt` beside it.
    expect(cardPricelessReason({ hasCustomArt: true })).toBe('custom-art')
    expect(isPricelessCard({ hasCustomArt: true })).toBe(true)
    // An explicit `false` is the sidecar saying this card has no art at all.
    expect(cardPricelessReason({ hasCustomArt: false, customArt: 'art/bolt.png' })).toBeUndefined()
  })
})

describe('marker keys', () => {
  test('each reason names a real message, rendered as a stamp', () => {
    expect(t(pricelessMarkerKey('proxy'))).toBe('PROXY')
    expect(t(pricelessMarkerKey('custom-art'))).toBe('CUSTOM')
  })

  test('the marker text helpers render those keys, and nothing for a priced copy', () => {
    expect(pricelessMarkerText(t, 'custom-art')).toBe('CUSTOM')
    expect(pricelessMarkerText(t, undefined)).toBeUndefined()
    expect(cardPricelessMarkerText(t, { hasCustomArt: true })).toBe('CUSTOM')
    expect(cardPricelessMarkerText(t, { labels: ['proxy'] })).toBe('PROXY')
    expect(cardPricelessMarkerText(t, {})).toBeUndefined()
  })
})

describe('the marker reads the same on every surface', () => {
  // The CLI price browser and the sites keep their own catalog keys (each is
  // documented for its own column), but a card has to read identically in
  // `ritual price` and in the browser — that sameness is the contract, so it is
  // pinned rather than left to two independently edited descriptions.
  const CLI_MARKER_KEYS = {
    proxy: 'cli.price.markerProxy',
    'custom-art': 'cli.price.markerCustomArt',
  } as const

  for (const reason of PRICELESS_REASONS) {
    test(`${reason} renders identically in the CLI and on the site`, () => {
      expect(t(CLI_MARKER_KEYS[reason])).toBe(t(pricelessMarkerKey(reason)))
    })
  }
})

describe('cardPriceText', () => {
  test('a priceless copy reads as its marker, never as an amount', () => {
    expect(cardPriceText(t, { labels: ['proxy'] }, 12.5, 'usd')).toBe('PROXY')
    expect(cardPriceText(t, { customArt: 'art/bolt.png' }, 12.5, 'usd')).toBe('CUSTOM')
    expect(cardPriceText(t, { hasCustomArt: true }, 12.5, 'usd')).toBe('CUSTOM')
  })

  test('an ordinary copy reads as its formatted price, N/A when it has none', () => {
    expect(cardPriceText(t, {}, 12.5, 'usd')).toBe('$12.50')
    expect(cardPriceText(t, {}, 0, 'usd')).toBe('N/A')
  })
})
