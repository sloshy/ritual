import { describe, it, expect } from 'bun:test'
import type { ChangeEvent } from '../../src/change-event'
import { retargetImportedChanges } from '../../src/editor/import-changes'

/** A counting allocator starting after the current IDs, mirroring the editor's pool. */
function allocator(start: number): () => number {
  let next = start
  return () => next++
}

describe('retargetImportedChanges', () => {
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
