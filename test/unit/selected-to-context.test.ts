import { describe, expect, test } from 'bun:test'
import { contextInfoFromSelected } from '../../src/list-view/selected-to-context'
import type { SelectedCard } from '../../src/list-view/useCardSelection'
import { makeSelectedCard } from '../test-utils'

const selected = (over: Partial<SelectedCard> = {}): SelectedCard =>
  makeSelectedCard({
    name: 'Lightning Bolt',
    quantity: 2,
    groupSize: 4,
    maxQty: 4,
    cardIds: [11, 12],
    ...over,
  })

describe('contextInfoFromSelected', () => {
  test('maps identity, printing, and copy fields', () => {
    const info = contextInfoFromSelected(
      selected({ set: 'lea', collectorNumber: '161', finish: 'foil', condition: 'NM' }),
    )
    expect(info).toEqual({
      cardName: 'Lightning Bolt',
      card: null,
      cardIds: [11, 12],
      quantity: 2,
      set: 'lea',
      collectorNumber: '161',
      finish: 'foil',
      condition: 'NM',
    })
  })

  test('leaves printing fields undefined for a name-only selection', () => {
    const info = contextInfoFromSelected(selected({ set: undefined, collectorNumber: undefined }))
    expect(info.set).toBeUndefined()
    expect(info.collectorNumber).toBeUndefined()
  })
})
