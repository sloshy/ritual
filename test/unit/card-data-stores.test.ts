import { describe, test, expect } from 'bun:test'
import { makePrintingIn as printing } from '../test-utils'
import { useDeckCardData } from '../../src/editor/useDeckCardData'
import { useEntryCardData } from '../../src/editor/useEntryCardData'

/**
 * The editors' two card-data stores, on the one rule they share: `addCard`
 * *seeds* a name's representative, `setPrices` *assigns* it.
 *
 * The representative is what a line that pins no printing renders, so learning
 * one specific printing — the printing picker resolving some copies of a
 * name-only line, an add of a pinned copy of a card already on the list — must
 * leave the copies that still pin nothing showing what they showed before. A
 * price refresh is the opposite: it is *about* the by-name card, and replaces it.
 */

const LEA = printing('lea', '161')
const M10 = printing('m10', '146')
const STA_JA = printing('sta', '42', 'ja')

/** The deck store's by-name maps: which one a tile reads follows the Lowest Price toggle. */
const DECK_NAME_MAPS = [
  'cards',
  'lowestPriceCards',
  'lowestPriceCardsEur',
  'lowestPriceCardsTix',
] as const

describe('useDeckCardData', () => {
  test('a printing learned later never displaces the representative, in any map', () => {
    const [state, actions] = useDeckCardData()
    actions.addCard('Lightning Bolt', LEA, [LEA, M10])

    actions.addCard('Lightning Bolt', M10, [LEA, M10])

    for (const map of DECK_NAME_MAPS) {
      expect(state[map]['Lightning Bolt']).toBe(LEA)
    }
    // The pinned line resolves its own printing out of the full list instead.
    expect(state.printings['Lightning Bolt']).toEqual([LEA, M10])
  })

  test('a card handed over with no printing list still lands in `printings`', () => {
    const [state, actions] = useDeckCardData()
    // Held onto: the store files the caller's array by reference, so filing the
    // loose card must rebuild the list rather than mutate what the caller (and
    // the site's session cache) still holds.
    const asHandedOver = [LEA]
    actions.addCard('Lightning Bolt', LEA, asHandedOver)

    // The pinned line resolves out of `printings`, and this is the only map a
    // deck keys printings in — so an unlisted card must not fall on the floor.
    actions.addCard('Lightning Bolt', M10)

    expect(state.printings['Lightning Bolt']).toEqual([LEA, M10])
    expect(asHandedOver).toEqual([LEA])
  })

  test('setPrices replaces the representative — the case the seed rule is not', () => {
    const [state, actions] = useDeckCardData()
    actions.addCard('Lightning Bolt', LEA, [LEA, M10])

    actions.setPrices('Lightning Bolt', M10, M10, null, M10, [LEA, M10])

    expect(state.cards['Lightning Bolt']).toBe(M10)
    expect(state.lowestPriceCards['Lightning Bolt']).toBe(M10)
  })
})

describe('useEntryCardData', () => {
  test('a printing learned later keys itself without displacing the representative', () => {
    const [state, actions] = useEntryCardData()
    actions.addCard('Lightning Bolt', LEA, [LEA])

    actions.addCard('Lightning Bolt', M10, [LEA, M10])

    expect(state.cards['Lightning Bolt']).toBe(LEA)
    // The newly pinned entry still resolves, by its own `set:cn` key.
    expect(state.cards['m10:146']).toBe(M10)
  })

  test('setPrices replaces the representative', () => {
    const [state, actions] = useEntryCardData()
    actions.addCard('Lightning Bolt', LEA, [LEA])

    actions.setPrices('Lightning Bolt', M10, [LEA, M10])

    expect(state.cards['Lightning Bolt']).toBe(M10)
  })

  test('an English printing reclaims a representative a foreign one seeded', () => {
    const [state, actions] = useEntryCardData()
    actions.addCard('Lightning Bolt', STA_JA, [STA_JA])

    actions.addCard('Lightning Bolt', LEA, [LEA, STA_JA])

    expect(state.cards['Lightning Bolt']).toBe(LEA)
    expect(state.cards['sta:42@ja']).toBe(STA_JA)
  })
})
