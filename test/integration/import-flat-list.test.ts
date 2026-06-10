import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { saveFlatList } from '../../src/commands/import'
import { importFromTextFile } from '../../src/importers/text-file'
import { setBaseDir } from '../../src/base-dir'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'

describe('import text file into flat lists (Integration)', () => {
  const originalCwd = process.cwd()
  let tmpDir: string
  let logger: MemoryLogger

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-import-flat-'))
    setBaseDir(tmpDir)
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
    resetLogger()
    await fs.rm(tmpDir, { recursive: true, force: true })
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
        '- Sol Ring (C19:221) [foil] [NM] {from trade} &1',
        '- Sol Ring (C19:221) [foil] [NM] {from trade} &2',
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
    const wantedDir = path.join(tmpDir, 'wanted')
    await fs.mkdir(wantedDir, { recursive: true })
    await fs.writeFile(path.join(wantedDir, 'wants.md'), '# wants\n\n## Main\n- Mox Ruby &1\n')

    const source = await writeSource('wants.txt', '1 Black Lotus\n')
    const deckData = await importFromTextFile(source)

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(saveFlatList(deckData, 'wanted', { nonInteractive: true })).rejects.toThrow(
      'Import conflict',
    )

    // The pre-existing list must be untouched by the failed import.
    const content = await fs.readFile(path.join(wantedDir, 'wants.md'), 'utf-8')
    expect(content).toBe('# wants\n\n## Main\n- Mox Ruby &1\n')
  })

  test('overwrite flag replaces an existing list', async () => {
    const wantedDir = path.join(tmpDir, 'wanted')
    await fs.mkdir(wantedDir, { recursive: true })
    await fs.writeFile(path.join(wantedDir, 'wants.md'), '# wants\n\n## Main\n- Mox Ruby &1\n')

    const source = await writeSource('wants.txt', '1 Black Lotus\n')
    const deckData = await importFromTextFile(source)
    await saveFlatList(deckData, 'wanted', { nonInteractive: true, forceOverwrite: true })

    const content = await fs.readFile(path.join(wantedDir, 'wants.md'), 'utf-8')
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
