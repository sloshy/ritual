import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleImportCsv, type ImportCsvResponse } from '../../src/admin/api/import-csv'
import type { ApiErrorResponse } from '../../src/admin/api/save-helpers'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'

/**
 * The CSV import handler writes real list files, so it belongs here rather than
 * in the unit suite — and on a throwaway workspace rather than a fixed directory
 * under `test/`, which two suites running at once would share.
 */

let ws: BoundWorkspace
let testDir: string

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/import-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A 2xx carries the report; a refusal carries only the shared error envelope. */
type ImportCsvResult = { status: number; data: ImportCsvResponse; error: ApiErrorResponse }

async function importCsv(body: unknown): Promise<ImportCsvResult> {
  const resp = await handleImportCsv(makeRequest(body))
  const parsed: unknown = await resp.json()
  return {
    status: resp.status,
    data: parsed as ImportCsvResponse,
    error: parsed as ApiErrorResponse,
  }
}

const COLLECTION_CSV = [
  'Name,Set,Collector Number,Finish,Condition,Quantity',
  'Sol Ring,c19,221,F,Near Mint,2',
  '"Jace, the Mind Sculptor",WWK,31,,LP,1',
].join('\n')

const COLLECTION_COLUMNS = 'name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6'

describe('admin import-csv handler (Integration)', () => {
  beforeEach(async () => {
    ws = await bindWorkspace()
    testDir = ws.dir
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('creates a collection from CSV with canonical lines', async () => {
    const { status, data } = await importCsv({
      listType: 'collection',
      name: 'Binder',
      // overwrite behaves like create on a fresh dir; pins MODES acceptance of 'overwrite'
      mode: 'overwrite',
      content: COLLECTION_CSV,
      columns: COLLECTION_COLUMNS,
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.cardCount).toBe(3)
    // Always an array now, so a client never has to distinguish "no failures"
    // from "the field was omitted".
    expect(data.failures).toEqual([])
    expect(data.failedCount).toBe(0)

    const content = await fs.readFile(path.join(testDir, 'collections', 'Binder.md'), 'utf-8')
    expect(content).toBe(
      [
        '# Binder',
        '',
        '## Main',
        '- Sol Ring (C19:221) [foil] &1',
        '- Sol Ring (C19:221) [foil] &2',
        '- Jace, the Mind Sculptor (WWK:31) [LP] &3',
        '',
      ].join('\n'),
    )
  })

  test('requires a format when creating a deck', async () => {
    const { status, error } = await importCsv({
      listType: 'deck',
      name: 'Burn',
      content: 'Name\nLightning Bolt',
      columns: 'name=1',
    })
    expect(status).toBe(400)
    expect(error.message).toContain('format is required')
  })

  test('creates a deck with sections and frontmatter format', async () => {
    const { status, data } = await importCsv({
      listType: 'deck',
      name: 'Burn',
      format: 'Modern',
      content: ['4,Lightning Bolt,', '2,Pyroblast,side'].join('\n'),
      columns: 'quantity=1,name=2,section=3',
      hasHeader: false,
    })
    expect(status).toBe(200)
    expect(data.cardCount).toBe(6)

    const content = await fs.readFile(path.join(testDir, 'decks', 'Burn.md'), 'utf-8')
    expect(content).toContain('format: modern')
    expect(content).toContain('## Main\n4 Lightning Bolt &')
    expect(content).toContain('## Sideboard\n2 Pyroblast &')
  })

  test('appends to an existing wanted list and writes a changelog', async () => {
    const filePath = path.join(testDir, 'wanted', 'Wishlist.md')
    await fs.writeFile(filePath, '# Wishlist\n\n## Main\n- Mox Ruby &1\n')

    const { status, data } = await importCsv({
      listType: 'wanted',
      name: 'Wishlist',
      mode: 'append',
      content: 'Brainstorm,mmq,61',
      columns: 'name=1,set=2,collector-number=3',
      hasHeader: false,
    })
    expect(status).toBe(200)
    expect(data.message).toContain('Appended 1 card(s)')

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('- Mox Ruby &1')
    expect(content).toContain('- Brainstorm (MMQ:61) &2')

    const changelog = await fs.readFile(
      path.join(testDir, 'wanted', 'Wishlist.changes.md'),
      'utf-8',
    )
    expect(changelog).toContain('Added "Brainstorm" (MMQ:61) &2')
  })

  test('reports partial failures while importing the valid rows', async () => {
    const { status, data } = await importCsv({
      listType: 'collection',
      name: 'Partial',
      content: ['Name,Set,Collector Number', 'Sol Ring,C19,221', 'No Printing,,'].join('\n'),
      columns: 'name=1,set=2,collector-number=3',
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.cardCount).toBe(1)
    expect(data.failures).toHaveLength(1)
    expect(data.failedCount).toBe(1)
    expect(data.failures[0]!.lineNumber).toBe(3)
  })

  test('a request whose every row fails is a 200 carrying the per-row report', async () => {
    // The request itself was well formed; the rows were not. Folding that into
    // the envelope is what made clients that treat `success: false` as "throw"
    // discard the report exactly when it mattered.
    const { status, data } = await importCsv({
      listType: 'collection',
      name: 'Nothing',
      content: 'Name,Set,Collector Number\nNo Printing,,',
      columns: 'name=1,set=2,collector-number=3',
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.cardCount).toBe(0)
    expect(data.failedCount).toBe(1)
    expect(data.failures).toHaveLength(1)
    // Nothing was written: there was nothing to write.
    expect(await Bun.file(path.join(testDir, 'collections', 'Nothing.md')).exists()).toBe(false)
  })

  test('an all-rows-failed overwrite leaves the existing list byte-identical', async () => {
    // The dangerous corner of the "0 imported is still a 200" contract: an
    // `overwrite` that has nothing to write must not write nothing *over* an
    // existing list. The handler returns before `applyCsvImport` is reached.
    const filePath = path.join(testDir, 'collections', 'Keeper.md')
    const before = '# Keeper\n\n## Main\n- Mox Ruby (LEA:265) &1\n'
    await fs.writeFile(filePath, before)

    const { status, data } = await importCsv({
      listType: 'collection',
      name: 'Keeper',
      mode: 'overwrite',
      content: 'Name,Set,Collector Number\nNo Printing,,',
      columns: 'name=1,set=2,collector-number=3',
    })
    expect(status).toBe(200)
    expect(data.cardCount).toBe(0)
    expect(data.failedCount).toBe(1)
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })

  test('a partial import says so in its message, not only in failedCount', async () => {
    // `message` is what the admin banner shows and what an agent reads back, so
    // "Imported 1 card(s)" alone reads as a clean run.
    const { data } = await importCsv({
      listType: 'collection',
      name: 'Mixed',
      content: ['Name,Set,Collector Number', 'Sol Ring,C19,221', 'No Printing,,'].join('\n'),
      columns: 'name=1,set=2,collector-number=3',
    })
    expect(data.message).toBe(
      "Imported 1 card(s) into collection 'Mixed'; 1 row(s) failed validation",
    )
  })

  test('append to a missing list returns 400', async () => {
    const { status, error } = await importCsv({
      listType: 'collection',
      name: 'Ghost',
      mode: 'append',
      content: 'Sol Ring,C19,221',
      columns: 'name=1,set=2,collector-number=3',
      hasHeader: false,
    })
    expect(status).toBe(400)
    expect(error.success).toBe(false)
  })

  test('rejects malformed request bodies and bad mappings', async () => {
    const missingFields = await importCsv({ listType: 'collection' })
    expect(missingFields.status).toBe(400)

    const badType = await importCsv({
      listType: 'binder',
      name: 'X',
      content: 'a',
      columns: 'name=1',
    })
    expect(badType.status).toBe(400)

    const badColumns = await importCsv({
      listType: 'collection',
      name: 'X',
      content: 'Name\nSol Ring',
      columns: 'name=1,rarity=2',
    })
    expect(badColumns.status).toBe(400)
    expect(badColumns.error.message).toContain("Unknown field 'rarity'")
  })
})
