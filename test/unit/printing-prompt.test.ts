import { afterEach, describe, expect, test } from 'bun:test'
import {
  bulkMoveToList,
  pendingPrintingPrompt,
  printingOf,
} from '../../src/list-view/printing-prompt'
import type { ListRef, PrintingTuple } from '../../src/changes/change-event'
import { makeSelectedCard } from '../test-utils'

const DECK: ListRef = { type: 'deck', name: 'Goblins' }
const BINDER: ListRef = { type: 'collection', name: 'Binder' }

/**
 * Let the queued microtasks of a fire-and-forget loop run: each awaited card
 * is one hop, so a bounded drain settles the loop without a macrotask timer.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// A prompt left open would leak into the next test's `pendingPrintingPrompt()`.
afterEach(() => pendingPrintingPrompt()?.onSkip())

describe('printingOf', () => {
  test('keeps the four printing fields and drops everything else, language included', () => {
    const card = makeSelectedCard({
      name: 'Sol Ring',
      set: 'lea',
      collectorNumber: '161',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
      note: 'signed',
    })
    expect(printingOf(card)).toEqual({
      set: 'lea',
      collectorNumber: '161',
      finish: 'foil',
      condition: 'LP',
    })
  })
})

describe('bulkMoveToList', () => {
  test('emits each card in order with its current printing when no prompt is needed', async () => {
    const emitted: [string, ListRef, PrintingTuple][] = []
    const a = makeSelectedCard({ name: 'Sol Ring', set: 'lea', collectorNumber: '161' })
    const b = makeSelectedCard({ name: 'Counterspell' })
    bulkMoveToList([a, b], DECK, (c, dest, printing) => emitted.push([c.name, dest, printing]))
    await settle()
    expect(emitted).toEqual([
      [
        'Sol Ring',
        DECK,
        { set: 'lea', collectorNumber: '161', finish: undefined, condition: undefined },
      ],
      [
        'Counterspell',
        DECK,
        { set: undefined, collectorNumber: undefined, finish: undefined, condition: undefined },
      ],
    ])
  })

  test('a name-only card bound for a collection is prompted, and a skipped prompt drops only that card', async () => {
    const emitted: string[] = []
    const nameOnly = makeSelectedCard({ name: 'Counterspell', printings: [] })
    const pinned = makeSelectedCard({ name: 'Sol Ring', set: 'lea', collectorNumber: '161' })
    bulkMoveToList([nameOnly, pinned], BINDER, (c) => emitted.push(c.name))
    await settle()
    expect(pendingPrintingPrompt()?.cardName).toBe('Counterspell')
    expect(emitted).toEqual([])
    pendingPrintingPrompt()?.onSkip()
    await settle()
    expect(pendingPrintingPrompt()).toBeNull()
    expect(emitted).toEqual(['Sol Ring'])
  })
})
