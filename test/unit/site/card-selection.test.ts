import { describe, expect, test, beforeEach } from 'bun:test'
import {
  useCardSelection,
  useAllSelections,
  clearAllSelections,
  groupSelectionsBySource,
  type SelectedCard,
  type SelectionListId,
} from '../../../src/list-view/useCardSelection'
import { makeScryfallCard } from '../../test-utils'

const DECK: SelectionListId = { kind: 'deck', name: 'My Deck' }
const COLLECTION: SelectionListId = { kind: 'collection', name: 'My Cards' }

function card(list: SelectionListId, key: string, over: Partial<SelectedCard> = {}): SelectedCard {
  return {
    key,
    name: 'Card',
    quantity: 1,
    groupSize: 1,
    scryfallCard: null,
    sourceName: list.name,
    sourceKind: list.kind,
    maxQty: 1,
    cardIds: [],
    ...over,
  }
}

// The store is module-global, so reset it before each test.
beforeEach(() => clearAllSelections())

describe('useCardSelection (single-copy tiles)', () => {
  test('starts empty', () => {
    const sel = useCardSelection(DECK)
    expect(sel.count()).toBe(0)
    expect(sel.selected()).toEqual([])
    expect(sel.state('a')).toBe('none')
  })

  test('toggle selects, then a second toggle deselects', () => {
    const sel = useCardSelection(DECK)
    sel.toggle(card(DECK, 'a'))
    expect(sel.count()).toBe(1)
    expect(sel.state('a')).toBe('all')
    sel.toggle(card(DECK, 'a'))
    expect(sel.count()).toBe(0)
    expect(sel.state('a')).toBe('none')
  })

  test('clear empties only this list', () => {
    const deck = useCardSelection(DECK)
    const collection = useCardSelection(COLLECTION)
    deck.toggle(card(DECK, 'a'))
    collection.toggle(card(COLLECTION, 'a'))
    deck.clear()
    expect(deck.count()).toBe(0)
    expect(collection.count()).toBe(1)
  })
})

describe('quantity groups (tri-state)', () => {
  const bolt = () => card(DECK, 'bolt', { quantity: 4, groupSize: 4 })

  test('toggling a group selects every copy and counts them individually', () => {
    const sel = useCardSelection(DECK)
    sel.toggle(bolt())
    expect(sel.state('bolt')).toBe('all')
    expect(sel.count()).toBe(4)
  })

  test('removeOne drops a single copy, leaving the group partial', () => {
    const sel = useCardSelection(DECK)
    sel.toggle(bolt())
    sel.removeOne(bolt())
    expect(sel.count()).toBe(3)
    expect(sel.state('bolt')).toBe('partial')
  })

  test('removing the last copy clears the tile entirely', () => {
    const sel = useCardSelection(DECK)
    sel.toggle(bolt())
    for (let i = 0; i < 4; i++) sel.removeOne(bolt())
    expect(sel.count()).toBe(0)
    expect(sel.state('bolt')).toBe('none')
  })

  test('toggling a partially-selected group fills it back to full', () => {
    const sel = useCardSelection(DECK)
    sel.toggle(bolt())
    sel.removeOne(bolt()) // 3/4, partial
    sel.toggle(bolt()) // re-fill
    expect(sel.state('bolt')).toBe('all')
    expect(sel.count()).toBe(4)
  })

  test('toggling a fully-selected group clears it', () => {
    const sel = useCardSelection(DECK)
    sel.toggle(bolt())
    sel.toggle(bolt())
    expect(sel.state('bolt')).toBe('none')
    expect(sel.count()).toBe(0)
  })
})

describe('cross-list selection', () => {
  test('the same local key on two lists does not collide', () => {
    const deck = useCardSelection(DECK)
    const collection = useCardSelection(COLLECTION)
    deck.toggle(card(DECK, 'a'))
    collection.toggle(card(COLLECTION, 'a'))
    expect(deck.state('a')).toBe('all')
    expect(collection.state('a')).toBe('all')
    expect(deck.count()).toBe(1)
    expect(collection.count()).toBe(1)
  })

  test('useAllSelections sums copies across every list', () => {
    useCardSelection(DECK).toggle(card(DECK, 'a', { quantity: 2, groupSize: 2 }))
    useCardSelection(COLLECTION).toggle(card(COLLECTION, 'b'))
    const all = useAllSelections()
    expect(all.count()).toBe(3)
    all.clear()
    expect(all.count()).toBe(0)
  })
})

describe('selection value', () => {
  const priced = makeScryfallCard({ name: 'Sol Ring', prices: { usd: '3.00', eur: '2.00' } })

  test('quantity-weights the resolved card’s price in the asked-for currency', () => {
    const sel = useCardSelection(DECK)
    sel.toggle(card(DECK, 'sol', { quantity: 2, groupSize: 2, scryfallCard: priced }))
    expect(sel.value('usd')).toBe(6)
    expect(sel.value('eur')).toBe(4)
  })

  test('a proxy copy is worth nothing, whatever its printing sells for', () => {
    const sel = useCardSelection(DECK)
    sel.toggle(
      card(DECK, 'sol', { quantity: 2, groupSize: 2, scryfallCard: priced, labels: ['proxy'] }),
    )
    expect(sel.value('usd')).toBe(0)
  })

  test('a non-proxy label still prices normally', () => {
    const sel = useCardSelection(COLLECTION)
    sel.toggle(card(COLLECTION, 'sol', { scryfallCard: priced, labels: ['keep'] }))
    expect(sel.value('usd')).toBe(3)
  })

  test('a copy wearing custom art is worth nothing either', () => {
    const sel = useCardSelection(COLLECTION)
    sel.toggle(
      card(COLLECTION, 'sol', {
        quantity: 2,
        groupSize: 2,
        scryfallCard: priced,
        customArt: 'art/sol-ring.jpg',
      }),
    )
    expect(sel.value('usd')).toBe(0)
  })

  test('a proxy tile whose card never resolved ignores its captured price too', () => {
    const sel = useCardSelection(DECK)
    sel.toggle(card(DECK, 'sol', { price: 3, labels: ['proxy'] }))
    expect(sel.value('usd')).toBe(0)
  })
})

describe('groupSelectionsBySource', () => {
  test('groups cards by source list, preserving first-seen source order', () => {
    const groups = groupSelectionsBySource([
      card(DECK, 'a'),
      card(COLLECTION, 'a'),
      card(DECK, 'b'),
    ])
    expect(groups.map((g) => ({ kind: g.kind, name: g.name }))).toEqual([
      { kind: 'deck', name: 'My Deck' },
      { kind: 'collection', name: 'My Cards' },
    ])
    expect(groups[0]!.cards.map((c) => c.key)).toEqual(['a', 'b'])
    expect(groups[1]!.cards.map((c) => c.key)).toEqual(['a'])
  })

  test('returns an empty array for no cards', () => {
    expect(groupSelectionsBySource([])).toEqual([])
  })
})
