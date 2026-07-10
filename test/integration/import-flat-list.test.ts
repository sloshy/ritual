import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { saveFlatList } from '../../src/commands/import'
import { importFromTextFile } from '../../src/importers/text-file'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'
import { bindWorkspace, writeWantedFile, type BoundWorkspace } from './helpers/workspace'

describe('import text file into flat lists (Integration)', () => {
  let ws: BoundWorkspace
  let tmpDir: string
  let logger: MemoryLogger

  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    tmpDir = ws.dir
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(async () => {
    resetLogger()
    await ws.dispose()
  })

  async function writeSource(fileName: string, content: string): Promise<string> {
    const filePath = path.join(tmpDir, fileName)
    await fs.writeFile(filePath, content)
    return filePath
  }

  test('imports a text file as a collection with per-copy lines and IDs', async () => {
    // Set codes are deliberately mixed-case to pin the lowercase-in-memory /
    // uppercase-on-write normalization.
    const source = await writeSource(
      'binder.txt',
      [
        '---',
        'name: "Trade Binder"',
        '---',
        '',
        '## Main',
        '2 Sol Ring (c19:221) [foil] [NM] {from trade}',
        '',
        '## Staples',
        '1 Lightning Bolt (LEA:161)',
        '',
      ].join('\n'),
    )

    const deckData = await importFromTextFile(source)
    await saveFlatList(deckData, 'collection', { nonInteractive: true })

    const content = await fs.readFile(path.join(tmpDir, 'collections', 'Trade Binder.md'), 'utf-8')
    expect(content).toBe(
      [
        '# Trade Binder',
        '',
        '## Main',
        '- Sol Ring (C19:221) [foil] {from trade} &1',
        '- Sol Ring (C19:221) [foil] {from trade} &2',
        '',
        '## Staples',
        '- Lightning Bolt (LEA:161) &3',
        '',
      ].join('\n'),
    )
  })

  test('imports a text file as a wanted list, keeping name-only entries and notes', async () => {
    const source = await writeSource(
      'wants.txt',
      ['1 Mox Ruby', '3 Lightning Bolt (lea:161) [foil] {priority}', ''].join('\n'),
    )

    const deckData = await importFromTextFile(source)
    await saveFlatList(deckData, 'wanted', { nonInteractive: true })

    const content = await fs.readFile(path.join(tmpDir, 'wanted', 'wants.md'), 'utf-8')
    expect(content).toBe(
      [
        '# wants',
        '',
        '## Main',
        '- Mox Ruby &1',
        '- Lightning Bolt (LEA:161) [foil] {priority} &2',
        '- Lightning Bolt (LEA:161) [foil] {priority} &3',
        '- Lightning Bolt (LEA:161) [foil] {priority} &4',
        '',
      ].join('\n'),
    )
  })

  test('rejects a collection import when a card line has no printing', async () => {
    const source = await writeSource('binder.txt', '1 Arcane Signet\n')
    const deckData = await importFromTextFile(source)

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(saveFlatList(deckData, 'collection', { nonInteractive: true })).rejects.toThrow(
      /no printing.*Arcane Signet/,
    )
    // Nothing should have been written.
    expect(await Bun.file(path.join(tmpDir, 'collections', 'binder.md')).exists()).toBeFalse()
  })

  test('non-interactive conflict throws instead of prompting', async () => {
    const wantsPath = await writeWantedFile(tmpDir, 'wants', {
      entries: [{ name: 'Mox Ruby', cardId: 1 }],
    })
    const original = await fs.readFile(wantsPath, 'utf-8')

    const source = await writeSource('wants.txt', '1 Black Lotus\n')
    const deckData = await importFromTextFile(source)

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(saveFlatList(deckData, 'wanted', { nonInteractive: true })).rejects.toThrow(
      'Import conflict',
    )

    // The pre-existing list must be untouched by the failed import.
    const content = await fs.readFile(wantsPath, 'utf-8')
    expect(content).toBe(original)
  })

  test('overwrite flag replaces an existing list', async () => {
    const wantsPath = await writeWantedFile(tmpDir, 'wants', {
      entries: [{ name: 'Mox Ruby', cardId: 1 }],
    })

    const source = await writeSource('wants.txt', '1 Black Lotus\n')
    const deckData = await importFromTextFile(source)
    await saveFlatList(deckData, 'wanted', { nonInteractive: true, forceOverwrite: true })

    const content = await fs.readFile(wantsPath, 'utf-8')
    expect(content).toBe('# wants\n\n## Main\n- Black Lotus &1\n')
  })

  test('dry-run logs the target path without writing anything', async () => {
    const source = await writeSource('binder.txt', '1 Sol Ring (c19:221)\n')
    const deckData = await importFromTextFile(source)

    await saveFlatList(deckData, 'collection', { nonInteractive: true, dryRun: true })

    expect(await Bun.file(path.join(tmpDir, 'collections', 'binder.md')).exists()).toBeFalse()
    expect(
      logger.entries.some(
        (entry) =>
          entry.level === 'info' &&
          typeof entry.args[0] === 'string' &&
          entry.args[0].includes('[dry-run] Would save collection to:'),
      ),
    ).toBeTrue()
  })
})
