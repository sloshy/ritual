import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  parseCardBulkProvenance,
  readRecordedCardBulkType,
  recordCardBulkType,
} from '../../../src/cache/bulk-provenance'
import { setBaseDir } from '../../../src/config/base-dir'

const testDir = path.join(import.meta.dir, '../../.test-bulk-provenance')
const originalCwd = process.cwd()

beforeEach(async () => {
  await fs.mkdir(testDir, { recursive: true })
  setBaseDir(testDir)
})

afterEach(async () => {
  setBaseDir(originalCwd)
  await fs.rm(testDir, { recursive: true, force: true })
})

describe('parseCardBulkProvenance', () => {
  test('round-trips a valid record', () => {
    const record = { bulkType: 'all_cards', recordedAt: '2026-08-06T00:00:00.000Z' }
    expect(parseCardBulkProvenance(record)).toEqual({
      bulkType: 'all_cards',
      recordedAt: '2026-08-06T00:00:00.000Z',
    })
  })

  test.each([[null], [[]], ['nope']])('rejects non-object payload %p', (payload) => {
    expect(typeof parseCardBulkProvenance(payload)).toBe('string')
  })

  test('rejects an unknown bulkType', () => {
    const result = parseCardBulkProvenance({ bulkType: 'rulings', recordedAt: 'x' })
    expect(result as string).toContain("unknown bulkType 'rulings'")
  })

  test('rejects a missing recordedAt', () => {
    const result = parseCardBulkProvenance({ bulkType: 'default_cards' })
    expect(result as string).toContain('recordedAt')
  })
})

describe('readRecordedCardBulkType / recordCardBulkType', () => {
  test('reads null when no provenance has ever been recorded', async () => {
    expect(await readRecordedCardBulkType()).toBeNull()
  })

  test('round-trips the recorded bulk type through the sidecar file', async () => {
    await recordCardBulkType('all_cards', { now: () => new Date('2026-08-06T12:00:00Z') })
    expect(await readRecordedCardBulkType()).toBe('all_cards')

    // The injected clock is the oracle for the recorded timestamp.
    const sidecar = JSON.parse(
      await fs.readFile(path.join(testDir, 'cache', 'card-bulk.json'), 'utf-8'),
    ) as { bulkType: string; recordedAt: string }
    expect(sidecar).toEqual({ bulkType: 'all_cards', recordedAt: '2026-08-06T12:00:00.000Z' })

    // A later ingest from the other bulk overwrites the record.
    await recordCardBulkType('default_cards')
    expect(await readRecordedCardBulkType()).toBe('default_cards')
  })

  test('a malformed sidecar reads as unrecorded rather than throwing', async () => {
    const sidecar = path.join(testDir, 'cache', 'card-bulk.json')
    await fs.mkdir(path.dirname(sidecar), { recursive: true })
    await fs.writeFile(sidecar, 'not json')
    expect(await readRecordedCardBulkType()).toBeNull()

    await fs.writeFile(sidecar, JSON.stringify({ bulkType: 'bogus', recordedAt: 'x' }))
    expect(await readRecordedCardBulkType()).toBeNull()
  })
})
