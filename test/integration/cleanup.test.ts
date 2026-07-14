import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cleanupAllLists, type CleanupResult } from '../../src/commands/cleanup'
import { parseDeckFrontMatter } from '../../src/deck-file'
import { hashPath } from '../../src/content-hash'
import { runCli } from './helpers/cli'
import {
  bindWorkspace,
  withWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from './helpers/workspace'

describe('cleanup (Integration)', () => {
  let workspace: BoundWorkspace

  beforeEach(async () => {
    workspace = await bindWorkspace({ init: true })
  })

  afterEach(async () => {
    await workspace.dispose()
  })

  const dir = (): string => workspace.dir

  function resultFor(results: CleanupResult[], fileName: string): CleanupResult {
    const match = results.find((r) => path.basename(r.filePath) === fileName)
    if (!match) throw new Error(`no cleanup result for ${fileName}`)
    return match
  }

  test('rewrites a non-canonical collection in canonical form', async () => {
    // Hand-written: no H1, lowercase set code, explicit default finish/condition.
    const filePath = path.join(dir(), 'collections', 'Binder.md')
    await fs.writeFile(filePath, '- Sol Ring (ltc:284) [nonfoil] [NM] &1\n')

    const results = await cleanupAllLists()

    expect(resultFor(results, 'Binder.md')).toMatchObject({ rewritten: true, warnings: [] })
    const content = await fs.readFile(filePath, 'utf-8')
    // Title from the file name, uppercase set code, default finish/condition omitted.
    expect(content).toBe('# Binder\n\n## Main\n- Sol Ring (LTC:284) &1\n')
    // The hash sidecar is written alongside the rewrite.
    expect(await Bun.file(hashPath(filePath)).exists()).toBeTrue()
  })

  test('renames a deck file to its front-matter name, moving sidecars', async () => {
    const oldPath = await writeDeckFile(dir(), 'winota-stax', {
      frontMatter: { name: 'Winota Stax', format: 'commander' },
      cards: [{ quantity: 1, name: 'Winota, Joiner of Forces', cardId: 1 }],
    })
    const changesPath = oldPath.replace(/\.md$/, '.changes.md')
    const primerPath = oldPath.replace(/\.md$/, '.primer.md')
    await fs.writeFile(changesPath, '# Changelog\n')
    await fs.writeFile(primerPath, 'How to pilot.\n')

    const results = await cleanupAllLists()

    expect(resultFor(results, 'winota-stax.md')).toMatchObject({
      renamedTo: 'Winota Stax.md',
      rewritten: false,
      warnings: [],
    })
    const newPath = path.join(dir(), 'decks', 'Winota Stax.md')
    expect(await Bun.file(newPath).exists()).toBeTrue()
    expect(await Bun.file(oldPath).exists()).toBeFalse()
    expect(await Bun.file(newPath.replace(/\.md$/, '.changes.md')).exists()).toBeTrue()
    expect(await Bun.file(newPath.replace(/\.md$/, '.primer.md')).exists()).toBeTrue()
    expect(await Bun.file(changesPath).exists()).toBeFalse()
    expect(await Bun.file(primerPath).exists()).toBeFalse()
  })

  test('rewrites a non-canonical wanted list in canonical form', async () => {
    // Hand-written: no H1, no section header, lowercase set code.
    const filePath = path.join(dir(), 'wanted', 'Wants.md')
    await fs.writeFile(filePath, '- Sol Ring (ltc:284) &1\n- Mox Emerald &2\n')

    const results = await cleanupAllLists()

    expect(resultFor(results, 'Wants.md')).toMatchObject({ rewritten: true, warnings: [] })
    expect(await fs.readFile(filePath, 'utf-8')).toBe(
      '# Wants\n\n## Main\n- Sol Ring (LTC:284) &1\n- Mox Emerald &2\n',
    )
  })

  test('renames a collection to its H1 title', async () => {
    await writeCollectionFile(dir(), 'trade-binder', {
      title: 'Trade Binder',
      entries: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 1 }],
    })

    const results = await cleanupAllLists()

    expect(resultFor(results, 'trade-binder.md')).toMatchObject({
      renamedTo: 'Trade Binder.md',
    })
    expect(await Bun.file(path.join(dir(), 'collections', 'Trade Binder.md')).exists()).toBeTrue()
  })

  test('stamps a format inferred from a Commander section without prompting', async () => {
    const filePath = path.join(dir(), 'decks', 'Kenrith.md')
    await fs.writeFile(
      filePath,
      '## Commander\n1 Kenrith, the Returned King &1\n\n## Main\n1 Sol Ring &2\n',
    )

    let prompted = false
    const results = await cleanupAllLists({
      chooseFormat: async () => {
        prompted = true
        return null
      },
    })

    expect(prompted).toBeFalse()
    expect(resultFor(results, 'Kenrith.md')).toMatchObject({ rewritten: true })
    expect((await parseDeckFrontMatter(filePath)).format).toBe('commander')
  })

  test('asks for a format when none can be resolved, and persists the answer', async () => {
    const filePath = path.join(dir(), 'decks', 'Jank.md')
    await fs.writeFile(filePath, '---\nname: Jank\n---\n\n## Main\n1 Sol Ring &1\n')

    const asked: string[] = []
    const results = await cleanupAllLists({
      chooseFormat: async (deckName) => {
        asked.push(deckName)
        return 'modern'
      },
    })

    expect(asked).toEqual(['Jank'])
    expect(resultFor(results, 'Jank.md')).toMatchObject({ formatSet: 'modern', rewritten: true })
    expect((await parseDeckFrontMatter(filePath)).format).toBe('modern')
  })

  test('reports a deck left without a format when no answer is given', async () => {
    const filePath = path.join(dir(), 'decks', 'Jank.md')
    await fs.writeFile(filePath, '---\nname: Jank\n---\n\n## Main\n1 Sol Ring &1\n')

    const results = await cleanupAllLists({ chooseFormat: async () => null })

    expect(resultFor(results, 'Jank.md')).toMatchObject({ missingFormat: true })
    expect((await parseDeckFrontMatter(filePath)).format).toBeUndefined()
  })

  test('dry-run reports everything but writes nothing', async () => {
    const deckPath = path.join(dir(), 'decks', 'winota-stax.md')
    const deckContent = '---\nname: Winota Stax\n---\n\n## Main\n1 Sol Ring &1\n'
    await fs.writeFile(deckPath, deckContent)

    const results = await cleanupAllLists({ dryRun: true })

    expect(resultFor(results, 'winota-stax.md')).toMatchObject({
      renamedTo: 'Winota Stax.md',
      missingFormat: true,
    })
    expect(await Bun.file(deckPath).exists()).toBeTrue()
    expect(await Bun.file(path.join(dir(), 'decks', 'Winota Stax.md')).exists()).toBeFalse()
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(deckContent)
  })

  test('refuses a rename that would overwrite another list', async () => {
    await writeDeckFile(dir(), 'winota-stax', {
      frontMatter: { name: 'Winota Stax', format: 'commander' },
      cards: [{ quantity: 1, name: 'Winota, Joiner of Forces', cardId: 1 }],
    })
    const occupiedPath = await writeDeckFile(dir(), 'Winota Stax', {
      frontMatter: { name: 'Winota Stax', format: 'commander' },
      cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
    })
    const occupiedContent = await fs.readFile(occupiedPath, 'utf-8')

    const results = await cleanupAllLists()

    const result = resultFor(results, 'winota-stax.md')
    expect(result.renamedTo).toBeUndefined()
    expect(result.warnings.join('\n')).toContain('another list already has that file')
    // Both files survive, the occupied one untouched.
    const keptPath = path.join(dir(), 'decks', 'winota-stax.md')
    expect(await Bun.file(keptPath).exists()).toBeTrue()
    expect(await fs.readFile(keptPath, 'utf-8')).toContain('Winota, Joiner of Forces')
    expect(await fs.readFile(occupiedPath, 'utf-8')).toBe(occupiedContent)
  })

  test('refuses a rename onto a distinct list whose name differs only in case', async () => {
    // On a case-sensitive file system these are two different files; the rename
    // must be treated as a conflict, not as a case-only rename of the same file.
    const lowerPath = await writeDeckFile(dir(), 'jank', {
      frontMatter: { name: 'Jank', format: 'modern' },
      cards: [{ quantity: 1, name: 'Lightning Bolt', cardId: 1 }],
    })
    const occupiedPath = await writeDeckFile(dir(), 'Jank', {
      frontMatter: { name: 'Jank', format: 'modern' },
      cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
    })
    const occupiedContent = await fs.readFile(occupiedPath, 'utf-8')

    const results = await cleanupAllLists()

    const result = resultFor(results, 'jank.md')
    expect(result.renamedTo).toBeUndefined()
    expect(result.warnings.join('\n')).toContain('another list already has that file')
    expect(await fs.readFile(lowerPath, 'utf-8')).toContain('Lightning Bolt')
    expect(await fs.readFile(occupiedPath, 'utf-8')).toBe(occupiedContent)
  })

  test('warns instead of renaming when the list name has no usable characters', async () => {
    const filePath = path.join(dir(), 'collections', 'Weird.md')
    await fs.writeFile(filePath, '# ???\n\n## Main\n- Sol Ring (LTC:284) &1\n')

    const results = await cleanupAllLists()

    const result = resultFor(results, 'Weird.md')
    expect(result.renamedTo).toBeUndefined()
    expect(result.warnings.join('\n')).toContain('no characters usable in a file name')
    expect(await Bun.file(filePath).exists()).toBeTrue()
  })

  test('does not rewrite a deck whose parse skipped lines', async () => {
    const filePath = path.join(dir(), 'decks', 'Scraps.md')
    const content = '## Main\n1 Sol Ring &1\nsideboard ideas: maybe a counterspell\n'
    await fs.writeFile(filePath, content)

    const results = await cleanupAllLists()

    const result = resultFor(results, 'Scraps.md')
    expect(result.rewritten).toBeFalse()
    expect(result.warnings.join('\n')).toContain(
      'Skipped malformed line: sideboard ideas: maybe a counterspell',
    )
    expect(await fs.readFile(filePath, 'utf-8')).toBe(content)
  })

  test('does not rewrite a file whose parse skipped lines', async () => {
    // A name-only collection line is skipped by the parser (collections require a
    // printing); rewriting the file would silently drop it.
    const filePath = path.join(dir(), 'collections', 'Binder.md')
    const content = '# Binder\n\n## Main\n- Sol Ring (LTC:284) &1\n- Mox Emerald\n'
    await fs.writeFile(filePath, content)

    const results = await cleanupAllLists()

    const result = resultFor(results, 'Binder.md')
    expect(result.rewritten).toBeFalse()
    expect(result.warnings.join('\n')).toContain('not rewritten')
    expect(await fs.readFile(filePath, 'utf-8')).toBe(content)
  })
})

describe('cleanup CLI (Integration)', () => {
  test('cleans a workspace and reports what changed', async () => {
    await withWorkspace(async (dir) => {
      await writeWantedFile(dir, 'binder', {
        title: 'Binder',
        entries: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 1 }],
      })

      const dryRun = await runCli(['cleanup', '--dry-run'], dir)
      expect(dryRun.exitCode).toBe(0)
      expect(dryRun.stdout).toContain("renamed to 'Binder.md'")
      expect(await Bun.file(path.join(dir, 'wanted', 'binder.md')).exists()).toBeTrue()

      const result = await runCli(['cleanup'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("renamed to 'Binder.md'")
      expect(await Bun.file(path.join(dir, 'wanted', 'Binder.md')).exists()).toBeTrue()
      expect(await Bun.file(path.join(dir, 'wanted', 'binder.md')).exists()).toBeFalse()

      const clean = await runCli(['cleanup'], dir)
      expect(clean.exitCode).toBe(0)
      expect(clean.stdout).toContain('already clean')
    })
  })
})
