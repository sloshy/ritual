import { describe, expect, test } from 'bun:test'
import {
  applyDeckChange,
  applyDeckFieldEdit,
  discardDeckSessionAdd,
  discardDeckSessionChange,
  lastDeckEditLabel,
  listDeckEntries,
  listDeckSessionChanges,
  performDeckCopyRemoval,
  performDeckLineRemoval,
  renderDeckCardLine,
  undoDeckEdit,
  type DeckSessionState,
} from '../../src/commands/deck-edit'
import { findCardById } from '../../src/commands/deck-helpers'
import type { CardSessionContext } from '../../src/commands/card-session'
import type { Card, DeckData } from '../../src/types'
import {
  consolidateSetPrinting,
  createAddChange,
  createSetPrintingChange,
  type PrintingTuple,
} from '../../src/change-event'

function deckOf(cards: Card[]): DeckData {
  return { name: 'Test', sections: [{ name: 'Main', cards }] }
}

function stateOf(deck: DeckData): DeckSessionState {
  return {
    deck,
    sessionAdds: [],
    sessionLineIds: [],
    editUndo: [],
    originals: new Map(),
    dirty: false,
  }
}

function contextOf(): CardSessionContext {
  return { sessionChanges: [], lastChangeIndex: null, lastAdded: null, lastAddedCount: 0 }
}

const LTC: PrintingTuple = { set: 'ltc', collectorNumber: '284', finish: 'foil' }

/** A set-printing field edit built the same way the deck edit flow builds it. */
function printingEdit(
  state: DeckSessionState,
  ctx: CardSessionContext,
  cardId: number,
  to: PrintingTuple,
): void {
  const located = findCardById(state.deck, cardId)!
  const { card } = located
  const before: PrintingTuple = {
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
  }
  applyDeckFieldEdit(state, ctx, card, located.section.name, cardId, {
    label: `printing on ${card.name}`,
    change: createSetPrintingChange(card.name, { ...to, cardId }),
    inverse: createSetPrintingChange(card.name, { ...before, cardId }),
    consolidate: (changes, original) =>
      consolidateSetPrinting(changes, card.name, to, original.printing, cardId),
  })
}

describe('deck edit-mode field edits', () => {
  test('set-printing applies, consolidates, and undoes', () => {
    const state = stateOf(
      deckOf([{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }]),
    )
    const ctx = contextOf()

    printingEdit(state, ctx, 1, LTC)
    expect(findCardById(state.deck, 1)!.card.set).toBe('ltc')
    expect(ctx.sessionChanges).toMatchObject([{ action: 'set-printing', set: 'ltc' }])
    expect(state.dirty).toBe(true)
    expect(lastDeckEditLabel(state)).toBe('printing on Sol Ring')

    // Editing back to the session-start printing empties the changelog.
    printingEdit(state, ctx, 1, { set: 'c19', collectorNumber: '221' })
    expect(ctx.sessionChanges).toHaveLength(0)

    // Undo unwinds in order: back to LTC, then back to the original.
    undoDeckEdit(state, ctx)
    expect(findCardById(state.deck, 1)!.card.set).toBe('ltc')
    expect(ctx.sessionChanges).toMatchObject([{ action: 'set-printing', set: 'ltc' }])
    undoDeckEdit(state, ctx)
    expect(findCardById(state.deck, 1)!.card.set).toBe('c19')
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(lastDeckEditLabel(state)).toBeNull()
  })
})

describe('performDeckLineRemoval', () => {
  test('removes every pre-existing copy and restores them (with the note) on undo', () => {
    const state = stateOf(
      deckOf([
        {
          quantity: 3,
          name: 'Sol Ring',
          set: 'c19',
          collectorNumber: '221',
          note: 'alt art',
          cardId: 5,
        },
      ]),
    )
    const ctx = contextOf()

    performDeckLineRemoval(state, ctx, 5)
    expect(findCardById(state.deck, 5)).toBeNull()
    // One remove event per copy, mirroring the admin editor's records.
    expect(ctx.sessionChanges).toHaveLength(3)
    expect(ctx.sessionChanges.every((c) => c.action === 'remove')).toBe(true)

    undoDeckEdit(state, ctx)
    const restored = findCardById(state.deck, 5)!.card
    expect(restored.quantity).toBe(3)
    expect(restored.note).toBe('alt art')
    expect(ctx.sessionChanges).toHaveLength(0)
  })

  test('cancels session-added copies first, recording removes only for pre-existing ones', () => {
    const state = stateOf(deckOf([{ quantity: 2, name: 'Sol Ring', cardId: 1 }]))
    const ctx = contextOf()
    // One of the two copies was added this session (the line pre-existed).
    const addEvent = createAddChange('Sol Ring', { section: 'Main', cardId: 1 })
    ctx.sessionChanges.push(addEvent)
    state.sessionAdds.push({ cardId: 1, name: 'Sol Ring', printing: {}, section: 'Main' })

    performDeckLineRemoval(state, ctx, 1)
    expect(findCardById(state.deck, 1)).toBeNull()
    // The session copy's add event cancelled out; only the pre-existing copy records a remove.
    expect(ctx.sessionChanges).toMatchObject([{ action: 'remove', cardName: 'Sol Ring' }])
  })

  test('a removal undone after its id was reused restores the line under a fresh id', () => {
    const state = stateOf(deckOf([{ quantity: 1, name: 'Sol Ring', cardId: 1 }]))
    const ctx = contextOf()

    performDeckLineRemoval(state, ctx, 1)
    // A later add takes the freed id 1.
    applyDeckChange(state, createAddChange('Brainstorm', { section: 'Main' }))
    expect(findCardById(state.deck, 1)!.card.name).toBe('Brainstorm')

    undoDeckEdit(state, ctx)
    const cards = state.deck.sections[0]!.cards
    expect(cards.map((c) => c.name).sort()).toEqual(['Brainstorm', 'Sol Ring'])
    // Brainstorm keeps the reused id 1; the restored line takes a fresh one.
    expect(cards.find((c) => c.name === 'Brainstorm')!.cardId).toBe(1)
    expect(cards.find((c) => c.name === 'Sol Ring')!.cardId).toBe(2)
  })
})

describe('performDeckCopyRemoval', () => {
  test('decrements a pre-existing line, keeps its id, and restores the copy on undo', () => {
    const state = stateOf(
      deckOf([{ quantity: 3, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 4 }]),
    )
    const ctx = contextOf()

    performDeckCopyRemoval(state, ctx, 4)
    const card = findCardById(state.deck, 4)!.card
    expect(card.quantity).toBe(2)
    expect(card.cardId).toBe(4)
    expect(ctx.sessionChanges).toMatchObject([{ action: 'remove', cardName: 'Sol Ring' }])
    expect(lastDeckEditLabel(state)).toBe('removing a copy of Sol Ring')

    undoDeckEdit(state, ctx)
    expect(findCardById(state.deck, 4)!.card.quantity).toBe(3)
    expect(ctx.sessionChanges).toHaveLength(0)
  })

  test('cancels a session-added copy instead of recording a remove', () => {
    const state = stateOf(deckOf([{ quantity: 2, name: 'Sol Ring', cardId: 1 }]))
    const ctx = contextOf()
    // The second copy was added this session onto a pre-existing line.
    ctx.sessionChanges.push(createAddChange('Sol Ring', { section: 'Main', cardId: 1 }))
    state.sessionAdds.push({ cardId: 1, name: 'Sol Ring', printing: {}, section: 'Main' })

    performDeckCopyRemoval(state, ctx, 1)
    expect(findCardById(state.deck, 1)!.card.quantity).toBe(1)
    // The add event vanished and no remove was recorded.
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(state.sessionAdds).toHaveLength(0)
  })
})

describe('discardDeckSessionAdd', () => {
  test('drops the edit-undo history alongside the discarded copy', () => {
    const state = stateOf(
      deckOf([{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }]),
    )
    const ctx = contextOf()
    // A session add of a second card, then an edit of the first.
    applyDeckChange(state, createAddChange('Brainstorm', { section: 'Main', cardId: 2 }))
    ctx.sessionChanges.push(createAddChange('Brainstorm', { section: 'Main', cardId: 2 }))
    state.sessionAdds.push({ cardId: 2, name: 'Brainstorm', printing: {}, section: 'Main' })
    state.sessionLineIds.push(2)
    printingEdit(state, ctx, 1, LTC)
    expect(state.editUndo).toHaveLength(1)

    expect(discardDeckSessionAdd(state, ctx, 0)).toBe(true)
    expect(findCardById(state.deck, 2)).toBeNull()
    expect(state.editUndo).toHaveLength(0)
    // The edit's changelog event survives the discard — only its undo entry is dropped.
    expect(ctx.sessionChanges).toMatchObject([{ action: 'set-printing', set: 'ltc' }])
  })
})

describe('listDeckSessionChanges', () => {
  /** A state with a pre-existing Sol Ring line and a session-added Brainstorm copy. */
  function withSessionAdd(): { state: DeckSessionState; ctx: CardSessionContext } {
    const state = stateOf(
      deckOf([{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }]),
    )
    const ctx = contextOf()
    applyDeckChange(state, createAddChange('Brainstorm', { section: 'Main', cardId: 2 }))
    ctx.sessionChanges.push(createAddChange('Brainstorm', { section: 'Main', cardId: 2 }))
    state.sessionAdds.push({ cardId: 2, name: 'Brainstorm', printing: {}, section: 'Main' })
    state.sessionLineIds.push(2)
    return { state, ctx }
  }

  test('lists copy adds, edits, and removals with their icons', () => {
    const { state, ctx } = withSessionAdd()
    printingEdit(state, ctx, 1, LTC)

    const items = listDeckSessionChanges(state)
    expect(items.map((i) => i.label)).toEqual([
      '➕ Added Brainstorm → Main',
      '✏️  printing on Sol Ring',
    ])
    expect(items.every((i) => i.blocked === undefined)).toBe(true)
  })

  test('an edit shadowed by a newer same-card removal is blocked until the removal goes', () => {
    const { state, ctx } = withSessionAdd()
    printingEdit(state, ctx, 1, LTC)
    performDeckLineRemoval(state, ctx, 1)

    let items = listDeckSessionChanges(state)
    expect(items[1]!.blocked).toBe('discard the newer "removal of Sol Ring" first')
    expect(items[2]!.blocked).toBeUndefined()

    // A blocked discard is refused outright.
    expect(discardDeckSessionChange(state, ctx, 1)).toBe(false)
    expect(state.editUndo).toHaveLength(2)

    // Discarding the removal unblocks the edit; discarding that too restores the card.
    discardDeckSessionChange(state, ctx, 2)
    items = listDeckSessionChanges(state)
    expect(items[1]!.blocked).toBeUndefined()
    discardDeckSessionChange(state, ctx, 1)
    expect(findCardById(state.deck, 1)!.card.set).toBe('c19')
    // Only the session add's event remains in the changelog.
    expect(ctx.sessionChanges).toMatchObject([{ action: 'add', cardName: 'Brainstorm' }])
  })

  test('discarding an add routes through the session-add machinery and reports it', () => {
    const { state, ctx } = withSessionAdd()
    printingEdit(state, ctx, 1, LTC)

    expect(discardDeckSessionChange(state, ctx, 0)).toBe(true)
    expect(findCardById(state.deck, 2)).toBeNull()
    expect(state.sessionAdds).toHaveLength(0)
    // The add discard conservatively drops the edit-undo history.
    expect(listDeckSessionChanges(state)).toHaveLength(0)
  })
})

describe('listDeckEntries', () => {
  test('renders quantity, printing, section, and id', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        {
          name: 'Commander',
          cards: [{ quantity: 1, name: 'Atraxa', set: 'c16', collectorNumber: '28', cardId: 1 }],
        },
        { name: 'Main', cards: [{ quantity: 2, name: 'Sol Ring', finish: 'foil', cardId: 2 }] },
      ],
    }
    const items = listDeckEntries(deck)
    expect(items.map((i) => i.cardId)).toEqual([1, 2])
    expect(items[0]!.label).toBe('1 Atraxa (C16:28) — Commander &1')
    expect(items[1]!.label).toBe('2 Sol Ring [foil] — Main &2')
    expect(renderDeckCardLine(deck.sections[1]!.cards[0]!, 'Main')).toBe(
      '2 Sol Ring [foil] — Main &2',
    )
  })
})
