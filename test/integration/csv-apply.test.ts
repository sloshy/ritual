import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { applyCsvImport } from '../../src/importers/csv-apply'
import {
  convertCsvRows,
  parseColumnsSpec,
  parseCsv,
  type CsvConversionResult,
} from '../../src/importers/csv'
import type { ListType } from '../../src/list-type'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  type BoundWorkspace,
} from './helpers/workspace'

function prepareEntries(csv: string, spec: string, listType: ListType): CsvConversionResult {
  const parsed = parseCsv(csv)
  if ('error' in parsed) throw new Error(parsed.error)
  const mapping = parseColumnsSpec(spec, listType)
  if (typeof mapping === 'string') throw new Error(`Bad columns spec in test: ${mapping}`)
  return convertCsvRows(parsed.rows, mapping, listType)
}

describe('applyCsvImport', () => {
  let ws: BoundWorkspace
  let tmpDir: string

  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    tmpDir = ws.dir
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('append adds copies to a collection, continuing card IDs and writing a changelog', async () => {
    const filePath = await writeCollectionFile(tmpDir, 'Binder', {
      entries: [
        {
          name: 'Sol Ring',
          set: 'c19',
          collectorNumber: '221',
          condition: 'NM',
          note: 'keeper',
          cardId: 1,
        },
      ],
    })

    const { entries } = prepareEntries(
      ['Lightning Bolt,lea,161,F,NM,2'].join('\n'),
      'name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6',
      'collection',
    )
    const result = await applyCsvImport(
      { listType: 'collection', name: 'Binder', mode: 'append' },
      entries,
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.cardCount).toBe(2)
    expect(result.changelogPath).toBe(path.join(tmpDir, 'collections', 'Binder.changes.md'))

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe(
      [
        '# Binder',
        '',
        '## Main',
        '- Sol Ring (C19:221) {keeper} &1',
        '- Lightning Bolt (LEA:161) [foil] &2',
        '- Lightning Bolt (LEA:161) [foil] &3',
        '',
      ].join('\n'),
    )

    const changelog = await fs.readFile(result.changelogPath!, 'utf-8')
    expect(changelog).toContain('Added "Lightning Bolt" (LEA:161) [foil] &2')
    expect(changelog).toContain('Added "Lightning Bolt" (LEA:161) [foil] &3')
  })

  test('append merges deck quantities for identical printings and keeps frontmatter', async () => {
    const filePath = await writeDeckFile(tmpDir, 'Burn', {
      frontMatter: { name: 'Burn', format: 'modern' },
      cards: [{ quantity: 2, name: 'Lightning Bolt', cardId: 1 }],
    })

    const { entries } = prepareEntries(
      ['2,Lightning Bolt,', '1,Goblin Guide,', '2,Pyroblast,side'].join('\n'),
      'quantity=1,name=2,section=3',
      'deck',
    )
    const result = await applyCsvImport({ listType: 'deck', name: 'Burn', mode: 'append' }, entries)
    if ('error' in result) throw new Error(result.error)
    expect(result.cardCount).toBe(5)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('format: modern')
    expect(content).toContain('4 Lightning Bolt &1')
    expect(content).toContain('1 Goblin Guide &2')
    expect(content).toContain('## Sideboard\n2 Pyroblast &3')

    const changelog = await fs.readFile(path.join(tmpDir, 'decks', 'Burn.changes.md'), 'utf-8')
    expect(changelog).toContain('Added "Lightning Bolt" &1')
    expect(changelog).toContain('Added "Pyroblast" to Sideboard &3')
  })

  test('dry-run create reports the target without writing the file', async () => {
    const { entries } = prepareEntries('Lightning Bolt,2', 'name=1,quantity=2', 'wanted')
    const result = await applyCsvImport(
      { listType: 'wanted', name: 'To Buy', mode: 'create' },
      entries,
      { dryRun: true },
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.cardCount).toBe(2)
    expect(result.mode).toBe('create')
    expect(result.filePath).toBe(path.join(tmpDir, 'wanted', 'To Buy.md'))
    expect(await Bun.file(result.filePath).exists()).toBeFalse()
  })

  test('dry-run append leaves the list and its changelog untouched', async () => {
    const filePath = await writeCollectionFile(tmpDir, 'Binder', {
      entries: [{ name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
    })
    const before = await fs.readFile(filePath, 'utf-8')

    const { entries } = prepareEntries(
      'Lightning Bolt,lea,161,2',
      'name=1,set=2,collector-number=3,quantity=4',
      'collection',
    )
    const result = await applyCsvImport(
      { listType: 'collection', name: 'Binder', mode: 'append' },
      entries,
      { dryRun: true },
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.cardCount).toBe(2)
    expect(result.mode).toBe('append')
    expect(result.changelogPath).toBeUndefined()

    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
    const changelogPath = path.join(tmpDir, 'collections', 'Binder.changes.md')
    expect(await Bun.file(changelogPath).exists()).toBeFalse()
  })

  test('dry-run create still reports an existing target as an error', async () => {
    await writeCollectionFile(tmpDir, 'Binder', {
      entries: [{ name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
    })

    const { entries } = prepareEntries(
      'Lightning Bolt,lea,161',
      'name=1,set=2,collector-number=3',
      'collection',
    )
    const result = await applyCsvImport(
      { listType: 'collection', name: 'Binder', mode: 'create' },
      entries,
      { dryRun: true },
    )
    expect('error' in result && result.error).toContain('File already exists')
  })
})
