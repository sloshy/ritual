import { describe, expect, test } from 'bun:test'
import { selectionToRemoveItems } from '../../../src/admin/site/remove-selected'
import { makeSelectedCard } from '../../test-utils'

describe('selectionToRemoveItems', () => {
  test('expands a multi-copy deck tile by copyIndex sharing one cardId', () => {
    const items = selectionToRemoveItems([
      makeSelectedCard({
        name: 'Sol Ring',
        sourceKind: 'deck',
        sourceSlug: 'my-deck',
        groupSize: 3,
        cardIds: [5],
      }),
    ])
    expect(items).toEqual([
      { listType: 'deck', listSlug: 'my-deck', name: 'Sol Ring', cardId: 5, copyIndex: 0 },
      { listType: 'deck', listSlug: 'my-deck', name: 'Sol Ring', cardId: 5, copyIndex: 1 },
      { listType: 'deck', listSlug: 'my-deck', name: 'Sol Ring', cardId: 5, copyIndex: 2 },
    ])
  })

  test('emits one item per cardId for flat lists at copyIndex 0', () => {
    const items = selectionToRemoveItems([
      makeSelectedCard({
        name: 'Island',
        sourceKind: 'collection',
        sourceSlug: 'my-cards',
        cardIds: [8, 9],
      }),
    ])
    expect(items).toEqual([
      { listType: 'collection', listSlug: 'my-cards', name: 'Island', cardId: 8, copyIndex: 0 },
      { listType: 'collection', listSlug: 'my-cards', name: 'Island', cardId: 9, copyIndex: 0 },
    ])
  })

  test('skips cards lacking a sourceSlug (cannot be targeted)', () => {
    const items = selectionToRemoveItems([
      makeSelectedCard({ name: 'Forest', sourceKind: 'wanted', cardIds: [3] }),
    ])
    expect(items).toEqual([])
  })
})
