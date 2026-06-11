import { describe, expect, test } from 'bun:test'
import { discardDeckCopy, type DeckDiscardState } from '../../src/commands/deck-helpers'
import { createAddChange, type ChangeEvent } from '../../src/change-event'
import type { Card, DeckData } from '../../src/types'

/** A Main-section deck built from the given cards. */
function deckOf(cards: Card[]): DeckData {
  return { name: 'Test', sections: [{ name: 'Main', cards }] }
}

function addEvent(name: string, cardId: number): ChangeEvent {
  return createAddChange(name, { section: 'Main', cardId })
}

/** All card ids present in the deck, across sections. */
function deckCardIds(deck: DeckData): number[] {
  return deck.sections.flatMap((s) => s.cards.map((c) => c.cardId!)).sort((a, b) => a - b)
}

describe('discardDeckCopy', () => {
  test('fully removing a session-created line re-packs survivors and frees the top id', () => {
    const state: DeckDiscardState = {
      deck: deckOf([
        { quantity: 1, name: 'Sol Ring', cardId: 1 },
        { quantity: 1, name: 'Lightning Bolt', cardId: 2 },
        { quantity: 1, name: 'Brainstorm', cardId: 3 },
      ]),
      sessionChanges: [
        addEvent('Sol Ring', 1),
        addEvent('Lightning Bolt', 2),
        addEvent('Brainstorm', 3),
      ],
      sessionAdds: [
        { cardId: 1, name: 'Sol Ring', printing: {}, section: 'Main' },
        { cardId: 2, name: 'Lightning Bolt', printing: {}, section: 'Main' },
        { cardId: 3, name: 'Brainstorm', printing: {}, section: 'Main' },
      ],
      sessionLineIds: [1, 2, 3],
    }

    const outcome = discardDeckCopy(state, 1)!
    expect(outcome.discarded.name).toBe('Lightning Bolt')

    // The Bolt line is gone; Brainstorm (was &3) slides down to &2, freeing 3.
    const cards = outcome.deck.sections[0]!.cards
    expect(cards.map((c) => c.name)).toEqual(['Sol Ring', 'Brainstorm'])
    expect(deckCardIds(outcome.deck)).toEqual([1, 2])
    expect(cards.find((c) => c.name === 'Brainstorm')!.cardId).toBe(2)

    // Changelog and per-copy records follow the same remap; the discarded event is gone.
    expect(outcome.sessionChanges.map((c) => ('cardId' in c ? c.cardId : undefined))).toEqual([
      1, 2,
    ])
    expect(outcome.sessionChanges.map((c) => ('cardName' in c ? c.cardName : undefined))).toEqual([
      'Sol Ring',
      'Brainstorm',
    ])
    expect(outcome.sessionAdds.map((r) => r.cardId)).toEqual([1, 2])
    expect(outcome.sessionLineIds).toEqual([1, 2])
  })

  test('re-pack on full removal never renumbers a pre-existing (non-session) card', () => {
    const state: DeckDiscardState = {
      // &10 pre-existed; the session then added &11/&12/&13.
      deck: deckOf([
        { quantity: 1, name: 'Ancient Tomb', cardId: 10 },
        { quantity: 1, name: 'Sol Ring', cardId: 11 },
        { quantity: 1, name: 'Lightning Bolt', cardId: 12 },
        { quantity: 1, name: 'Brainstorm', cardId: 13 },
      ]),
      sessionChanges: [
        addEvent('Sol Ring', 11),
        addEvent('Lightning Bolt', 12),
        addEvent('Brainstorm', 13),
      ],
      sessionAdds: [
        { cardId: 11, name: 'Sol Ring', printing: {}, section: 'Main' },
        { cardId: 12, name: 'Lightning Bolt', printing: {}, section: 'Main' },
        { cardId: 13, name: 'Brainstorm', printing: {}, section: 'Main' },
      ],
      sessionLineIds: [11, 12, 13],
    }

    const outcome = discardDeckCopy(state, 1)! // discard Lightning Bolt (&12)
    const byName = (n: string) => outcome.deck.sections[0]!.cards.find((c) => c.name === n)!
    // The pre-existing card keeps &10; only the session ids re-pack (13 → 12, freeing 13).
    expect(byName('Ancient Tomb').cardId).toBe(10)
    expect(byName('Sol Ring').cardId).toBe(11)
    expect(byName('Brainstorm').cardId).toBe(12)
    expect(deckCardIds(outcome.deck)).toEqual([10, 11, 12])
    expect(outcome.sessionLineIds).toEqual([11, 12])
  })

  test('decrementing a multi-copy line keeps its id and drops a single add event', () => {
    const state: DeckDiscardState = {
      deck: deckOf([{ quantity: 2, name: 'Sol Ring', cardId: 5 }]),
      sessionChanges: [addEvent('Sol Ring', 5), addEvent('Sol Ring', 5)],
      sessionAdds: [
        { cardId: 5, name: 'Sol Ring', printing: {}, section: 'Main' },
        { cardId: 5, name: 'Sol Ring', printing: {}, section: 'Main' },
      ],
      sessionLineIds: [5],
    }

    const outcome = discardDeckCopy(state, 0)!
    const card = outcome.deck.sections[0]!.cards[0]!
    expect(card.quantity).toBe(1)
    expect(card.cardId).toBe(5)
    // One of the two add events is dropped; the line and its id are untouched.
    expect(outcome.sessionChanges).toHaveLength(1)
    expect(outcome.sessionAdds.map((r) => r.cardId)).toEqual([5])
    expect(outcome.sessionLineIds).toEqual([5])
  })

  test('discarding a copy that merged into a pre-existing line never frees an id', () => {
    const state: DeckDiscardState = {
      // The &10 line pre-existed (qty 1); a session copy bumped it to 2 without
      // creating a new line, so it is absent from sessionLineIds.
      deck: deckOf([{ quantity: 2, name: 'Counterspell', cardId: 10 }]),
      sessionChanges: [addEvent('Counterspell', 10)],
      sessionAdds: [{ cardId: 10, name: 'Counterspell', printing: {}, section: 'Main' }],
      sessionLineIds: [],
    }

    const outcome = discardDeckCopy(state, 0)!
    expect(outcome.deck.sections[0]!.cards[0]!.quantity).toBe(1)
    expect(outcome.deck.sections[0]!.cards[0]!.cardId).toBe(10)
    expect(outcome.sessionChanges).toHaveLength(0)
    expect(outcome.sessionAdds).toHaveLength(0)
  })

  test('an empty session has nothing to discard', () => {
    const state: DeckDiscardState = {
      deck: deckOf([{ quantity: 1, name: 'Sol Ring', cardId: 1 }]),
      sessionChanges: [],
      sessionAdds: [],
      sessionLineIds: [1],
    }
    expect(discardDeckCopy(state, 0)).toBeNull()
  })

  test('an index past the end of a non-empty session is a no-op', () => {
    const state: DeckDiscardState = {
      deck: deckOf([{ quantity: 1, name: 'Sol Ring', cardId: 1 }]),
      sessionChanges: [addEvent('Sol Ring', 1)],
      sessionAdds: [{ cardId: 1, name: 'Sol Ring', printing: {}, section: 'Main' }],
      sessionLineIds: [1],
    }
    expect(discardDeckCopy(state, 1)).toBeNull()
  })
})
