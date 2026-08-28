import { describe, test, expect } from 'bun:test'
import {
  removeChangeFor,
  addChangeFor,
  movesFrom,
  movesTo,
  overlayDeck,
  overlayCollection,
  overlayWanted,
  matchesTile,
  groupCards,
  needsPrintingFor,
  pendingMatchesTile,
  reconcilePendingMoves,
  type PendingMove,
} from '../../src/admin/site/move-overlay'
import { listId, listInfoId } from '../../src/admin/site/list-grouping'
import type { MovePhysicalCard } from '../../src/admin/api/move'
import type { ListInfo } from '../../src/list/list-info'
import type { DeckData } from '../../src/list/deck'
import type { CollectionCardEntry, WantedListCardEntry } from '../../src/list/site-data'
import { makeCollectionEntry } from '../test-utils'

const deckList: ListInfo = { type: 'deck', slug: 'my-deck', name: 'My Deck' }
const collList: ListInfo = { type: 'collection', slug: 'binder', name: 'Binder' }
const wantedList: ListInfo = { type: 'wanted', slug: 'wishlist', name: 'Wishlist' }

function physical(
  over: Partial<MovePhysicalCard> & Pick<MovePhysicalCard, 'name'>,
): MovePhysicalCard {
  return {
    key: `${over.listType ?? 'deck'}:${over.listSlug ?? 'my-deck'}:${over.cardId ?? over.name}:${over.copyIndex ?? 0}`,
    listType: over.listType ?? 'deck',
    listSlug: over.listSlug ?? 'my-deck',
    ...over,
  }
}

function move(
  over: Partial<PendingMove> & Pick<PendingMove, 'from' | 'to' | 'source'>,
): PendingMove {
  return {
    id: over.id ?? 'm1',
    cardKey: over.cardKey ?? 'k1',
    dest: over.dest ?? {
      set: over.source.set,
      collectorNumber: over.source.collectorNumber,
      finish: over.source.finish,
      condition: over.source.condition,
    },
    ...over,
  }
}

describe('listId / listInfoId', () => {
  test('compose type:slug', () => {
    expect(listId('deck', 'foo')).toBe('deck:foo')
    expect(listInfoId(collList)).toBe('collection:binder')
  })
})

describe('change builders', () => {
  const m = move({
    from: deckList,
    to: collList,
    source: { name: 'Sol Ring', set: 'c19', collectorNumber: '221', finish: 'foil', cardId: 5 },
    dest: { set: 'lea', collectorNumber: '1', finish: 'nonfoil', condition: 'NM' },
  })

  test('removeChangeFor carries the source identity and card id', () => {
    const change = removeChangeFor(m)
    expect(change).toMatchObject({
      action: 'remove',
      cardName: 'Sol Ring',
      set: 'c19',
      collectorNumber: '221',
      finish: 'foil',
      cardId: 5,
    })
  })

  test('addChangeFor carries the destination printing and omits the card id', () => {
    const change = addChangeFor(m)
    expect(change).toMatchObject({
      action: 'add',
      cardName: 'Sol Ring',
      set: 'lea',
      collectorNumber: '1',
      finish: 'nonfoil',
      condition: 'NM',
    })
    expect('cardId' in change ? change.cardId : undefined).toBeUndefined()
  })
})

describe('movesFrom / movesTo', () => {
  const a = move({ id: 'a', from: deckList, to: collList, source: { name: 'A' } })
  const b = move({ id: 'b', from: collList, to: deckList, source: { name: 'B' } })
  const pending = [a, b]

  test('partitions by source and destination list', () => {
    expect(movesFrom(pending, listInfoId(deckList))).toEqual([a])
    expect(movesTo(pending, listInfoId(deckList))).toEqual([b])
  })
})

describe('overlayDeck', () => {
  const baseDeck = (): DeckData => ({
    name: 'My Deck',
    sections: [{ name: 'Main', cards: [{ quantity: 3, name: 'Sol Ring', cardId: 5 }] }],
  })

  test('a single outbound move decrements the matching entry by one', () => {
    const out = move({
      from: deckList,
      to: collList,
      source: { name: 'Sol Ring', cardId: 5 },
    })
    const result = overlayDeck(baseDeck(), [out], listInfoId(deckList))
    expect(result.sections[0]!.cards[0]!.quantity).toBe(2)
  })

  test('three outbound moves remove the entry entirely', () => {
    const outs = [0, 1, 2].map((i) =>
      move({ id: `o${i}`, from: deckList, to: collList, source: { name: 'Sol Ring', cardId: 5 } }),
    )
    const result = overlayDeck(baseDeck(), outs, listInfoId(deckList))
    expect(result.sections[0]!.cards).toHaveLength(0)
  })

  test('an inbound move adds the card to the deck with the destination printing', () => {
    const incoming = move({
      from: collList,
      to: deckList,
      source: { name: 'Lightning Bolt', set: 'old', collectorNumber: '1' },
      dest: { set: 'lea', collectorNumber: '161', finish: 'nonfoil' },
    })
    const result = overlayDeck(baseDeck(), [incoming], listInfoId(deckList))
    const added = result.sections.flatMap((s) => s.cards).find((c) => c.name === 'Lightning Bolt')
    expect(added).toBeDefined()
    // The added entry must carry the destination printing, not the source printing.
    expect(added!.set).toBe('lea')
    expect(added!.collectorNumber).toBe('161')
  })
})

describe('overlayCollection', () => {
  const baseEntries = (): CollectionCardEntry[] => [
    makeCollectionEntry({ name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }),
    makeCollectionEntry({
      name: 'Brainstorm',
      set: 'mh2',
      collectorNumber: '42',
      fileOrder: 1,
      cardId: 2,
    }),
  ]

  test('removes an outbound entry by card id', () => {
    const out = move({
      from: collList,
      to: deckList,
      source: { name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 },
    })
    const result = overlayCollection(baseEntries(), [out], listInfoId(collList))
    expect(result.map((e) => e.name)).toEqual(['Brainstorm'])
  })

  test('appends an inbound entry', () => {
    const incoming = move({
      from: deckList,
      to: collList,
      source: { name: 'Counterspell' },
      dest: { set: 'mh3', collectorNumber: '50', finish: 'nonfoil', condition: 'NM' },
    })
    const result = overlayCollection(baseEntries(), [incoming], listInfoId(collList))
    expect(result.map((e) => e.name)).toContain('Counterspell')
  })
})

describe('overlayWanted', () => {
  const baseEntries = (): WantedListCardEntry[] => [
    { name: 'Mana Crypt', price: 0, fileOrder: 0, section: 'Main', state: 'name-only', cardId: 1 },
  ]

  test('removes an outbound entry and adds an inbound one', () => {
    const out = move({ from: wantedList, to: deckList, source: { name: 'Mana Crypt', cardId: 1 } })
    const incoming = move({
      id: 'in',
      from: deckList,
      to: wantedList,
      source: { name: 'Sol Ring' },
    })
    const result = overlayWanted(baseEntries(), [out, incoming], listInfoId(wantedList))
    expect(result.map((e) => e.name)).toEqual(['Sol Ring'])
  })
})

describe('matchesTile', () => {
  const card = physical({
    name: 'Sol Ring',
    set: 'c19',
    collectorNumber: '221',
    finish: 'nonfoil',
    condition: 'NM',
    cardId: 5,
  })

  test('matches by card id when the tile lists it', () => {
    expect(matchesTile(card, { cardName: 'Sol Ring', cardIds: [5] })).toBe(true)
    expect(matchesTile(card, { cardName: 'Sol Ring', cardIds: [9] })).toBe(false)
  })

  test('falls back to name + printing when no ids are available', () => {
    const noId = physical({ name: 'Sol Ring', set: 'c19', collectorNumber: '221' })
    expect(
      matchesTile(noId, { cardName: 'Sol Ring', cardIds: [], set: 'c19', collectorNumber: '221' }),
    ).toBe(true)
    expect(
      matchesTile(noId, { cardName: 'Sol Ring', cardIds: [], set: 'lea', collectorNumber: '1' }),
    ).toBe(false)
  })

  test('a different name never matches', () => {
    expect(matchesTile(card, { cardName: 'Brainstorm', cardIds: [5] })).toBe(false)
  })

  test('an id-less card does not match an id-based tile', () => {
    const noId = physical({ name: 'Sol Ring', set: 'c19', collectorNumber: '221' })
    expect(matchesTile(noId, { cardName: 'Sol Ring', cardIds: [5] })).toBe(false)
  })
})

describe('groupCards', () => {
  test('collapses identical deck copies into one group with shared id', () => {
    const cards = [0, 1, 2].map((i) =>
      physical({ name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 5, copyIndex: i }),
    )
    const groups = groupCards(cards)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.keys).toHaveLength(3)
    expect(groups[0]!.cardIds).toEqual([5])
  })

  test('keeps distinct card ids for grouped collection lines', () => {
    const cards = [
      physical({
        name: 'Sol Ring',
        listType: 'collection',
        listSlug: 'binder',
        set: 'c19',
        collectorNumber: '221',
        cardId: 1,
      }),
      physical({
        name: 'Sol Ring',
        listType: 'collection',
        listSlug: 'binder',
        set: 'c19',
        collectorNumber: '221',
        cardId: 2,
      }),
    ]
    const groups = groupCards(cards)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.cardIds).toEqual([1, 2])
  })

  test('separates different printings and notes', () => {
    const cards = [
      physical({ name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }),
      physical({ name: 'Sol Ring', set: 'lea', collectorNumber: '1', cardId: 2 }),
      physical({ name: 'Sol Ring', set: 'c19', collectorNumber: '221', note: 'signed', cardId: 3 }),
    ]
    expect(groupCards(cards)).toHaveLength(3)
  })
})

describe('needsPrintingFor', () => {
  test('a printing-less card needs one only for a collection', () => {
    expect(needsPrintingFor('collection', {})).toBe(true)
    expect(needsPrintingFor('collection', { set: 'lea', collectorNumber: '1' })).toBe(false)
    expect(needsPrintingFor('deck', {})).toBe(false)
    expect(needsPrintingFor('wanted', {})).toBe(false)
  })
})

describe('pendingMatchesTile', () => {
  test('matches a moved-in card by name and destination printing', () => {
    const m = move({
      from: collList,
      to: deckList,
      source: { name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 },
      dest: { set: 'c19', collectorNumber: '221' },
    })
    // A moved-in tile renders with the destination printing and no id.
    expect(
      pendingMatchesTile(m, {
        cardName: 'Sol Ring',
        cardIds: [],
        set: 'c19',
        collectorNumber: '221',
      }),
    ).toBe(true)
    expect(
      pendingMatchesTile(m, {
        cardName: 'Sol Ring',
        cardIds: [],
        set: 'lea',
        collectorNumber: '1',
      }),
    ).toBe(false)
    expect(pendingMatchesTile(m, { cardName: 'Brainstorm', cardIds: [] })).toBe(false)
  })
})

describe('reconcilePendingMoves', () => {
  let idCounter = 0
  const newId = () => `id-${idCounter++}`

  const binderCard = () =>
    physical({
      name: 'Sol Ring',
      listType: 'collection',
      listSlug: 'binder',
      set: 'c19',
      collectorNumber: '221',
      cardId: 1,
    })
  const binderTile = { cardName: 'Sol Ring', cardIds: [1], set: 'c19', collectorNumber: '221' }
  // The same card as it renders once moved into another list: no stable id, dest printing.
  const movedInTile = { cardName: 'Sol Ring', cardIds: [], set: 'c19', collectorNumber: '221' }

  test('queues a fresh move for a native card', () => {
    const card = binderCard()
    const result = reconcilePendingMoves({
      pending: [],
      allCards: [card],
      sourceList: collList,
      target: binderTile,
      count: 1,
      dest: deckList,
      newId,
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.cardKey).toBe(card.key)
    expect(result[0]!.from).toEqual(collList)
    expect(result[0]!.to).toEqual(deckList)
  })

  test('moving a queued card back to its origin cancels it (net no-op)', () => {
    const card = binderCard()
    const afterMove = reconcilePendingMoves({
      pending: [],
      allCards: [card],
      sourceList: collList,
      target: binderTile,
      count: 1,
      dest: deckList,
      newId,
    })
    expect(afterMove).toHaveLength(1)
    // The card now lives (virtually) in the deck; move it back to the collection.
    const afterUndo = reconcilePendingMoves({
      pending: afterMove,
      allCards: [card],
      sourceList: deckList,
      target: movedInTile,
      count: 1,
      dest: collList,
      newId,
    })
    expect(afterUndo).toHaveLength(0)
  })

  test('moving a queued card onward collapses the chain A→B→C into A→C', () => {
    const card = binderCard()
    const afterFirst = reconcilePendingMoves({
      pending: [],
      allCards: [card],
      sourceList: collList,
      target: binderTile,
      count: 1,
      dest: deckList,
      newId,
    })
    const afterChain = reconcilePendingMoves({
      pending: afterFirst,
      allCards: [card],
      sourceList: deckList,
      target: movedInTile,
      count: 1,
      dest: wantedList,
      newId,
    })
    expect(afterChain).toHaveLength(1)
    expect(afterChain[0]!.from).toEqual(collList) // origin preserved
    expect(afterChain[0]!.to).toEqual(wantedList) // final destination
  })

  test('a move to the card’s own list is a no-op (returns the same list)', () => {
    const pending: PendingMove[] = []
    const result = reconcilePendingMoves({
      pending,
      allCards: [binderCard()],
      sourceList: collList,
      target: binderTile,
      count: 1,
      dest: collList,
      newId,
    })
    expect(result).toBe(pending)
  })

  test('queues only `count` of the available copies', () => {
    const cards = [0, 1, 2].map((i) =>
      physical({
        name: 'Sol Ring',
        listType: 'deck',
        listSlug: 'my-deck',
        cardId: 5,
        copyIndex: i,
      }),
    )
    const result = reconcilePendingMoves({
      pending: [],
      allCards: cards,
      sourceList: deckList,
      target: { cardName: 'Sol Ring', cardIds: [5] },
      count: 2,
      dest: collList,
      newId,
    })
    expect(result).toHaveLength(2)
  })
})
