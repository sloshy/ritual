import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import {
  applyDeckChange,
  applyDeckFieldEdit,
  discardDeckSessionAdd,
  discardDeckSessionChange,
  editDeckCard,
  lastDeckEditLabel,
  listDeckEntries,
  listDeckSessionChanges,
  performDeckCopyRemoval,
  performDeckLineMove,
  performDeckLineRemoval,
  renderDeckCardLine,
  undoDeckEdit,
  type DeckSessionState,
} from '../../src/commands/session/deck-edit'
import type { MoveDestination } from '../../src/commands/session/edit-move'
import { findCardById } from '../../src/list/deck-io'
import type { CardSessionContext } from '../../src/commands/session/strategy'
import type { Card } from '../../src/card/card'
import type { DeckData } from '../../src/list/deck'
import {
  consolidateSetPrinting,
  createAddChange,
  createSetPrintingChange,
  type PrintingTuple,
} from '../../src/changes/change-event'
import { createSessionArtChanges, pendingSessionArt } from '../../src/commands/session/art'
import { scratchListPath, stubTty } from '../test-utils'

// The Set Custom Art prompts go through `ask`, which refuses to open without a
// terminal; these tests answer them with prompts.inject instead.
stubTty({ stdin: true })

function deckOf(cards: Card[]): DeckData {
  return { name: 'Test', sections: [{ name: 'Main', cards }] }
}

function stateOf(deck: DeckData): DeckSessionState {
  return {
    filePath: scratchListPath('deck-edit-test.md'),
    deck,
    sessionAdds: [],
    sessionLineIds: [],
    pendingMoveIds: [],
    editUndo: [],
    originals: new Map(),
    dirty: false,
    art: createSessionArtChanges(),
  }
}

function contextOf(): CardSessionContext {
  return {
    sessionChanges: [],
    lastChangeIndex: null,
    lastAdded: null,
    lastAddedCount: 0,
    hasSavedChangelog: false,
  }
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

describe('deck custom-art bookkeeping', () => {
  const dest: MoveDestination = {
    target: { type: 'collection', name: 'Binder', file: '/collections/binder.md' },
    printing: null,
  }

  // The sidecar is keyed by `&N` and the deck hands a freed id to the next line
  // it creates, so what the save re-files against is recorded as it happens.
  test('a full line removal records the freed id; undoing it under the same id takes it back', () => {
    const state = stateOf(deckOf([{ quantity: 2, name: 'Sol Ring', cardId: 1 }]))
    const ctx = contextOf()

    performDeckLineRemoval(state, ctx, 1)
    expect([...state.art.removed]).toEqual([1])

    undoDeckEdit(state, ctx)
    expect([...state.art.removed]).toEqual([])
  })

  test('a removal undone under a fresh id leaves the art dropped', () => {
    const state = stateOf(deckOf([{ quantity: 1, name: 'Sol Ring', cardId: 1 }]))
    const ctx = contextOf()

    performDeckLineRemoval(state, ctx, 1)
    applyDeckChange(state, createAddChange('Brainstorm', { section: 'Main' }))
    expect(findCardById(state.deck, 1)!.card.name).toBe('Brainstorm')

    undoDeckEdit(state, ctx)
    expect([...state.art.removed]).toEqual([1])
  })

  test('removing one copy of a multi-copy line records nothing: the line keeps its id', () => {
    const state = stateOf(deckOf([{ quantity: 2, name: 'Sol Ring', cardId: 1 }]))
    const ctx = contextOf()

    performDeckCopyRemoval(state, ctx, 1)
    expect(findCardById(state.deck, 1)!.card.quantity).toBe(1)
    expect([...state.art.removed]).toEqual([])
  })

  test('a move out records the freed id, and undoing the move takes it back', () => {
    const state = stateOf(deckOf([{ quantity: 2, name: 'Sol Ring', cardId: 1 }]))
    const ctx = contextOf()

    performDeckLineMove(state, ctx, 1, dest)
    expect([...state.art.removed]).toEqual([1])

    undoDeckEdit(state, ctx)
    expect([...state.art.removed]).toEqual([])
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

  test('lists copy adds and edits in order', () => {
    const { state, ctx } = withSessionAdd()
    printingEdit(state, ctx, 1, LTC)

    const items = listDeckSessionChanges(state)
    expect(items).toHaveLength(2)
    expect(items[0]!.label).toContain('Added Brainstorm → Main')
    expect(items[1]!.label).toContain('printing on Sol Ring')
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

describe('deck edit-mode — Change Language', () => {
  test('the edit menu applies a set-language change, undoable back to the original', async () => {
    const state = stateOf(
      deckOf([{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }]),
    )
    const ctx = contextOf()

    prompts.inject(['language', 'ja'])
    await editDeckCard(state, ctx, 1, { sessionConfig: {}, excludeDigitalOnly: true })

    const edited = findCardById(state.deck, 1)!.card
    expect(edited.language).toBe('ja')
    expect(ctx.sessionChanges).toHaveLength(1)
    expect(ctx.sessionChanges[0]).toMatchObject({
      action: 'set-language',
      language: 'ja',
      cardId: 1,
    })
    expect(lastDeckEditLabel(state)).toBe('language on Sol Ring')
    expect(renderDeckCardLine(edited, 'Main')).toBe('1 Sol Ring (C19:221) [ja] — Main &1')

    undoDeckEdit(state, ctx)
    // The deck engine clears an explicit en back off the card (written-value shape).
    expect(findCardById(state.deck, 1)!.card.language).toBeUndefined()
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(lastDeckEditLabel(state)).toBeNull()
  })

  test('re-picking the current language is a no-op', async () => {
    const state = stateOf(
      deckOf([
        {
          quantity: 1,
          name: 'Sol Ring',
          set: 'c19',
          collectorNumber: '221',
          language: 'ja',
          cardId: 1,
        },
      ]),
    )
    const ctx = contextOf()

    prompts.inject(['language', 'ja'])
    await editDeckCard(state, ctx, 1, { sessionConfig: {}, excludeDigitalOnly: true })

    expect(findCardById(state.deck, 1)!.card.language).toBe('ja')
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(lastDeckEditLabel(state)).toBeNull()
  })
})

describe('deck edit-mode — Change Label', () => {
  test('the edit menu applies a set-label change, undoable back to the original', async () => {
    const state = stateOf(
      deckOf([{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }]),
    )
    const ctx = contextOf()

    // The deck picker offers Proxy and "Use list default" only; picking Proxy
    // is the serialized `proxy` value.
    prompts.inject(['label', 'proxy'])
    await editDeckCard(state, ctx, 1, { sessionConfig: {}, excludeDigitalOnly: true })

    expect(findCardById(state.deck, 1)!.card.labels).toEqual(['proxy'])
    expect(ctx.sessionChanges).toHaveLength(1)
    expect(ctx.sessionChanges[0]).toMatchObject({
      action: 'set-label',
      labels: ['proxy'],
      cardId: 1,
    })
    expect(lastDeckEditLabel(state)).toBe('labels on Sol Ring')

    undoDeckEdit(state, ctx)
    expect(findCardById(state.deck, 1)!.card.labels).toBeUndefined()
    expect(ctx.sessionChanges).toHaveLength(0)
  })

  test('re-picking the current label is a no-op', async () => {
    const state = stateOf(
      deckOf([
        {
          quantity: 1,
          name: 'Sol Ring',
          set: 'c19',
          collectorNumber: '221',
          labels: ['proxy'],
          cardId: 1,
        },
      ]),
    )
    const ctx = contextOf()

    prompts.inject(['label', 'proxy'])
    await editDeckCard(state, ctx, 1, { sessionConfig: {}, excludeDigitalOnly: true })

    expect(findCardById(state.deck, 1)!.card.labels).toEqual(['proxy'])
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(lastDeckEditLabel(state)).toBeNull()
  })
})

describe('performDeckLineMove', () => {
  const dest: MoveDestination = {
    target: { type: 'collection', name: 'Binder', file: '/collections/binder.md' },
    printing: null,
  }

  test('removes the whole line and records one move-from per copy', () => {
    const state = stateOf(
      deckOf([
        { quantity: 3, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 },
        { quantity: 1, name: 'Mana Crypt', set: '2xm', collectorNumber: '270', cardId: 2 },
      ]),
    )
    const ctx = contextOf()
    performDeckLineMove(state, ctx, 1, dest)

    expect(findCardById(state.deck, 1)).toBeNull()
    // The sibling line is untouched.
    expect(findCardById(state.deck, 2)!.card).toMatchObject({ name: 'Mana Crypt', quantity: 1 })
    expect(ctx.sessionChanges).toMatchObject([
      { action: 'move-from', cardName: 'Sol Ring', to: { type: 'collection', name: 'Binder' } },
      { action: 'move-from', cardName: 'Sol Ring' },
      { action: 'move-from', cardName: 'Sol Ring' },
    ])
    expect(lastDeckEditLabel(state)).toBe('move of Sol Ring to 📦 Binder')
  })

  test('copies added this session keep their add events but leave the discard menus', () => {
    const state = stateOf(
      deckOf([
        { quantity: 2, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 },
        { quantity: 1, name: 'Brainstorm', set: 'ice', collectorNumber: '61', cardId: 2 },
      ]),
    )
    const ctx = contextOf()
    // One Sol Ring copy and the Brainstorm line were added this session.
    ctx.sessionChanges.push(createAddChange('Sol Ring', { set: 'c19', cardId: 1 }))
    state.sessionAdds.push({
      cardId: 1,
      name: 'Sol Ring',
      printing: { set: 'c19', collectorNumber: '221' },
      section: 'Main',
    })
    state.sessionAdds.push({
      cardId: 2,
      name: 'Brainstorm',
      printing: { set: 'ice', collectorNumber: '61' },
      section: 'Main',
    })
    state.sessionLineIds.push(1, 2)

    performDeckLineMove(state, ctx, 1, dest)
    expect(ctx.sessionChanges).toMatchObject([
      { action: 'add' },
      { action: 'move-from' },
      { action: 'move-from' },
    ])
    // Only the moved line's tracking leaves; the other session add survives.
    expect(state.sessionAdds.map((record) => record.cardId)).toEqual([2])
    expect(state.sessionLineIds).toEqual([2])
    // The moved line's id is reserved while the move is pending.
    expect(state.pendingMoveIds).toEqual([1])
  })

  test('a printing resolved for the destination rides the events of a name-only line', () => {
    const state = stateOf(deckOf([{ quantity: 1, name: 'Sol Ring', cardId: 1 }]))
    const ctx = contextOf()
    performDeckLineMove(state, ctx, 1, {
      ...dest,
      printing: { set: '2xm', collectorNumber: '270' },
    })

    expect(findCardById(state.deck, 1)).toBeNull()
    expect(ctx.sessionChanges).toMatchObject([
      { action: 'move-from', set: '2xm', collectorNumber: '270' },
    ])
  })

  test('undo restores the line with all copies and its note, into its own section', () => {
    const state = stateOf({
      name: 'Test',
      sections: [
        { name: 'Main', cards: [] },
        {
          name: 'Sideboard',
          cards: [
            {
              quantity: 2,
              name: 'Sol Ring',
              set: 'c19',
              collectorNumber: '221',
              note: 'borrowed',
              cardId: 1,
            },
          ],
        },
      ],
    })
    const ctx = contextOf()
    performDeckLineMove(state, ctx, 1, dest)
    expect(findCardById(state.deck, 1)).toBeNull()

    undoDeckEdit(state, ctx)
    const restored = findCardById(state.deck, 1)!
    expect(restored.card).toMatchObject({ quantity: 2, name: 'Sol Ring', note: 'borrowed' })
    expect(restored.section.name).toBe('Sideboard')
    expect(ctx.sessionChanges).toHaveLength(0)
    // Undoing the move lifts the id reservation.
    expect(state.pendingMoveIds).toEqual([])
  })

  test('a line added after a move cannot reuse the reserved id', () => {
    const state = stateOf(
      deckOf([{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }]),
    )
    const ctx = contextOf()
    performDeckLineMove(state, ctx, 1, dest)

    applyDeckChange(state, createAddChange('Brainstorm', { set: 'ice', section: 'Main' }))
    const added = state.deck.sections[0]!.cards.find((card) => card.name === 'Brainstorm')!
    expect(added.cardId).not.toBe(1)
  })
})

describe('deck edit-mode — Set Custom Art', () => {
  /** A one-line deck whose `.art.json` does not exist (so the sidecar reads empty). */
  function stateWithLine(): DeckSessionState {
    return stateOf(
      deckOf([{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }]),
    )
  }

  test('the edit menu stages art for the save and undoes to the previous reference', async () => {
    const state = stateWithLine()
    const ctx = contextOf()

    prompts.inject(['art', 'url', 'https://example.com/first.png'])
    await editDeckCard(state, ctx, 1, { sessionConfig: {}, excludeDigitalOnly: true })
    prompts.inject(['art', 'url', 'https://example.com/second.png'])
    await editDeckCard(state, ctx, 1, { sessionConfig: {}, excludeDigitalOnly: true })

    expect(state.art.edited.get(1)).toEqual({ url: 'https://example.com/second.png' })
    // The line itself never changes, so nothing joins the changelog.
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(state.dirty).toBeTrue()
    expect(lastDeckEditLabel(state)).toBe('custom art on Sol Ring')

    undoDeckEdit(state, ctx)
    expect(state.art.edited.get(1)).toEqual({ url: 'https://example.com/first.png' })
    undoDeckEdit(state, ctx)
    expect(state.art.edited.get(1)).toBeNull()
    expect(lastDeckEditLabel(state)).toBeNull()
  })

  test('removing the line afterwards drops the staged art with it', async () => {
    const state = stateWithLine()
    const ctx = contextOf()

    prompts.inject(['art', 'url', 'https://example.com/first.png'])
    await editDeckCard(state, ctx, 1, { sessionConfig: {}, excludeDigitalOnly: true })
    performDeckLineRemoval(state, ctx, 1)

    expect(pendingSessionArt(state.art)).toEqual({ removed: new Set([1]), added: new Map() })
  })
})
