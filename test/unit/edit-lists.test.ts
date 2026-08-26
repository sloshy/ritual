import { describe, expect, test } from 'bun:test'
import {
  trackListCreation,
  type TrackedCreation,
  type UnifiedListRef,
} from '../../src/commands/session/edit-lists'
import { buildInitialSessionConfig } from '../../src/commands/session/config'
import {
  createCardSessionContext,
  type CardSessionContext,
  type CardSessionStrategy,
  type SessionChangeItem,
} from '../../src/commands/session/strategy'

/**
 * `trackListCreation` fronts a not-yet-created list's strategy so the creation
 * shows up as that list's first session change, and taking it back drops the
 * whole list. Everything else must pass straight through to the real strategy.
 */

const ref: UnifiedListRef = { type: 'wanted', name: 'To Buy', file: '/wanted/to-buy.md' }

type Inner = { strategy: CardSessionStrategy; discarded: number[]; saved: number }

/** A strategy whose session changes are whatever the test says they are. */
function innerStrategy(changes: string[]): Inner {
  const inner: Inner = { strategy: {} as CardSessionStrategy, discarded: [], saved: 0 }
  inner.strategy = {
    managerLabel: 'wanted list manager',
    saveTarget: { filePath: ref.file, listName: ref.name },
    receiveMove: () => {},
    sessionConfig: buildInitialSessionConfig({}, undefined),
    updateConfig: async () => [],
    applyChange: () => {},
    persist: async () => {},
    hasUnsavedChanges: () => true,
    sessionSaved: () => {
      inner.saved++
    },
    handleCard: async () => {},
    addAnotherCopy: async () => {},
    listSessionChanges: (): SessionChangeItem[] => changes.map((label) => ({ label })),
    discardSessionChange: async (_ctx: CardSessionContext, index: number) => {
      inner.discarded.push(index)
    },
    listEntries: () => [],
    editEntry: async () => {},
    lastEditUndoLabel: () => null,
    undoLastEdit: async () => {},
  }
  return inner
}

type Tracked = TrackedCreation & { inner: Inner; dropped: string[] }

function tracked(changes: string[] = [], inboundMoves?: () => number): Tracked {
  const inner = innerStrategy(changes)
  const dropped: string[] = []
  const { strategy, isNew } = trackListCreation(
    inner.strategy,
    ref,
    () => dropped.push(ref.file),
    inboundMoves,
  )
  return { strategy, isNew, inner, dropped }
}

describe('a pending list creation in the session changes', () => {
  test('leads the list’s changes, and is discardable while the list is empty', () => {
    const { strategy, isNew } = tracked()
    expect(isNew()).toBe(true)
    expect(strategy.listSessionChanges()).toEqual([
      { label: 'Created this wanted list', blocked: undefined },
    ])
  })

  test('sits ahead of the list’s own card changes', () => {
    const { strategy } = tracked(['added Sol Ring', 'added Mox Ruby'])
    expect(strategy.listSessionChanges().map((c) => c.label)).toEqual([
      'Created this wanted list',
      'added Sol Ring',
      'added Mox Ruby',
    ])
  })

  test('cannot be discarded while the list still has card changes', async () => {
    const { strategy, dropped } = tracked(['added Sol Ring'])
    // Dropping the list here would strand the card change that belongs to it.
    expect(strategy.listSessionChanges()[0]?.blocked).toBe(
      "discard this wanted list's 1 card change(s) first",
    )

    // The picker refuses it, and so does the wrapper if asked directly anyway.
    await strategy.discardSessionChange(createCardSessionContext(), 0)
    expect(dropped).toEqual([])
    expect(strategy.discarded?.()).toBe(false)
  })

  test('cannot be discarded while another open list holds a pending move into it', async () => {
    let inbound = 2
    const { strategy, dropped } = tracked([], () => inbound)
    // Dropping the list would leave the inbound moves with nowhere to deliver.
    expect(strategy.listSessionChanges()[0]?.blocked).toBe(
      'discard the 2 pending move(s) into this wanted list first',
    )
    await strategy.discardSessionChange(createCardSessionContext(), 0)
    expect(dropped).toEqual([])

    // Once the inbound moves are gone, the creation is discardable again.
    inbound = 0
    expect(strategy.listSessionChanges()[0]?.blocked).toBeUndefined()
    await strategy.discardSessionChange(createCardSessionContext(), 0)
    expect(dropped).toEqual([ref.file])
  })

  test('offsets the indices of the card changes behind it', async () => {
    const { strategy, inner } = tracked(['added Sol Ring', 'added Mox Ruby'])
    const ctx = createCardSessionContext()

    await strategy.discardSessionChange(ctx, 2)
    await strategy.discardSessionChange(ctx, 1)
    expect(inner.discarded).toEqual([1, 0])
    expect(strategy.discarded?.()).toBe(false)
  })

  test('discarding it drops the list and empties the session', async () => {
    const { strategy, dropped } = tracked()
    expect(strategy.discarded?.()).toBe(false)

    await strategy.discardSessionChange(createCardSessionContext(), 0)
    expect(dropped).toEqual([ref.file])
    expect(strategy.discarded?.()).toBe(true)
    expect(strategy.listSessionChanges()).toEqual([])
  })

  test('saving commits the creation, so it stops being a pending change', async () => {
    const { strategy, isNew, inner } = tracked(['added Sol Ring'])
    strategy.sessionSaved()

    expect(inner.saved).toBe(1)
    expect(isNew()).toBe(false)
    // The list is on disk now, so its changes pass through unshifted.
    expect(strategy.listSessionChanges()).toEqual([{ label: 'added Sol Ring' }])
    await strategy.discardSessionChange(createCardSessionContext(), 0)
    expect(inner.discarded).toEqual([0])
  })
})
