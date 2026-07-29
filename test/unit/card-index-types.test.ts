import { describe, expect, test } from 'bun:test'
import {
  indexPhysicalCards,
  moveCardKey,
  type KeyablePhysicalCard,
} from '../../src/card-index-types'
import type { ListType } from '../../src/list-type'

/**
 * The physical-card key scheme, which the index route *produces* and the three
 * move/remove commit routes *consume*. They are separate call sites over the
 * same rule: a key built even slightly differently on the consuming side simply
 * fails to resolve, and the card is reported as skipped with nothing to explain
 * it. What matters is the round trip, so that is what is asserted here.
 */

function physical(
  type: ListType,
  filePath: string,
  overrides: Partial<KeyablePhysicalCard> = {},
): KeyablePhysicalCard {
  return {
    key: `${filePath}:internal`,
    name: 'Sol Ring',
    cardId: 1,
    listEntry: { filePath, ref: { type } },
    ...overrides,
  }
}

describe('indexPhysicalCards', () => {
  test('a key the producer issues resolves back to the internal key', () => {
    const card = physical('collection', '/lists/collections/binder.md')
    const slugByPath = new Map([['/lists/collections/binder.md', 'binder']])

    // Exactly what `loadCardIndex` puts on the wire as `MovePhysicalCard.key`.
    const issued = moveCardKey('collection', 'binder', card.cardId, card.name, card.copyIndex)

    expect(indexPhysicalCards([card], slugByPath).get(issued)).toBe(card.key)
  })

  test('deck copies of one line are distinguished by copyIndex', () => {
    const path = '/lists/decks/burn.md'
    const copies = [0, 1].map((copyIndex) =>
      physical('deck', path, { key: `${path}:bolt:${copyIndex}`, copyIndex }),
    )
    const index = indexPhysicalCards(copies, new Map([[path, 'burn']]))

    expect(index.size).toBe(2)
    expect(index.get(moveCardKey('deck', 'burn', 1, 'Sol Ring', 1))).toBe(`${path}:bolt:1`)
  })

  test('a card whose list has no slug is skipped rather than keyed as undefined', () => {
    const card = physical('wanted', '/lists/wanted/gone.md')
    expect(indexPhysicalCards([card], new Map()).size).toBe(0)
  })
})
