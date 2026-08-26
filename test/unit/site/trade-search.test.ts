import { describe, test, expect } from 'bun:test'
import { searchTradeEntries, type TradeSearchEntry } from '../../../src/site/useTradeData'
import { normalizeCardName } from '../../../src/card/term-match'
import { makeScryfallCard } from '../../test-utils'

/**
 * The trade page's search over the cards you own and want. How names are matched
 * and ranked is `term-match`'s business (and is pinned there); what this layer
 * owns is the wiring: matching against the key cached on each entry, searching
 * several lists at once, and ranking before the result cap rather than after.
 */

function entry(
  name: string,
  sourceKind: TradeSearchEntry['sourceKind'] = 'collection',
): TradeSearchEntry {
  return {
    name,
    nameKey: normalizeCardName(name),
    scryfallCard: makeScryfallCard({ name }),
    sourceName: 'Shoebox',
    sourceKind,
    maxQty: 1,
    cardIds: [1],
  }
}

const names = (entries: TradeSearchEntry[]): string[] => entries.map((e) => e.name)

describe('searchTradeEntries', () => {
  const collection = [entry("Lim-Dûl's Vault"), entry('Lightning Bolt')]

  test('matches the normalized key cached on each entry', () => {
    // Neither the accent nor the apostrophe has to be typed — the entry's nameKey
    // and the query are folded the same way.
    expect(names(searchTradeEntries('limduls vault', [collection]))).toEqual(["Lim-Dûl's Vault"])
  })

  test('searches every list it is given, in order', () => {
    const decks = [entry('Lightning Bolt', 'deck')]
    const results = searchTradeEntries('lightning bolt', [collection, decks])
    expect(results.map((e) => e.sourceKind)).toEqual(['collection', 'deck'])
  })

  test('a whole-name match survives the result cap', () => {
    // Ranking has to happen before the cut, or the card you spelled out in full is
    // dropped in favour of 20 longer names that merely contain it.
    const islands = [
      ...Array.from({ length: 25 }, (_, i) => entry(`Island of Wak-Wak ${i}`)),
      entry('Island'),
    ]
    const results = searchTradeEntries('island', [islands])
    expect(results).toHaveLength(20)
    expect(results[0]!.name).toBe('Island')
  })

  test('matches nothing until two characters are typed', () => {
    expect(searchTradeEntries('l', [collection])).toEqual([])
    expect(names(searchTradeEntries('li', [collection]))).toEqual([
      "Lim-Dûl's Vault",
      'Lightning Bolt',
    ])
  })

  test('a query of nothing but punctuation and spaces matches nothing', () => {
    // It normalizes away to no terms at all, which would otherwise match every card.
    expect(searchTradeEntries('  ', [collection])).toEqual([])
    expect(searchTradeEntries('!!', [collection])).toEqual([])
  })
})
