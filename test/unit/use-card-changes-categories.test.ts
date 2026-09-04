import { describe, expect, test } from 'bun:test'
import { useCardChanges } from '../../src/editor/useCardChanges'
import { createSetCategoriesChange } from '../../src/changes/change-event'

/**
 * The categories wiring of the card-changes hook. Categories are keyed by card
 * *name* and latest-wins, so a gesture is one `set-categories` event with no
 * `cardId` and one undo entry — the `setLabel` shape, not `setTags`'. The
 * consolidation semantics themselves are pinned at the engine layer
 * (`consolidateSetCategories`); this covers only what the hook adds. Assertions
 * read the raw signals: memos never recompute under `bun test`.
 */
describe('useCardChanges — setCategories', () => {
  test('records one name-keyed event with no cardId, and one undo entry', () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp', 'Artifacts'], undefined)

    expect(changes.changes()).toMatchObject([
      { action: 'set-categories', cardName: 'Sol Ring', categories: ['Ramp', 'Artifacts'] },
    ])
    expect(changes.changes()[0]).not.toHaveProperty('cardId')
    expect(changes.undoStack()).toHaveLength(1)
  })

  test('a second gesture on the same name replaces the first — latest wins', () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp'], undefined)
    changes.setCategories('Sol Ring', ['Artifacts'], undefined)

    expect(changes.changes()).toHaveLength(1)
    expect(changes.changes()[0]).toMatchObject({ categories: ['Artifacts'] })
  })

  test('restoring the loaded value records nothing at all', () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp'], ['Ramp'])

    expect(changes.changes()).toHaveLength(0)
    expect(changes.undoStack()).toHaveLength(0)
  })

  test('undo takes the whole assignment back in one step', () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp', 'Draw', 'Artifacts'], undefined)
    changes.undo()

    expect(changes.changes()).toHaveLength(0)
    expect(changes.undoStack()).toHaveLength(0)
  })
})

describe('useCardChanges — foldGoneCardCategories', () => {
  test("moves the name's pending set-categories onto the last undo entry", () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp'], undefined)
    changes.removeCard('Sol Ring', { cardId: 5 })
    changes.foldGoneCardCategories('Sol Ring')

    expect(changes.changes().map((c) => c.action)).toEqual(['remove'])
    const top = changes.undoStack().at(-1)!
    expect(top.displacedChanges).toMatchObject([{ action: 'set-categories', cardName: 'Sol Ring' }])
  })

  test('undoing that removal restores the folded event', () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp'], undefined)
    changes.removeCard('Sol Ring', { cardId: 5 })
    changes.foldGoneCardCategories('Sol Ring')
    changes.undo()

    expect(changes.changes()).toMatchObject([
      { action: 'set-categories', cardName: 'Sol Ring', categories: ['Ramp'] },
    ])
  })

  test('the fold matches by name fold, not by raw spelling', () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp'], undefined)
    changes.removeCard('sol ring', { cardId: 5 })
    changes.foldGoneCardCategories('SOL RING')

    expect(changes.changes().map((c) => c.action)).toEqual(['remove'])
  })

  test('with no undo entry to attach to, the event leaves and no entry is invented', () => {
    // Imported changes arrive with an empty undo stack (`loadChanges` resets it).
    // The card is gone, so its `set-categories` must go too — deliberately
    // unrestorable, because there is no undo entry that could put it back.
    const changes = useCardChanges()
    changes.loadChanges([createSetCategoriesChange('Sol Ring', ['Ramp'])])
    changes.foldGoneCardCategories('Sol Ring')

    expect(changes.changes()).toEqual([])
    expect(changes.undoStack()).toEqual([])
  })

  test('a fold matching nothing leaves the session untouched', () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp'], undefined)
    const before = changes.changes()
    changes.foldGoneCardCategories('Rhystic Study')

    expect(changes.changes()).toEqual(before)
    expect(changes.undoStack()[0]).not.toHaveProperty('displacedChanges')
  })
})

describe('useCardChanges — dropChanges with displaced changes', () => {
  test('a refused displaced event is stripped, and the entry keeps no empty array', () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp'], undefined)
    const displacedId = changes.changes()[0]!.id
    changes.removeCard('Sol Ring', { cardId: 5 })
    changes.foldGoneCardCategories('Sol Ring')

    changes.dropChanges(new Set([displacedId]))

    // The removal is still undoable; only its displaced half is gone.
    expect(changes.undoStack()).toHaveLength(1)
    expect(changes.undoStack()[0]).not.toHaveProperty('displacedChanges')
    // …so undo can no longer resurrect the refused event.
    changes.undo()
    expect(changes.changes()).toHaveLength(0)
  })

  test('an id the entry does not name leaves its displaced events untouched', () => {
    const changes = useCardChanges()
    changes.setCategories('Sol Ring', ['Ramp'], undefined)
    changes.removeCard('Sol Ring', { cardId: 5 })
    changes.foldGoneCardCategories('Sol Ring')

    changes.dropChanges(new Set(['some-other-id']))

    expect(changes.undoStack().at(-1)?.displacedChanges).toHaveLength(1)
  })
})
