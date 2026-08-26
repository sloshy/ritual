import { describe, expect, test } from 'bun:test'
import {
  buildFindPrintingsGroups,
  countFindPrintingsCopies,
} from '../../../src/list-view/find-printings'
import { cardNavMatchesList } from '../../../src/site/card-nav'
import { buildCombinedCards, type LoadedListDetail } from '../../../src/list-view/combined-list'
import type { DeckDetail, CollectionDetail, WantedListDetail } from '../../../src/list/site-data'
import { makeScryfallCard } from '../../test-utils'

const ventsRtr = makeScryfallCard({
  id: 'vents-rtr',
  name: 'Steam Vents',
  set: 'rtr',
  collector_number: '247',
})
// Double-art printing: full name carries both faces, front face matches.
const ventsDouble = makeScryfallCard({
  id: 'vents-gru',
  name: 'Steam Vents // Steam Vents',
  set: 'grn',
  collector_number: '999',
})
const bolt = makeScryfallCard({
  id: 'bolt',
  name: 'Lightning Bolt',
  type_line: 'Instant',
  set: 'lea',
  collector_number: '161',
  color_identity: ['R'],
})

function deckDetail(): Extract<LoadedListDetail, { kind: 'deck' }> {
  const detail = {
    deck: {
      name: 'Izzet Deck',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 2, name: 'Steam Vents', set: 'rtr', collectorNumber: '247', cardId: 1 },
            { quantity: 1, name: 'Lightning Bolt', cardId: 2 },
          ],
        },
      ],
    },
    cards: { 'Steam Vents': ventsRtr, 'Lightning Bolt': bolt },
    printings: { 'Steam Vents': [ventsRtr, ventsDouble], 'Lightning Bolt': [bolt] },
    symbolMap: {},
  } as unknown as DeckDetail
  return { ref: { type: 'deck', slug: 'izzet' }, name: 'Izzet Deck', kind: 'deck', detail }
}

function collectionDetail(): Extract<LoadedListDetail, { kind: 'collection' }> {
  const detail = {
    name: 'Binder',
    entries: [
      {
        name: 'Steam Vents // Steam Vents',
        set: 'grn',
        collectorNumber: '999',
        finish: 'foil',
        condition: 'NM',
        price: 30,
        fileOrder: 0,
        section: 'Main',
        cardId: 1,
      },
      {
        name: 'Steam Vents',
        set: 'rtr',
        collectorNumber: '247',
        finish: 'nonfoil',
        condition: 'LP',
        price: 12,
        fileOrder: 1,
        section: 'Main',
        cardId: 2,
      },
    ],
    cards: { 'grn:999': ventsDouble, 'rtr:247': ventsRtr },
    printings: { 'Steam Vents': [ventsRtr, ventsDouble] },
    symbolMap: {},
  } as unknown as CollectionDetail
  return { ref: { type: 'collection', slug: 'binder' }, name: 'Binder', kind: 'collection', detail }
}

function wantedDetail(): Extract<LoadedListDetail, { kind: 'wanted' }> {
  const detail = {
    name: 'Wants',
    entries: [
      { name: 'Lightning Bolt', price: 1, fileOrder: 0, section: 'Main', state: 'name-only' },
    ],
    cards: { 'Lightning Bolt': bolt },
    printings: { 'Lightning Bolt': [bolt] },
    symbolMap: {},
  } as unknown as WantedListDetail
  return { ref: { type: 'wanted', slug: 'wants' }, name: 'Wants', kind: 'wanted', detail }
}

function allCards() {
  return buildCombinedCards([deckDetail(), collectionDetail(), wantedDetail()], 'usd', false)
}

describe('buildFindPrintingsGroups', () => {
  test('groups every copy by source list, matching double-sided names by front face', () => {
    const groups = buildFindPrintingsGroups(allCards(), 'Steam Vents')
    expect(groups.map((g) => `${g.kind}:${g.slug}`)).toEqual(['deck:izzet', 'collection:binder'])
    // No current list given: nothing is flagged and load order is kept.
    expect(groups.every((g) => !g.isCurrent)).toBe(true)

    const [deck, binder] = groups
    // The 2x deck line expands to two side-by-side copies of the same tile.
    expect(deck!.copies).toHaveLength(2)
    expect(deck!.copies.map((c) => c.copy)).toEqual([0, 1])
    expect(deck!.copies[0]!.tile).toBe(deck!.copies[1]!.tile)

    // The double-art `Steam Vents // Steam Vents` entry matches too.
    expect(binder!.name).toBe('Binder')
    expect(binder!.copies.map((c) => c.tile.name)).toEqual([
      'Steam Vents // Steam Vents',
      'Steam Vents',
    ])
  })

  test('searching by a full double-sided name matches single-faced printings', () => {
    const groups = buildFindPrintingsGroups(allCards(), 'Steam Vents // Steam Vents')
    expect(countFindPrintingsCopies(groups)).toBe(4)
  })

  test('does not match different cards and keeps lists without copies out', () => {
    const groups = buildFindPrintingsGroups(allCards(), 'Lightning Bolt')
    expect(groups.map((g) => g.slug)).toEqual(['izzet', 'wants'])
    expect(countFindPrintingsCopies(groups)).toBe(2)
  })

  test('the current list sorts first and is flagged', () => {
    const groups = buildFindPrintingsGroups(allCards(), 'Steam Vents', {
      type: 'collection',
      slug: 'binder',
    })
    expect(groups.map((g) => g.slug)).toEqual(['binder', 'izzet'])
    expect(groups.map((g) => g.isCurrent)).toEqual([true, false])
  })

  test('returns nothing for a blank name', () => {
    expect(buildFindPrintingsGroups(allCards(), '   ')).toEqual([])
  })
})

describe('cardNavMatchesList', () => {
  const target = { type: 'deck' as const, slug: 'izzet', name: 'Steam Vents', cardId: 1 }

  test('matches only the target list', () => {
    expect(cardNavMatchesList(target, { type: 'deck', slug: 'izzet' })).toBe(true)
    expect(cardNavMatchesList(target, { type: 'deck', slug: 'other' })).toBe(false)
    expect(cardNavMatchesList(target, { type: 'collection', slug: 'izzet' })).toBe(false)
    expect(cardNavMatchesList(target, null)).toBe(false)
    expect(cardNavMatchesList(null, { type: 'deck', slug: 'izzet' })).toBe(false)
  })
})
