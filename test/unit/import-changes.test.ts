import { describe, it, expect } from 'bun:test'
import type { ChangeEvent } from '../../src/change-event'
import { createRetargetState, retargetImportedChanges } from '../../src/editor/import-changes'

/** A counting allocator starting after the current IDs, mirroring the editor's pool. */
function allocator(start: number): () => number {
  let next = start
  return () => next++
}

describe('retargetImportedChanges', () => {
  it('remembers what an earlier batch allocated, so a later batch’s edit on that copy resolves', () => {
    // A list's events are applied in several batches when other lists' events
    // interleave in time; the list is loaded fresh each time, so only the
    // carried state knows that exported id 7 became &2.
    const state = createRetargetState()
    const first = retargetImportedChanges({
      changes: [
        {
          id: '1',
          timestamp: 1,
          action: 'move-to',
          cardName: 'Sol Ring',
          cardId: 7,
          from: { type: 'collection', name: 'Binder' },
          set: 'c21',
          collectorNumber: '263',
        },
      ],
      currentIds: new Set([1]),
      allocateId: allocator(2),
      findIdByName: () => undefined,
      state,
    })
    expect(first.retargeted).toMatchObject([{ cardId: 2 }])

    const second = retargetImportedChanges({
      changes: [
        {
          id: '2',
          timestamp: 3,
          action: 'set-finish',
          cardName: 'Sol Ring',
          finish: 'foil',
          cardId: 7,
        },
      ],
      currentIds: new Set([1, 2]),
      allocateId: allocator(3),
      // The freshly loaded list holds two Sol Rings now; the name fallback
      // would be a coin toss — the id map is what says which one.
      findIdByName: () => 1,
      state,
    })
    expect(second.conflicts).toHaveLength(0)
    expect(second.retargeted).toMatchObject([{ action: 'set-finish', cardId: 2 }])
  })

  it('copies that shared one exported id (a merged deck line) share the allocated id too', () => {
    const moveTo = (id: string): ChangeEvent => ({
      id,
      timestamp: 1,
      action: 'move-to',
      cardName: 'Sol Ring',
      cardId: 9,
      from: { type: 'collection', name: 'Binder' },
      set: 'c21',
      collectorNumber: '263',
    })
    const { retargeted } = retargetImportedChanges({
      changes: [moveTo('a'), moveTo('b')],
      currentIds: new Set([1]),
      allocateId: allocator(2),
      findIdByName: () => undefined,
    })
    expect(retargeted).toMatchObject([{ cardId: 2 }, { cardId: 2 }])
  })

  it('resolves a follow-up edit on a copy a move brought in by name, before the loaded list', () => {
    // A bundle move carries no destination id, so the move-to lands with none
    // and the set-finish that followed it in the browser references an id the
    // list never had. The loaded list already holds a same-named line (&1):
    // the copy this import just added must win, or the finish would land on
    // the wrong line.
    const changes: ChangeEvent[] = [
      {
        id: '1',
        timestamp: 1,
        action: 'move-to',
        cardName: 'Sol Ring',
        from: { type: 'collection', name: 'Binder' },
        set: 'c21',
        collectorNumber: '263',
        sourceCardId: 7,
        section: 'Sideboard',
      },
      {
        id: '2',
        timestamp: 2,
        action: 'set-finish',
        cardName: 'Sol Ring',
        finish: 'foil',
        cardId: 99,
      },
    ]
    const { retargeted, conflicts } = retargetImportedChanges({
      changes,
      currentIds: new Set([1]),
      allocateId: allocator(2),
      findIdByName: () => 1,
    })
    // The source-line hint and the destination section ride through the re-target untouched.
    expect(retargeted[0]).toMatchObject({
      action: 'move-to',
      sourceCardId: 7,
      section: 'Sideboard',
    })
    expect(conflicts).toHaveLength(0)
    expect(retargeted).toMatchObject([{ cardId: 2 }, { action: 'set-finish', cardId: 2 }])
  })

  it('gives add changes fresh IDs and remaps later references to them', () => {
    const changes: ChangeEvent[] = [
      { id: '1', timestamp: 1, action: 'add', cardName: 'Sol Ring', cardId: 50 },
      {
        id: '2',
        timestamp: 2,
        action: 'set-finish',
        cardName: 'Sol Ring',
        finish: 'foil',
        cardId: 50,
      },
    ]
    const { retargeted, conflicts } = retargetImportedChanges({
      changes,
      currentIds: new Set([1, 2, 3]),
      allocateId: allocator(4),
      findIdByName: () => undefined,
    })
    expect(conflicts).toHaveLength(0)
    // The add got fresh ID 4, and the follow-up set-finish was remapped to it.
    expect(retargeted[0]).toMatchObject({ action: 'add', cardId: 4 })
    expect(retargeted[1]).toMatchObject({ action: 'set-finish', cardId: 4 })
  })

  it('gives move-to changes fresh IDs even when the exported ID exists here', () => {
    // A `move-to` *creates* an entry in the destination, so its exported id is a
    // source-list id — reusing it would collide with the card that already holds
    // it in this list.
    const changes: ChangeEvent[] = [
      {
        id: '1',
        timestamp: 1,
        action: 'move-to',
        cardName: 'Sol Ring',
        cardId: 7,
        from: { type: 'collection', name: 'Binder' },
      },
      {
        id: '2',
        timestamp: 2,
        action: 'set-note',
        cardName: 'Sol Ring',
        cardId: 7,
        note: 'traded',
      },
    ]
    const { retargeted, conflicts } = retargetImportedChanges({
      changes,
      currentIds: new Set([7]),
      allocateId: allocator(20),
      findIdByName: () => 7,
    })
    expect(conflicts).toHaveLength(0)
    expect(retargeted[0]).toMatchObject({ action: 'move-to', cardId: 20 })
    // The later change that named the exported id follows the remap.
    expect(retargeted[1]).toMatchObject({ action: 'set-note', cardId: 20 })
  })

  it('keeps a target ID that still exists in the current list', () => {
    const changes: ChangeEvent[] = [
      { id: '1', timestamp: 1, action: 'remove', cardName: 'Llanowar Elves', cardId: 7 },
    ]
    const { retargeted, conflicts } = retargetImportedChanges({
      changes,
      currentIds: new Set([7]),
      allocateId: allocator(10),
      findIdByName: () => 999,
    })
    expect(conflicts).toHaveLength(0)
    expect(retargeted[0]).toMatchObject({ cardId: 7 })
  })

  it('falls back to matching by name when the exported ID is gone', () => {
    const changes: ChangeEvent[] = [
      { id: '1', timestamp: 1, action: 'remove', cardName: 'Brainstorm', cardId: 88 },
    ]
    const { retargeted, conflicts } = retargetImportedChanges({
      changes,
      currentIds: new Set([1, 2]),
      allocateId: allocator(10),
      findIdByName: (name) => (name === 'Brainstorm' ? 2 : undefined),
    })
    expect(conflicts).toHaveLength(0)
    expect(retargeted[0]).toMatchObject({ cardId: 2 })
  })

  it('reports a conflict when neither the ID nor the name resolves', () => {
    const changes: ChangeEvent[] = [
      { id: '1', timestamp: 1, action: 'remove', cardName: 'Ghost Card', cardId: 88 },
    ]
    const { retargeted, conflicts } = retargetImportedChanges({
      changes,
      currentIds: new Set([1, 2]),
      allocateId: allocator(10),
      findIdByName: () => undefined,
    })
    expect(retargeted).toHaveLength(0)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.change).toMatchObject({ cardName: 'Ghost Card' })
  })

  it('passes section-structural changes through unchanged', () => {
    const changes: ChangeEvent[] = [
      { id: '1', timestamp: 1, action: 'add-section', section: 'Lands' },
      { id: '2', timestamp: 2, action: 'rename-section', section: 'Lands', newSection: 'Mana' },
    ]
    const { retargeted, conflicts } = retargetImportedChanges({
      changes,
      currentIds: new Set(),
      allocateId: allocator(1),
      findIdByName: () => undefined,
    })
    expect(conflicts).toHaveLength(0)
    expect(retargeted).toEqual(changes)
  })
})
