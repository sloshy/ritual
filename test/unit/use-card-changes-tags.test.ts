import { describe, expect, test } from 'bun:test'
import { useCardChanges } from '../../src/editor/useCardChanges'

/**
 * The tags wiring of the card-changes hook: one pending event per changed tag,
 * the cancel-against-a-pending-opposite rule, and the undo stack holding one
 * entry per event (so Undo reverts one tag at a time). The delta and
 * consolidation *semantics* (`cardTagsDelta`, `consolidateTagEdits`) are pinned
 * at the engine layer — this covers only what the hook adds. Assertions read the
 * raw `changes`/`undoStack` signals: memos never recompute under `bun test`.
 */
describe('useCardChanges — setTags', () => {
  test('records one add-tag / remove-tag per changed tag and one undo entry each', () => {
    const changes = useCardChanges()
    const result = changes.setTags('Sol Ring', ['ramp', 'staple'], ['old'], 5)

    expect(changes.changes()).toMatchObject([
      { action: 'add-tag', cardName: 'Sol Ring', tag: 'ramp', cardId: 5 },
      { action: 'add-tag', tag: 'staple', cardId: 5 },
      { action: 'remove-tag', tag: 'old', cardId: 5 },
    ])
    expect(result.addedChanges).toHaveLength(3)
    expect(result.cancelledChanges).toHaveLength(0)

    // Three tags changed, three undo steps — the gesture's last event pops first.
    expect(changes.undoStack()).toHaveLength(3)
    const undone = changes.undo()
    expect(undone?.entry.addedChange).toMatchObject({ action: 'remove-tag', tag: 'old' })
    expect(undone?.entry.cancelledChange).toBeNull()
    expect(changes.changes().map((c) => c.action)).toEqual(['add-tag', 'add-tag'])
  })

  test('removing a tag added this session cancels the pending add, leaving nothing pending', () => {
    const changes = useCardChanges()
    changes.setTags('Sol Ring', ['ramp'], undefined, 5)
    const result = changes.setTags('Sol Ring', [], ['ramp'], 5)

    expect(changes.changes()).toHaveLength(0)
    expect(result.addedChanges).toHaveLength(0)
    expect(result.cancelledChanges).toMatchObject([{ action: 'add-tag', tag: 'ramp' }])

    // The cancel is its own undo step: undoing it restores the pending add.
    expect(changes.undoStack()).toHaveLength(2)
    const undone = changes.undo()
    expect(undone?.entry.addedChange).toBeNull()
    expect(undone?.entry.cancelledChange).toMatchObject({ action: 'add-tag', tag: 'ramp' })
    expect(changes.changes()).toMatchObject([{ action: 'add-tag', tag: 'ramp' }])
  })

  test('a no-op edit (same set in another order) records nothing', () => {
    const changes = useCardChanges()
    const result = changes.setTags('Sol Ring', ['staple', 'ramp'], ['ramp', 'staple'], 5)
    expect(result).toEqual({ addedChanges: [], cancelledChanges: [] })
    expect(changes.changes()).toHaveLength(0)
    expect(changes.undoStack()).toHaveLength(0)
  })
})
