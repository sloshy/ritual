import { describe, expect, test } from 'bun:test'
import type { ChangeEvent } from '../../../src/changes/change-event'
import type { DeckData } from '../../../src/list/deck'
import { MAX_SAVE_CHANGES } from '../../../src/changes/save-limits'
import { listSaveRequest } from '../../../src/changes/wire-changes'
import { MAX_EDIT_BODY_SIZE } from '../../../src/admin/validation'
import { parseDeckText } from '../../../src/importers/text-file'
import { createRetargetState } from '../../../src/editor/import-changes'
import { rewriteMergedDeckIds, saveChunks } from '../../../src/admin/api/import-changes'

/** A name-only add, `i` making each one distinguishable. */
function add(i: number): ChangeEvent {
  return { id: `a${i}`, timestamp: i, action: 'add', cardName: 'Sol Ring', cardId: i + 1 }
}

/** A note change of `noteLength` repetitions of `char` (one byte each by default). */
function bigNote(i: number, noteLength: number, char = 'x'): ChangeEvent {
  return {
    id: `n${i}`,
    timestamp: i,
    action: 'set-note',
    cardName: 'Sol Ring',
    cardId: 3,
    note: char.repeat(noteLength),
  }
}

/** The UTF-8 size of the save body a chunk is posted as. */
function bodyBytes(chunk: readonly ChangeEvent[]): number {
  const body = JSON.stringify(listSaveRequest(chunk, 'a'.repeat(64), { continueSession: true }))
  return new TextEncoder().encode(body).byteLength
}

describe('saveChunks', () => {
  test('splits at MAX_SAVE_CHANGES, keeping order', () => {
    const changes = Array.from({ length: 2 * MAX_SAVE_CHANGES + 1 }, (_, i) => add(i))
    const chunks = saveChunks(changes)
    expect(chunks.map((chunk) => chunk.length)).toEqual([MAX_SAVE_CHANGES, MAX_SAVE_CHANGES, 1])
    expect(chunks.flat()).toEqual(changes)
  })

  test('splits before a chunk would outgrow the save body budget, keeping order', () => {
    // ~1 MB each: about nine fit one save, so 25 need three.
    const changes = Array.from({ length: 25 }, (_, i) => bigNote(i, 1_000_000))
    const chunks = saveChunks(changes)
    expect(chunks.length).toBe(3)
    for (const chunk of chunks) expect(bodyBytes(chunk)).toBeLessThanOrEqual(MAX_EDIT_BODY_SIZE)
    expect(chunks.flat()).toEqual(changes)
  })

  test('measures the budget in UTF-8 bytes, not string length', () => {
    // 300,000 characters, but ~900 KB: three bytes each on the wire.
    const changes = Array.from({ length: 25 }, (_, i) => bigNote(i, 300_000, '漢'))
    const chunks = saveChunks(changes)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(bodyBytes(chunk)).toBeLessThanOrEqual(MAX_EDIT_BODY_SIZE)
    expect(chunks.flat()).toEqual(changes)
  })

  test('never emits an empty chunk, even around an event larger than the budget', () => {
    expect(saveChunks([])).toEqual([])
    const huge = bigNote(1, MAX_EDIT_BODY_SIZE)
    expect(saveChunks([add(0), huge, add(2)])).toEqual([[add(0)], [huge], [add(2)]])
  })
})

/** The `&N` each change ends up naming. */
function cardIds(changes: readonly ChangeEvent[]): (number | undefined)[] {
  return changes.map((change) => ('cardId' in change ? change.cardId : undefined))
}

function solRingAdd(id: string, cardId: number, set: string, collectorNumber: string): ChangeEvent {
  return { id, timestamp: 1, action: 'add', cardName: 'Sol Ring', cardId, set, collectorNumber }
}

describe('rewriteMergedDeckIds', () => {
  const deck = (): DeckData =>
    parseDeckText('# Test\n\n## Main\n1 Sol Ring (2XM:5) &3\n', 'Test').deck

  test('an add with no line to merge onto at its own step keeps its id', () => {
    // Judged against the finished deck instead, the first add would be pointed
    // at &11 — a line only the third change creates — and the remove would then
    // miss the line it names.
    const changes: ChangeEvent[] = [
      solRingAdd('1', 10, 'lea', '1'),
      { id: '2', timestamp: 2, action: 'remove', cardName: 'Sol Ring', cardId: 10 },
      solRingAdd('3', 11, 'lea', '1'),
    ]
    expect(
      cardIds(rewriteMergedDeckIds(deck(), changes, createRetargetState(), undefined)),
    ).toEqual([10, 10, 11])
  })

  test('an add matching a line the deck holds at that step is rewritten to that line', () => {
    const changes: ChangeEvent[] = [
      solRingAdd('1', 10, 'lea', '1'),
      // Merges onto the line the first add just created.
      solRingAdd('2', 11, 'lea', '1'),
      // Merges onto the line the deck already had.
      solRingAdd('3', 12, '2xm', '5'),
    ]
    expect(
      cardIds(rewriteMergedDeckIds(deck(), changes, createRetargetState(), undefined)),
    ).toEqual([10, 10, 3])
  })

  test('the re-target state follows a rewritten id, so a later reference resolves', () => {
    const state = createRetargetState()
    state.idMap.set(77, 12)
    state.addedByName.set('Sol Ring', 12)

    rewriteMergedDeckIds(deck(), [solRingAdd('1', 12, '2xm', '5')], state, undefined)

    expect(state.idMap.get(77)).toBe(3)
    expect(state.addedByName.get('Sol Ring')).toBe(3)
  })
})
