import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import {
  createAllListsSession,
  createAllListsState,
  type AllListsSession,
} from '../../src/commands/all-lists-strategy'
import {
  createCardSessionContext,
  saveCardSession,
  type CardChoiceInput,
  type CardSessionContext,
  type CardSessionStrategy,
  type EditableEntryItem,
  type SessionAddItem,
  type SessionChangeItem,
  type SessionConfig,
} from '../../src/commands/card-session'
import type { OpenList, UnifiedListRef } from '../../src/commands/edit-lists'
import { createAddChange, type ChangeEvent } from '../../src/change-event'

const sessionConfig: SessionConfig = {
  entryMode: 'name',
  collectorSets: [],
  activeSetIndex: 0,
  setCardMaps: new Map(),
}

/** Everything a fake list's strategy recorded, so tests can assert on the routing. */
type Calls = {
  edited: number[]
  undone: number
  discardedChanges: number[]
  discardedAdds: number[]
  applied: ChangeEvent[]
  copies: number
  handled: CardChoiceInput[]
  notes: string[]
  saved: number
}

type FakeList = { open: OpenList; calls: Calls; setDirty: (dirty: boolean) => void }

const addInput = (cardName: string, isEditing = false): CardChoiceInput => ({
  cardName,
  preselected: null,
  forcePrompts: false,
  isEditing,
})

/**
 * A stand-in list whose strategy records which context it was handed. All Lists
 * must always pass a list its *own* context, never the engine's.
 */
function fakeList(ref: UnifiedListRef, entries: EditableEntryItem[], changes: string[]): FakeList {
  const ctx = createCardSessionContext()
  let dirty = false
  const calls: Calls = {
    edited: [],
    undone: 0,
    discardedChanges: [],
    discardedAdds: [],
    applied: [],
    copies: 0,
    handled: [],
    notes: [],
    saved: 0,
  }
  const assertOwnCtx = (given: CardSessionContext): void => {
    expect(given).toBe(ctx)
  }
  const strategy: CardSessionStrategy = {
    managerLabel: `${ref.type} manager`,
    saveTarget: { filePath: ref.file, listName: ref.name },
    sessionConfig,
    updateConfig: async () => [],
    applyChange: (change) => calls.applied.push(change),
    persist: async () => {},
    hasUnsavedChanges: () => dirty,
    sessionSaved: () => {
      calls.saved++
    },
    noteAdded: (note) => calls.notes.push(note),
    handleCard: async (given, input) => {
      assertOwnCtx(given)
      calls.handled.push(input)
    },
    addAnotherCopy: async (given) => {
      assertOwnCtx(given)
      calls.copies++
    },
    listSessionAdds: (): SessionAddItem[] => changes.map((name) => ({ label: name, name })),
    discardSessionAdd: async (given, index) => {
      assertOwnCtx(given)
      calls.discardedAdds.push(index)
    },
    listSessionChanges: (): SessionChangeItem[] => changes.map((label) => ({ label })),
    discardSessionChange: async (given, index) => {
      assertOwnCtx(given)
      calls.discardedChanges.push(index)
    },
    listEntries: () => entries,
    editEntry: async (given, cardId) => {
      assertOwnCtx(given)
      calls.edited.push(cardId)
    },
    lastEditUndoLabel: () => (changes.length > 0 ? `undo ${changes[0]}` : null),
    undoLastEdit: async (given) => {
      assertOwnCtx(given)
      calls.undone++
    },
  }
  return {
    open: { ref, strategy, ctx },
    calls,
    setDirty: (next) => {
      dirty = next
    },
  }
}

const deckRef: UnifiedListRef = { type: 'deck', name: 'Winota', file: '/decks/winota.md' }
const binderRef: UnifiedListRef = { type: 'collection', name: 'Binder', file: '/collections/b.md' }

type Fixture = { session: AllListsSession; deck: FakeList; binder: FakeList }

function fixture(): Fixture {
  // Both lists use card id 1, so only the synthetic keys can tell them apart.
  const deck = fakeList(deckRef, [{ label: '1 Sol Ring &1', cardId: 1 }], ['added Sol Ring'])
  const binder = fakeList(binderRef, [{ label: '- Mox Ruby &1', cardId: 1 }], [])
  const session = createAllListsSession({
    lists: [deck.open, binder.open],
    sessionConfig,
    saveAll: async () => {},
    state: createAllListsState(),
  })
  return { session, deck, binder }
}

describe('All Lists edit mode', () => {
  test('entries from every list are labelled with their list and routed by synthetic key', async () => {
    const { session, deck, binder } = fixture()
    const entries = session.strategy.listEntries()
    expect(entries.map((e) => e.label)).toEqual([
      '🎴 Winota: 1 Sol Ring &1',
      '📦 Binder: - Mox Ruby &1',
    ])
    // Same underlying card id in both lists — distinct keys in the picker.
    expect(entries[0]!.cardId).not.toBe(entries[1]!.cardId)

    await session.strategy.editEntry(createCardSessionContext(), entries[1]!.cardId)
    expect(binder.calls.edited).toEqual([1])
    expect(deck.calls.edited).toEqual([])
  })

  test('keys from a stale render never resolve to a card', async () => {
    const { session, deck, binder } = fixture()
    const stale = session.strategy.listEntries()[0]!.cardId
    session.strategy.listEntries()

    await session.strategy.editEntry(createCardSessionContext(), stale)
    expect(deck.calls.edited).toEqual([])
    expect(binder.calls.edited).toEqual([])
  })

  test('undo last edit targets the list the last edit ran against', async () => {
    const { session, deck, binder } = fixture()
    expect(session.strategy.lastEditUndoLabel()).toBeNull()

    const entries = session.strategy.listEntries()
    await session.strategy.editEntry(createCardSessionContext(), entries[0]!.cardId)
    expect(session.strategy.lastEditUndoLabel()).toBe('🎴 Winota: undo added Sol Ring')

    await session.strategy.undoLastEdit(createCardSessionContext())
    expect(deck.calls.undone).toBe(1)
    expect(binder.calls.undone).toBe(0)
  })

  test('a list with nothing to undo reports no undo label', async () => {
    const { session, binder } = fixture()
    const entries = session.strategy.listEntries()
    await session.strategy.editEntry(createCardSessionContext(), entries[1]!.cardId)
    expect(binder.calls.edited).toEqual([1])
    expect(session.strategy.lastEditUndoLabel()).toBeNull()
  })
})

describe('All Lists session changes', () => {
  test('changes are pooled across lists and discarded against their owner', async () => {
    const deck = fakeList(deckRef, [], ['added Sol Ring', 'removed Mox Ruby'])
    const binder = fakeList(binderRef, [], ['added Black Lotus'])
    const session = createAllListsSession({
      lists: [deck.open, binder.open],
      sessionConfig,
      saveAll: async () => {},
      state: createAllListsState(),
    })

    expect(session.strategy.listSessionChanges().map((c) => c.label)).toEqual([
      '🎴 Winota: added Sol Ring',
      '🎴 Winota: removed Mox Ruby',
      '📦 Binder: added Black Lotus',
    ])

    // Index 2 is the binder's first change, not the deck's third.
    await session.strategy.discardSessionChange(createCardSessionContext(), 2)
    expect(binder.calls.discardedChanges).toEqual([0])
    expect(deck.calls.discardedChanges).toEqual([])
  })
})

describe('All Lists add mode', () => {
  test('before the first add there is no active list to act on', async () => {
    const { session, deck, binder } = fixture()
    expect(session.ctx().lastAdded).toBeNull()
    expect(session.strategy.listSessionAdds?.()).toEqual([])

    // The last-added shortcuts are no-ops rather than misrouted adds.
    await session.strategy.addAnotherCopy(createCardSessionContext())
    session.strategy.applyChange(createAddChange('Sol Ring', {}))
    expect(deck.calls.copies + binder.calls.copies).toBe(0)
    expect([...deck.calls.applied, ...binder.calls.applied]).toEqual([])
  })

  test('adding a card asks for a list, then runs that list’s own add flow', async () => {
    const { session, deck, binder } = fixture()
    prompts.inject([binder.open])

    const input = addInput('Sol Ring')
    await session.strategy.handleCard(createCardSessionContext(), input)

    // The picked list gets the untouched input, so its own per-type prompts run.
    expect(binder.calls.handled).toEqual([input])
    expect(deck.calls.handled).toEqual([])
    // ...and becomes the list the engine's last-added shortcuts now act on.
    expect(session.ctx()).toBe(binder.open.ctx)
  })

  test('cancelling the list prompt skips the card and leaves the active list alone', async () => {
    const { session, deck, binder } = fixture()
    prompts.inject([deck.open])
    await session.strategy.handleCard(createCardSessionContext(), addInput('Sol Ring'))

    prompts.inject([new Error('cancelled')])
    await session.strategy.handleCard(createCardSessionContext(), addInput('Mox Ruby'))

    expect(deck.calls.handled.map((i) => i.cardName)).toEqual(['Sol Ring'])
    expect(binder.calls.handled).toEqual([])
    expect(session.ctx()).toBe(deck.open.ctx)
  })

  test('editing the previous card stays on its list without re-prompting', async () => {
    const { session, deck, binder } = fixture()
    prompts.inject([deck.open])
    await session.strategy.handleCard(createCardSessionContext(), addInput('Sol Ring'))

    // No injected answer: a prompt here would throw rather than pick a list.
    const edit = addInput('Sol Ring', true)
    await session.strategy.handleCard(createCardSessionContext(), edit)

    expect(deck.calls.handled).toEqual([addInput('Sol Ring'), edit])
    expect(binder.calls.handled).toEqual([])
  })

  test('the active list owns the engine context, the copy shortcut, and applied changes', async () => {
    const { session, deck, binder } = fixture()
    expect(session.ctx()).not.toBe(binder.open.ctx)

    prompts.inject([binder.open])
    await session.strategy.handleCard(createCardSessionContext(), addInput('Mox Ruby'))

    // The engine reads `lastAdded` and the change count off this context, so it
    // must be the binder's own — that is where its note and copies will land.
    expect(session.ctx()).toBe(binder.open.ctx)

    await session.strategy.addAnotherCopy(createCardSessionContext())
    expect(binder.calls.copies).toBe(1)
    expect(deck.calls.copies).toBe(0)

    // The engine applies the note itself, then tells the strategy about it.
    const note = createAddChange('Mox Ruby', {})
    session.strategy.applyChange(note)
    session.strategy.noteAdded?.('foil pull')
    expect(binder.calls.applied).toEqual([note])
    expect(binder.calls.notes).toEqual(['foil pull'])
    expect(deck.calls.applied).toEqual([])
    expect(deck.calls.notes).toEqual([])

    // Undo Last Add is only ever offered for the last add, i.e. the active list.
    await session.strategy.discardSessionAdd?.(createCardSessionContext(), 0)
    expect(binder.calls.discardedAdds).toEqual([0])
    expect(deck.calls.discardedAdds).toEqual([])
  })

  test('the active list survives leaving All Lists mode and coming back', async () => {
    const { deck, binder } = fixture()
    const state = createAllListsState()
    const build = (): AllListsSession =>
      createAllListsSession({
        lists: [deck.open, binder.open],
        sessionConfig,
        saveAll: async () => {},
        state,
      })

    prompts.inject([binder.open])
    await build().strategy.handleCard(createCardSessionContext(), addInput('Mox Ruby'))

    // A fresh session over the same state still points at the binder.
    expect(build().ctx()).toBe(binder.open.ctx)
  })
})

describe('All Lists saving', () => {
  test('any list with pending changes or a dirty model makes the session unsaved', () => {
    const { session, deck, binder } = fixture()
    expect(session.strategy.hasUnsavedChanges()).toBe(false)

    // Dirty through the change events the engine tracks...
    deck.open.ctx.sessionChanges.push(createAddChange('Sol Ring', {}))
    expect(session.strategy.hasUnsavedChanges()).toBe(true)
    deck.open.ctx.sessionChanges.length = 0

    // ...or through the model alone (e.g. a deck format change).
    binder.setDirty(true)
    expect(session.strategy.hasUnsavedChanges()).toBe(true)
  })

  test('a save resets every open list, not just the active one', () => {
    const { session, deck, binder } = fixture()
    session.strategy.sessionSaved()
    expect(deck.calls.saved).toBe(1)
    expect(binder.calls.saved).toBe(1)
  })

  test('persisting the session saves all lists', async () => {
    const deck = fakeList(deckRef, [], [])
    const binder = fakeList(binderRef, [], [])
    let savedAll = 0
    const session = createAllListsSession({
      lists: [deck.open, binder.open],
      sessionConfig,
      saveAll: async () => {
        savedAll++
      },
      state: createAllListsState(),
    })
    await session.strategy.persist()
    expect(savedAll).toBe(1)
  })

  test('it has no file of its own, so it cannot be saved as a single list', async () => {
    const { session } = fixture()
    expect(session.strategy.saveTarget).toBeNull()
    // Writing a changelog for "All Lists" would be nonsense — fail loudly instead.
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(saveCardSession(session.strategy, createCardSessionContext())).rejects.toThrow(
      'one open list at a time',
    )
  })
})
