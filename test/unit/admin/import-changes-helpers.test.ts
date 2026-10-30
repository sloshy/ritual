import { describe, expect, test } from 'bun:test'
import type { ChangeEvent } from '../../../src/changes/change-event'
import { MAX_SAVE_CHANGES } from '../../../src/changes/save-limits'
import { listSaveRequest } from '../../../src/changes/wire-changes'
import { MAX_EDIT_BODY_SIZE } from '../../../src/admin/validation'
import { saveChunks } from '../../../src/admin/api/import-changes'

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
