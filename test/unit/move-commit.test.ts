import { describe, test, expect } from 'bun:test'
import {
  applyVirtualMove,
  buildVirtualState,
  loadPhysicalCards,
  getPendingMoves,
  type VirtualCard,
} from '../../src/list/move-commit'
import { makeListEntry, makePhysicalCard } from './move-fixtures'

// ── loadPhysicalCards ─────────────────────────────────────────────────────────

describe('loadPhysicalCards', () => {
  // Every list type takes a different read path, and each one used to swallow a
  // failure into "this list is empty" — which reads to a caller as "that card is
  // not in any list", the exact confusion `warnings` exists to prevent.
  test.each([
    ['deck', 'decks'],
    ['collection', 'collections'],
    ['wanted', 'wanted'],
  ] as const)(
    'an unreadable %s file is named in warnings, not silently empty',
    async (type, dir) => {
      const missing = makeListEntry(type, 'Gone', `/nonexistent-${dir}/${dir}/gone.md`)

      const { cards, warnings } = await loadPhysicalCards([missing])

      expect(cards).toEqual([])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(`${dir}/gone.md`)
      expect(warnings[0]).toContain('could not be read')
    },
  )
})

// ── applyVirtualMove ──────────────────────────────────────────────────────────

describe('applyVirtualMove', () => {
  test('sets pendingMove and updates currentList on first move', () => {
    const srcList = makeListEntry('deck', 'My Deck')
    const dstList = makeListEntry('collection', 'Red Binder')
    const card = makePhysicalCard('Lightning Bolt', srcList)
    const state = buildVirtualState([card])

    const result = applyVirtualMove(state, card.key, dstList)

    expect(result).toBe(true)
    const vc = state.get(card.key)!
    expect(vc.pendingMove).not.toBeNull()
    expect(vc.pendingMove!.originalList.filePath).toBe(srcList.filePath)
    expect(vc.currentList.filePath).toBe(dstList.filePath)
  })

  test('chained move keeps originalList and updates currentList', () => {
    const listA = makeListEntry('deck', 'Deck A')
    const listB = makeListEntry('collection', 'Binder B')
    const listC = makeListEntry('wanted', 'Wanted C')
    const card = makePhysicalCard('Sol Ring', listA)
    const state = buildVirtualState([card])

    applyVirtualMove(state, card.key, listB)
    applyVirtualMove(state, card.key, listC)

    const vc = state.get(card.key)!
    // originalList should still be A (not B)
    expect(vc.pendingMove!.originalList.filePath).toBe(listA.filePath)
    // currentList should be C
    expect(vc.currentList.filePath).toBe(listC.filePath)
  })

  test('returns false for unknown key', () => {
    const state = new Map<string, VirtualCard>()
    const dstList = makeListEntry('collection', 'Binder')
    expect(applyVirtualMove(state, 'nonexistent', dstList)).toBe(false)
  })

  test('records the destination section without touching card identity', () => {
    const srcList = makeListEntry('deck', 'Source')
    const dstList = makeListEntry('deck', 'Target')
    const card = makePhysicalCard('Lightning Bolt', srcList)
    const state = buildVirtualState([card])

    applyVirtualMove(state, card.key, dstList, { section: 'Sideboard' })

    const vc = state.get(card.key)!
    expect(vc.destSection).toBe('Sideboard')
    // The section is destination routing, not card identity.
    expect('destSection' in vc.card).toBe(false)
  })

  test('a chained retarget overwrites the destination section', () => {
    const srcList = makeListEntry('deck', 'Source')
    const deckB = makeListEntry('deck', 'B')
    const deckC = makeListEntry('deck', 'C')
    const card = makePhysicalCard('Sol Ring', srcList)
    const state = buildVirtualState([card])

    applyVirtualMove(state, card.key, deckB, { section: 'Sideboard' })
    applyVirtualMove(state, card.key, deckC, { section: 'Maybeboard' })
    expect(state.get(card.key)!.destSection).toBe('Maybeboard')

    // A retarget without a section clears the stale one.
    applyVirtualMove(state, card.key, deckB)
    expect(state.get(card.key)!.destSection).toBeUndefined()
  })
})

// ── getPendingMoves ───────────────────────────────────────────────────────────

describe('getPendingMoves', () => {
  test('returns only cards with a pending move', () => {
    const listA = makeListEntry('deck', 'A')
    const listB = makeListEntry('collection', 'B')
    const card1 = makePhysicalCard('Card1', listA)
    const card2 = makePhysicalCard('Card2', listA, { key: `${listA.filePath}:Card2:0` })
    const state = buildVirtualState([card1, card2])

    applyVirtualMove(state, card1.key, listB)

    const pending = getPendingMoves(state)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.card.name).toBe('Card1')
  })

  test('returns empty when no moves pending', () => {
    const listEntry = makeListEntry('deck', 'A')
    const card = makePhysicalCard('Card', listEntry)
    const state = buildVirtualState([card])

    expect(getPendingMoves(state)).toHaveLength(0)
  })
})
