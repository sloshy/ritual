import { describe, expect, test } from 'bun:test'
import { buylistRequestFor, isQuotableCard } from '../../src/buylist'
import { makeScryfallCard } from '../test-utils'

/**
 * The one rule both sides of the feature quote through: the server bake
 * (`build-site`, `serve --api`) and the client store's per-card lookup. They
 * must produce the identical `set:cn:finish` key — a near-miss does not yield a
 * blank cell, it yields a wrong price or a baked quote the page can never find
 * — so the rule lives in one module and is pinned here rather than at either
 * caller.
 */

const bolt = makeScryfallCard({
  id: 'bolt-lea',
  name: 'Lightning Bolt',
  set: 'LEA',
  collector_number: '161',
  finishes: ['nonfoil', 'foil'],
})

const foilOnly = makeScryfallCard({
  id: 'angel-foil',
  name: 'Serra Angel',
  set: 'fdn',
  collector_number: '35',
  finishes: ['foil'],
})

const boltJa = makeScryfallCard({ ...bolt, id: 'bolt-lea-ja', lang: 'ja' })

describe('buylistRequestFor', () => {
  test('quotes each finish of a printing under its own request, with a lowercased set', () => {
    // Set codes are lowercase internally, whatever case the card object carries.
    expect(buylistRequestFor(bolt, 'nonfoil')).toEqual({
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      scryfallId: 'bolt-lea',
    })
    expect(buylistRequestFor(bolt, 'foil')).toMatchObject({ finish: 'foil' })
  })

  test('a foil-only printing with no finish token is quoted as foil', () => {
    // Through `displayFinish`: asking for a nonfoil the buyer cannot stock
    // reads back as "not on the buylist" on a card whose tile shows a price.
    expect(buylistRequestFor(foilOnly, undefined)).toMatchObject({
      set: 'fdn',
      collectorNumber: '35',
      finish: 'foil',
    })
  })

  test('no resolved card means no request at all', () => {
    expect(buylistRequestFor(null, 'nonfoil')).toBeNull()
  })

  test('an English entry forwards no language token', () => {
    expect(buylistRequestFor(bolt, 'nonfoil', 'en')).toMatchObject({ language: 'en' })
    expect(buylistRequestFor(bolt, 'nonfoil')).not.toHaveProperty('language')
  })

  describe('the English-only gate', () => {
    test('refuses a [ja] entry even when its card object is the English printing', () => {
      // The degraded case under the default `en` cache: no `@ja` object is
      // baked, so the line resolves to the English printing and would otherwise
      // read the `lea:161:nonfoil` key an English sibling registered.
      expect(buylistRequestFor(bolt, 'nonfoil', 'ja')).toBeNull()
      expect(isQuotableCard(bolt, 'ja')).toBe(false)
    })

    test('refuses a [ja] entry whose ja card object did resolve', () => {
      expect(buylistRequestFor(boltJa, 'nonfoil', 'ja')).toBeNull()
    })

    test('refuses a non-English card object even with no entry token', () => {
      // A list whose language objects are cached resolves a foreign printing
      // directly; the buyer's feed is English-only either way.
      expect(buylistRequestFor(boltJa, 'nonfoil')).toBeNull()
      expect(isQuotableCard(boltJa)).toBe(false)
    })

    test('an English entry on an English object is quotable', () => {
      expect(isQuotableCard(bolt, 'en')).toBe(true)
      expect(isQuotableCard(bolt)).toBe(true)
    })
  })
})
