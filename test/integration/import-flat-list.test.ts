import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { saveFlatList } from '../../src/importers/save-list'
import { importFromTextFile } from '../../src/importers/text-file'
import { ExitCode } from '../../src/util/errors'
import type { ConflictResolution } from '../../src/importers/save-list'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'
import { bindWorkspace, writeWantedFile, type BoundWorkspace } from '../helpers/workspace'

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
        '1 Sol Ring (C19:221) [proxy]',
        '',
        '## Staples',
        '1 Lightning Bolt (LEA:161)',
        '1 Shock (JMP:372) [ja]',
        '',
      ].join('\n'),
    )

    const deckData = await importFromTextFile(source)
    await saveFlatList(deckData, 'collection')

    const content = await fs.readFile(path.join(tmpDir, 'collections', 'Trade Binder.md'), 'utf-8')
    expect(content).toBe(
      [
        '# Trade Binder',
        '',
        '## Main',
        '- Sol Ring (C19:221) [foil] {from trade} &1',
        '- Sol Ring (C19:221) [foil] {from trade} &2',
        '- Sol Ring (C19:221) [proxy] &3',
        '',
        '## Staples',
        '- Lightning Bolt (LEA:161) &4',
        '- Shock (JMP:372) [ja] &5',
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
    await saveFlatList(deckData, 'wanted')

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
    await expect(saveFlatList(deckData, 'collection')).rejects.toThrow(/no printing.*Arcane Signet/)
    // Nothing should have been written.
    expect(await Bun.file(path.join(tmpDir, 'collections', 'binder.md')).exists()).toBeFalse()
  })

  test('conflict with prompts disabled throws instead of prompting', async () => {
    const wantsPath = await writeWantedFile(tmpDir, 'wants', {
      entries: [{ name: 'Mox Ruby', cardId: 1 }],
    })
    const original = await fs.readFile(wantsPath, 'utf-8')

    const source = await writeSource('wants.txt', '1 Black Lotus\n')
    const deckData = await importFromTextFile(source)

    // A conflict is the caller's to fix (pass overwrite), so it must carry the
    // usage classification the CLI turns into exit 2 — not a bare runtime error.
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(saveFlatList(deckData, 'wanted')).rejects.toMatchObject({
      message: expect.stringContaining('Import conflict'),
      code: 'usage_error',
      exitCode: ExitCode.UsageError,
    })

    // The pre-existing list must be untouched by the failed import.
    const content = await fs.readFile(wantsPath, 'utf-8')
    expect(content).toBe(original)
  })

  test('a name that only folds onto an existing list is a conflict, not a twin', async () => {
    // `trade binder` beside `Trade Binder.md` would leave two lists every
    // name-resolving command reports as ambiguous — the refusal `new` gives.
    const existingPath = await writeWantedFile(tmpDir, 'Trade Binder', {
      entries: [{ name: 'Mox Ruby', cardId: 1 }],
    })
    const source = await writeSource('wants.txt', '---\nname: trade binder\n---\n1 Black Lotus\n')
    const deckData = await importFromTextFile(source)

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(saveFlatList(deckData, 'wanted')).rejects.toThrow(
      "Import conflict for 'Trade Binder.md'",
    )

    // With overwrite, the existing file is replaced rather than a twin written.
    const outcome = await saveFlatList(deckData, 'wanted', { forceOverwrite: true })
    expect(outcome).toMatchObject({
      status: 'saved',
      filePath: existingPath,
      action: 'overwritten',
    })
    const listFiles = (await fs.readdir(path.join(tmpDir, 'wanted'))).filter((f) =>
      f.endsWith('.md'),
    )
    expect(listFiles).toEqual(['Trade Binder.md'])
    const written = await fs.readFile(existingPath, 'utf-8')
    // The existing file's own name survives; the import's spelling does not rename it.
    expect(written).toContain('# Trade Binder')
    expect(written).toContain('- Black Lotus &1')
  })

  test('an overwrite lands on the file the notice named, never a folded twin', async () => {
    // `Deck: Best` files as `Deck Best.md`; the writer is handed that settled
    // path rather than re-deriving one from the import's name.
    const existingPath = await writeWantedFile(tmpDir, 'Deck Best', {
      entries: [{ name: 'Mox Ruby', cardId: 1 }],
    })
    const source = await writeSource('best.txt', '---\nname: "Deck: Best"\n---\n1 Black Lotus\n')
    const deckData = await importFromTextFile(source)

    const outcome = await saveFlatList(deckData, 'wanted', { forceOverwrite: true })

    expect(outcome).toMatchObject({ status: 'saved', filePath: existingPath, name: 'Deck: Best' })
    const listFiles = (await fs.readdir(path.join(tmpDir, 'wanted'))).filter((f) =>
      f.endsWith('.md'),
    )
    expect(listFiles).toEqual(['Deck Best.md'])
    expect(await fs.readFile(existingPath, 'utf-8')).toContain('- Black Lotus &1')
  })

  test("an overwrite retires the replaced lines' ids: art filed under them is dropped", async () => {
    // The new lines are numbered from 1 again, so custom art left under the old
    // `&1` would silently reappear on whichever card took the number.
    const existingPath = await writeWantedFile(tmpDir, 'wants', {
      entries: [{ name: 'Mox Ruby', cardId: 1 }],
    })
    const sidecarPath = existingPath.replace(/\.md$/, '.art.json')
    await fs.writeFile(
      sidecarPath,
      JSON.stringify({ '1': { url: 'https://example.test/mox.png' } }),
    )
    const source = await writeSource('wants.txt', '1 Black Lotus\n')
    const deckData = await importFromTextFile(source)

    await saveFlatList(deckData, 'wanted', { forceOverwrite: true })

    expect(await fs.readFile(existingPath, 'utf-8')).toContain('- Black Lotus &1')
    const sidecar = Bun.file(sidecarPath)
    const art = (await sidecar.exists()) ? await sidecar.text() : '{}'
    expect(art).not.toContain('mox.png')
  })

  test('a list write the shared writer refuses is a usage error, not a crash', async () => {
    // A `.changes.md` sidecar is never a list, so the conflict scan cannot see
    // it — but a list named after it would land on the same path, which the
    // writer refuses. That refusal carries the usage classification (exit 2).
    await fs.mkdir(path.join(tmpDir, 'wanted'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'wanted', 'wants.changes.md'), '# log\n')
    const source = await writeSource('wants.txt', '---\nname: wants.changes\n---\n1 Black Lotus\n')
    const deckData = await importFromTextFile(source)

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(saveFlatList(deckData, 'wanted')).rejects.toMatchObject({
      message: expect.stringContaining('File already exists'),
      code: 'usage_error',
      exitCode: ExitCode.UsageError,
    })
  })

  test.each<[string, ConflictResolution, string | RegExp]>([
    ['rename lands beside the existing list', { action: 'rename', newName: 'other' }, 'other.md'],
    ['a typed .md is not doubled', { action: 'rename', newName: 'other.md' }, 'other.md'],
    [
      // The naming rule strips the separators, so `../x` files as `x.md` inside
      // the list directory — the path is asserted by its directory below.
      'a rename is confined to the list directory',
      { action: 'rename', newName: '../x' },
      'x.md',
    ],
    [
      // Falsifiable only on Linux: on Windows `..` sanitizes differently, and
      // the refusal half of the naming rule is pinned in the list-file-name unit tests.
      'a rename with nothing usable is refused',
      { action: 'rename', newName: '..' },
      /no characters usable/,
    ],
    [
      'a rename onto another list is a conflict',
      { action: 'rename', newName: 'wants' },
      /Import conflict for 'wants.md'/,
    ],
  ])('%s', async (_label, resolution, expected) => {
    await writeWantedFile(tmpDir, 'binder', { entries: [{ name: 'Mox Ruby', cardId: 1 }] })
    await writeWantedFile(tmpDir, 'wants', { entries: [{ name: 'Mox Ruby', cardId: 1 }] })
    const source = await writeSource('binder.txt', '1 Black Lotus\n')
    const deckData = await importFromTextFile(source)
    const resolveConflict = async (): Promise<ConflictResolution> => resolution

    if (typeof expected === 'string') {
      const outcome = await saveFlatList(deckData, 'wanted', { resolveConflict })
      expect(outcome).toMatchObject({ status: 'saved', action: 'renamed' })
      if (outcome.status !== 'saved') throw new Error('unreachable')
      expect(path.dirname(outcome.filePath)).toBe(path.join(tmpDir, 'wanted'))
      expect(path.basename(outcome.filePath)).toBe(expected)
      expect(await Bun.file(outcome.filePath).exists()).toBeTrue()
    } else {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
      await expect(saveFlatList(deckData, 'wanted', { resolveConflict })).rejects.toMatchObject({
        message: expect.stringMatching(expected),
        exitCode: ExitCode.UsageError,
      })
    }
  })

  test('overwrite flag replaces an existing list', async () => {
    const wantsPath = await writeWantedFile(tmpDir, 'wants', {
      entries: [{ name: 'Mox Ruby', cardId: 1 }],
    })

    const source = await writeSource('wants.txt', '1 Black Lotus\n')
    const deckData = await importFromTextFile(source)
    await saveFlatList(deckData, 'wanted', { forceOverwrite: true })

    const content = await fs.readFile(wantsPath, 'utf-8')
    expect(content).toBe('# wants\n\n## Main\n- Black Lotus &1\n')
  })

  test('dry-run logs the target path without writing anything', async () => {
    const source = await writeSource('binder.txt', '1 Sol Ring (c19:221)\n')
    const deckData = await importFromTextFile(source)

    await saveFlatList(deckData, 'collection', { dryRun: true })

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
