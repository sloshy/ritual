import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { writeCsvImport, formatScriptingCommand } from '../../src/commands/import-csv'
import {
  convertCsvRows,
  parseColumnsSpec,
  parseCsv,
  type ColumnMapping,
  type CsvConversionResult,
} from '../../src/importers/csv'
import type { ListType } from '../../src/list-type'

function prepareEntries(
  csv: string,
  spec: string,
  listType: ListType,
  hasHeader = true,
): CsvConversionResult {
  const parsed = parseCsv(csv)
  if ('error' in parsed) throw new Error(parsed.error)
  const mapping = parseColumnsSpec(spec, listType) as ColumnMapping
  return convertCsvRows(hasHeader ? parsed.rows.slice(1) : parsed.rows, mapping, listType)
}

describe('import-csv', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-csv-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('imports a collection CSV end-to-end with canonical lines and IDs', async () => {
    // Set codes are deliberately mixed-case to pin the lowercase-in-memory /
    // uppercase-on-write normalization.
    const csv = [
      'Name,Set,Collector Number,Finish,Condition,Quantity',
      '"Adeline, Resplendent Cathar",mid,1,,NM,1',
      'Sol Ring,C19,221,foil,Near Mint,2',
      'Arcane Signet,,,F,NM,1',
    ].join('\n')

    const { entries, failures } = prepareEntries(
      csv,
      'name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6',
      'collection',
    )

    expect(failures).toHaveLength(1)
    expect(failures[0]!.lineNumber).toBe(4)

    const result = await writeCsvImport({
      listType: 'collection',
      name: 'Red Binder',
      entries,
      targetDir: tmpDir,
      overwrite: false,
    })
    if ('error' in result) throw new Error(result.error)
    expect(result.cardCount).toBe(3)

    const content = await fs.readFile(result.filePath, 'utf-8')
    expect(content).toBe(
      [
        '# Red Binder',
        '',
        '## Main',
        '- Adeline, Resplendent Cathar (MID:1) [NM] &1',
        '- Sol Ring (C19:221) [foil] [NM] &2',
        '- Sol Ring (C19:221) [foil] [NM] &3',
        '',
      ].join('\n'),
    )
  })

  test('imports a deck CSV with sections, format frontmatter, and quantities', async () => {
    const csv = [
      'Count,Name,Section',
      '1,Sol Ring,',
      '2,Lightning Bolt,side',
      '1,Smothering Tithe,maybe',
      '1,Llanowar Elves,Ramp Package',
    ].join('\n')

    const { entries, failures } = prepareEntries(csv, 'quantity=1,name=2,section=3', 'deck')
    expect(failures).toEqual([])

    const result = await writeCsvImport({
      listType: 'deck',
      name: 'CSV Deck',
      format: 'commander',
      entries,
      targetDir: tmpDir,
      overwrite: false,
    })
    if ('error' in result) throw new Error(result.error)
    expect(result.cardCount).toBe(5)

    const content = await fs.readFile(result.filePath, 'utf-8')
    expect(content).toContain('name: CSV Deck')
    expect(content).toContain('format: commander')
    expect(content).toContain('## Main\n1 Sol Ring &')
    expect(content).toContain('## Sideboard\n2 Lightning Bolt &')
    expect(content).toContain('## Maybeboard\n1 Smothering Tithe &')
    expect(content).toContain('## Ramp Package\n1 Llanowar Elves &')
  })

  test('imports a wanted list with name-only and printed entries', async () => {
    const csv = ['Mox Ruby,,', 'Lightning Bolt,lea,161'].join('\n')

    const { entries, failures } = prepareEntries(
      csv,
      'name=1,set=2,collector-number=3',
      'wanted',
      false,
    )
    expect(failures).toEqual([])

    const result = await writeCsvImport({
      listType: 'wanted',
      name: 'To Buy',
      entries,
      targetDir: tmpDir,
      overwrite: false,
    })
    if ('error' in result) throw new Error(result.error)

    const content = await fs.readFile(result.filePath, 'utf-8')
    expect(content).toBe(
      ['# To Buy', '', '## Main', '- Mox Ruby &1', '- Lightning Bolt (LEA:161) &2', ''].join('\n'),
    )
  })

  test('refuses to overwrite an existing file unless overwrite is set', async () => {
    const plan = {
      listType: 'wanted' as const,
      name: 'Dupes',
      entries: [{ name: 'Sol Ring', quantity: 1, section: 'Main' }],
      targetDir: tmpDir,
      overwrite: false,
    }
    const first = await writeCsvImport(plan)
    if ('error' in first) throw new Error(first.error)

    const second = await writeCsvImport(plan)
    expect(second).toEqual({
      error: `File already exists: ${first.filePath}. Re-run with --overwrite to replace it.`,
    })

    const third = await writeCsvImport({ ...plan, overwrite: true })
    if ('error' in third) throw new Error(third.error)
    expect(third.filePath).toBe(first.filePath)
  })

  test('formatScriptingCommand reproduces the wizard answers', () => {
    const mapping = parseColumnsSpec(
      'name=1,set=2,collector-number=3,quantity=4',
      'collection',
    ) as ColumnMapping
    expect(
      formatScriptingCommand('My Cards.csv', 'collection', 'Red Binder', undefined, mapping, true),
    ).toBe(
      "ritual import-csv 'My Cards.csv' --type collection --name 'Red Binder' --columns name=1,set=2,collector-number=3,quantity=4",
    )
    expect(formatScriptingCommand('deck.csv', 'deck', 'Burn', 'modern', mapping, false)).toBe(
      'ritual import-csv deck.csv --type deck --name Burn --format modern --columns name=1,set=2,collector-number=3,quantity=4 --no-header',
    )
  })
})
