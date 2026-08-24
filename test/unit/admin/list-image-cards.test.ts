import { describe, expect, test } from 'bun:test'
import type { DeckData, ScryfallCard } from '../../../src/types'
import { makeScryfallCard } from '../../test-utils'
import {
  deckImageCardOptions,
  flatListImageCardOptions,
} from '../../../src/admin/site/list-image-cards'

/**
 * The rows the admin cover-image dialog's card picker offers.
 *
 * Two properties matter and neither is visible from the dialog's markup: a line
 * with no `&N` cannot be referenced at all, so it is left out rather than
 * offered and refused; and the two list shapes key their loaded cards
 * differently (a deck by name, a flat list by printing), so each lookup has to
 * be pinned separately or the previews silently go blank for one of them.
 */

const RING: ScryfallCard = makeScryfallCard({
  id: 'ring-c21',
  name: 'Sol Ring',
  set: 'c21',
  collector_number: '263',
  image_uris: {
    small: '',
    normal: 'https://img.test/ring.png',
    large: '',
    png: '',
    art_crop: '',
    border_crop: '',
  },
})

describe('flatListImageCardOptions', () => {
  test('keeps file order, uppercases the set code, and resolves the card by printing', () => {
    const options = flatListImageCardOptions(
      [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 4 },
        { name: 'Lightning Bolt', cardId: 2 },
      ],
      { 'c21:263': RING },
    )
    expect(options).toEqual([
      { cardId: 4, label: 'Sol Ring (C21:263)', image: 'https://img.test/ring.png' },
      { cardId: 2, label: 'Lightning Bolt' },
    ])
  })

  test('drops a line with no id — it has nothing a cover could name', () => {
    expect(flatListImageCardOptions([{ name: 'Sol Ring' }], {})).toEqual([])
  })
})

describe('deckImageCardOptions', () => {
  test('walks every section in order and resolves cards by name', () => {
    const deck: DeckData = {
      name: 'Cover Deck',
      sections: [
        {
          name: 'Commander',
          cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
        },
        { name: 'Main', cards: [{ quantity: 4, name: 'Lightning Bolt', cardId: 3 }] },
      ],
    }
    expect(deckImageCardOptions(deck, { 'Sol Ring': RING })).toEqual([
      { cardId: 1, label: 'Sol Ring (C21:263)', image: 'https://img.test/ring.png' },
      { cardId: 3, label: 'Lightning Bolt' },
    ])
  })

  test('drops a line with no id — the deck walk is its own implementation', () => {
    const deck: DeckData = {
      name: 'Cover Deck',
      sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }],
    }
    expect(deckImageCardOptions(deck, {})).toEqual([])
  })
})

describe('duplicate rows', () => {
  test('identical labels are disambiguated by the &N a pick would write', () => {
    // Four copies of one printing read identically, and *which* one the cover
    // names decides whether removing a copy clears it.
    const options = flatListImageCardOptions(
      [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 4 },
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 7 },
        { name: 'Lightning Bolt', cardId: 2 },
      ],
      {},
    )
    expect(options.map((option) => option.label)).toEqual([
      'Sol Ring (C21:263) &4',
      'Sol Ring (C21:263) &7',
      'Lightning Bolt',
    ])
  })
})
