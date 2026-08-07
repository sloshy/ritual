import { describe, expect, test } from 'bun:test'
import { useCardChanges } from '../../src/editor/useCardChanges'
import { createSetLanguageChange, type ChangeEvent } from '../../src/change-event'

/**
 * The set-language wiring of the card-changes hook: the pending event, its
 * "latest wins" consolidation, the undo stack entry, and `loadChanges`
 * round-tripping a set-language event. Consolidation *semantics*
 * (`consolidateSetLanguage`) are pinned by `change-event.test.ts` — this covers
 * only what the hook layer adds. Signals work under `bun test`, but memos
 * (`canUndo`, `changeCount`) resolve against solid's server build and never
 * recompute — so assertions read the raw `changes`/`undoStack` signals.
 */

describe('useCardChanges — setLanguage', () => {
  test('records a set-language change and a matching undo entry', () => {
    const changes = useCardChanges()
    changes.setLanguage('Lightning Bolt', 'ja', undefined, 1)

    expect(changes.changes()).toHaveLength(1)
    expect(changes.changes()[0]).toMatchObject({
      action: 'set-language',
      cardName: 'Lightning Bolt',
      language: 'ja',
      cardId: 1,
    })

    expect(changes.undoStack()).toHaveLength(1)
    const result = changes.undo()
    expect(result?.entry.addedChange).toMatchObject({ action: 'set-language', language: 'ja' })
    expect(result?.entry.cancelledChange).toBeNull()
    expect(changes.changes()).toHaveLength(0)
  })

  test('latest wins: a second language replaces the pending one, and undo restores it', () => {
    const changes = useCardChanges()
    changes.setLanguage('Lightning Bolt', 'ja', undefined, 1)
    changes.setLanguage('Lightning Bolt', 'de', undefined, 1)

    expect(changes.changes()).toHaveLength(1)
    expect(changes.changes()[0]).toMatchObject({ action: 'set-language', language: 'de' })

    // Undo of the consolidation puts the cancelled `ja` change back.
    changes.undo()
    expect(changes.changes()).toHaveLength(1)
    expect(changes.changes()[0]).toMatchObject({ action: 'set-language', language: 'ja' })
  })

  test('restoring the original language cancels the pending change outright', () => {
    const changes = useCardChanges()
    changes.setLanguage('Lightning Bolt', 'ja', 'de', 1)
    changes.setLanguage('Lightning Bolt', 'de', 'de', 1)
    expect(changes.changes()).toHaveLength(0)
    // Both steps are undoable: the cancel first, then the original set.
    expect(changes.undoStack()).toHaveLength(2)
  })

  test('a no-op set (already the original language, folding missing to en) records nothing', () => {
    const changes = useCardChanges()
    changes.setLanguage('Lightning Bolt', 'en', undefined, 1)
    expect(changes.changes()).toHaveLength(0)
    expect(changes.undoStack()).toHaveLength(0)
  })

  test('loadChanges accepts a set-language event', () => {
    const changes = useCardChanges()
    const loaded: ChangeEvent[] = [
      createSetLanguageChange('Lightning Bolt', { language: 'ja', cardId: 1 }),
    ]
    changes.loadChanges(loaded)
    expect(changes.changes()).toEqual(loaded)
    // Imported stacks start with a clean undo history.
    expect(changes.undoStack()).toHaveLength(0)
  })
})
