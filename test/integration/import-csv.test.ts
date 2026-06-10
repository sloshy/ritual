import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { formatScriptingCommand } from '../../src/commands/import-csv'
import { applyCsvImport } from '../../src/importers/csv-apply'
import {
  convertCsvRows,
  parseColumnsSpec,
  parseCsv,
  type ColumnMapping,
  type CsvConversionResult,
} from '../../src/importers/csv'
import type { ListType } from '../../src/list-type'
import { setBaseDir } from '../../src/base-dir'

function prepareEntries(
  csv: string,
  spec: string,
  listType: ListType,
  hasHeader = true,
): CsvConversionResult {
  const parsed = parseCsv(csv)
  if ('error' in parsed) throw new Error(parsed.error)
  const mapping = parseColumnsSpec(spec, listType)
  if (typeof mapping === 'string') throw new Error(`Bad columns spec in test: ${mapping}`)
  return convertCsvRows(hasHeader ? parsed.rows.slice(1) : parsed.rows, mapping, listType)
}

describe('import-csv', () => {
  const originalCwd = process.cwd()
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-csv-test-'))
    setBaseDir(tmpDir)
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
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

    const result = await applyCsvImport(
      { listType: 'collection', name: 'Red Binder', mode: 'create' },
      entries,
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.cardCount).toBe(3)
    expect(result.filePath).toBe(path.join(tmpDir, 'collections', 'Red Binder.md'))

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

    const result = await applyCsvImport(
      { listType: 'deck', name: 'CSV Deck', mode: 'create', format: 'commander' },
      entries,
    )
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

    const result = await applyCsvImport(
      { listType: 'wanted', name: 'To Buy', mode: 'create' },
      entries,
    )
    if ('error' in result) throw new Error(result.error)

    const content = await fs.readFile(result.filePath, 'utf-8')
    expect(content).toBe(
      ['# To Buy', '', '## Main', '- Mox Ruby &1', '- Lightning Bolt (LEA:161) &2', ''].join('\n'),
    )
  })

  test('create mode refuses an existing file; overwrite replaces it', async () => {
    const entries = [{ name: 'Sol Ring', quantity: 1, section: 'Main' }]
    const first = await applyCsvImport(
      { listType: 'wanted', name: 'Dupes', mode: 'create' },
      entries,
    )
    if ('error' in first) throw new Error(first.error)

    const second = await applyCsvImport(
      { listType: 'wanted', name: 'Dupes', mode: 'create' },
      entries,
    )
    expect(second).toEqual({
      error: `File already exists: ${first.filePath}. Use overwrite or append mode to change it.`,
    })

    const third = await applyCsvImport(
      { listType: 'wanted', name: 'Dupes', mode: 'overwrite' },
      entries,
    )
    if ('error' in third) throw new Error(third.error)
    expect(third.filePath).toBe(first.filePath)
  })

  test('append adds copies to a collection, continuing card IDs and writing a changelog', async () => {
    const collectionsDir = path.join(tmpDir, 'collections')
    await fs.mkdir(collectionsDir, { recursive: true })
    const filePath = path.join(collectionsDir, 'Binder.md')
    await fs.writeFile(
      filePath,
      ['# Binder', '', '## Main', '- Sol Ring (C19:221) [NM] {keeper} &1', ''].join('\n'),
    )

    const { entries } = prepareEntries(
      ['Lightning Bolt,lea,161,F,NM,2'].join('\n'),
      'name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6',
      'collection',
      false,
    )
    const result = await applyCsvImport(
      { listType: 'collection', name: 'Binder', mode: 'append' },
      entries,
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.cardCount).toBe(2)
    expect(result.changelogPath).toBe(path.join(collectionsDir, 'Binder.changes.md'))

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe(
      [
        '# Binder',
        '',
        '## Main',
        '- Sol Ring (C19:221) [NM] {keeper} &1',
        '- Lightning Bolt (LEA:161) [foil] [NM] &2',
        '- Lightning Bolt (LEA:161) [foil] [NM] &3',
        '',
      ].join('\n'),
    )

    const changelog = await fs.readFile(result.changelogPath!, 'utf-8')
    expect(changelog).toContain('Added "Lightning Bolt" (LEA:161) [foil] &2')
    expect(changelog).toContain('Added "Lightning Bolt" (LEA:161) [foil] &3')
  })

  test('append merges deck quantities for identical printings and keeps frontmatter', async () => {
    const decksDir = path.join(tmpDir, 'decks')
    await fs.mkdir(decksDir, { recursive: true })
    const filePath = path.join(decksDir, 'Burn.md')
    await fs.writeFile(
      filePath,
      ['---', 'name: Burn', 'format: modern', '---', '', '## Main', '2 Lightning Bolt &1', ''].join(
        '\n',
      ),
    )

    const { entries } = prepareEntries(
      ['2,Lightning Bolt,', '1,Goblin Guide,', '2,Pyroblast,side'].join('\n'),
      'quantity=1,name=2,section=3',
      'deck',
      false,
    )
    const result = await applyCsvImport({ listType: 'deck', name: 'Burn', mode: 'append' }, entries)
    if ('error' in result) throw new Error(result.error)
    expect(result.cardCount).toBe(5)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('format: modern')
    expect(content).toContain('4 Lightning Bolt &1')
    expect(content).toContain('1 Goblin Guide &2')
    expect(content).toContain('## Sideboard\n2 Pyroblast &3')

    const changelog = await fs.readFile(path.join(decksDir, 'Burn.changes.md'), 'utf-8')
    expect(changelog).toContain('Added "Lightning Bolt" &1')
    expect(changelog).toContain('Added "Pyroblast" to Sideboard &3')
  })

  test('append to a missing list reports a not-found error', async () => {
    const result = await applyCsvImport({ listType: 'collection', name: 'Nope', mode: 'append' }, [
      { name: 'Sol Ring', quantity: 1, section: 'Main' },
    ])
    if (!('error' in result)) throw new Error('Expected an error result')
    expect(result.error.toLowerCase()).toContain('no collections found')
  })

  test('formatScriptingCommand reproduces the wizard answers', () => {
    const mapping = parseColumnsSpec(
      'name=1,set=2,collector-number=3,quantity=4',
      'collection',
    ) as ColumnMapping
    expect(
      formatScriptingCommand(
        'My Cards.csv',
        'collection',
        'Red Binder',
        'create',
        undefined,
        mapping,
        true,
      ),
    ).toBe(
      "ritual import-csv 'My Cards.csv' --type collection --name 'Red Binder' --columns name=1,set=2,collector-number=3,quantity=4",
    )
    expect(
      formatScriptingCommand('deck.csv', 'deck', 'Burn', 'create', 'modern', mapping, false),
    ).toBe(
      'ritual import-csv deck.csv --type deck --name Burn --format modern --columns name=1,set=2,collector-number=3,quantity=4 --no-header',
    )
    expect(
      formatScriptingCommand('more.csv', 'wanted', 'To Buy', 'append', undefined, mapping, true),
    ).toBe(
      "ritual import-csv more.csv --type wanted --name 'To Buy' --append --columns name=1,set=2,collector-number=3,quantity=4",
    )
    expect(
      formatScriptingCommand('deck.csv', 'deck', 'Burn', 'overwrite', 'modern', mapping, true),
    ).toBe(
      'ritual import-csv deck.csv --type deck --name Burn --overwrite --format modern --columns name=1,set=2,collector-number=3,quantity=4',
    )
  })
})
