import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cleanupAllLists, type CleanupResult } from '../../src/commands/cleanup'
import { parseDeckFrontMatter } from '../../src/deck-file'
import type { DeckFormatSignal } from '../../src/deck-format'
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

  test('prompts for a commander deck instead of silently inferring its format', async () => {
    const filePath = path.join(dir(), 'decks', 'Kenrith.md')
    await fs.writeFile(
      filePath,
      '## Commander\n1 Kenrith, the Returned King &1\n\n## Main\n1 Sol Ring &2\n',
    )

    const signals: DeckFormatSignal[] = []
    const results = await cleanupAllLists({
      chooseFormat: async (_deckName, signal) => {
        signals.push(signal)
        return 'commander'
      },
    })

    // The real detector ran (signal boundary math is pinned by unit tests).
    expect(signals.map((s) => s.kind)).toEqual(['command-zone'])
    expect(resultFor(results, 'Kenrith.md')).toMatchObject({
      formatSet: 'commander',
      rewritten: true,
    })
    expect((await parseDeckFrontMatter(filePath)).format).toBe('commander')
  })

  test('each deck in one pass gets its own signal', async () => {
    await fs.writeFile(path.join(dir(), 'decks', 'Big.md'), '## Main\n75 Island &1\n')
    await fs.writeFile(path.join(dir(), 'decks', 'Small.md'), '## Main\n45 Island &1\n')

    const signals = new Map<string, DeckFormatSignal['kind']>()
    await cleanupAllLists({
      chooseFormat: async (deckName, signal) => {
        signals.set(deckName, signal.kind)
        return null
      },
    })

    expect(signals.get('Big')).toBe('constructed-60')
    expect(signals.get('Small')).toBe('limited')
  })

  test('asks for a format when none is declared, and persists the answer', async () => {
    const filePath = path.join(dir(), 'decks', 'Jank.md')
    await fs.writeFile(filePath, '---\nname: Jank\n---\n\n## Main\n1 Sol Ring &1\n')

    const asked: string[] = []
    const results = await cleanupAllLists({
      chooseFormat: async (deckName, signal) => {
        asked.push(deckName)
        expect(signal.kind).toBe('none')
        return 'modern'
      },
    })

    expect(asked).toEqual(['Jank'])
    expect(resultFor(results, 'Jank.md')).toMatchObject({ formatSet: 'modern', rewritten: true })
    expect((await parseDeckFrontMatter(filePath)).format).toBe('modern')
  })

  test('a declined prompt leaves the deck file untouched — no inferred format stamped', async () => {
    // Re-emitting this deck would stamp `format: commander` (section inference
    // runs on every serialize), so a declined prompt must skip the rewrite.
    const filePath = path.join(dir(), 'decks', 'Kenrith.md')
    const content = '## Commander\n1 Kenrith, the Returned King &1\n\n## Main\n1 Sol Ring &2\n'
    await fs.writeFile(filePath, content)

    const results = await cleanupAllLists({ chooseFormat: async () => null })

    expect(resultFor(results, 'Kenrith.md')).toMatchObject({
      missingFormat: true,
      rewritten: false,
    })
    expect(await fs.readFile(filePath, 'utf-8')).toBe(content)
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
    const content =
      '---\nformat: modern\n---\n\n## Main\n1 Sol Ring &1\nsideboard ideas: maybe a counterspell\n'
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

  test('--skip-formats leaves formatless decks untouched and cleans everything else', async () => {
    await withWorkspace(async (dir) => {
      const deckPath = path.join(dir, 'decks', 'Jank.md')
      const deckContent = '## Main\n1 Sol Ring &1\n'
      await fs.writeFile(deckPath, deckContent)
      await writeWantedFile(dir, 'binder', {
        title: 'Binder',
        entries: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 1 }],
      })

      const result = await runCli(['cleanup', '--skip-formats'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('format skipped')
      // The formatless deck is untouched — no inferred format stamped.
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(deckContent)
      // The rest of the workspace is still cleaned.
      expect(await Bun.file(path.join(dir, 'wanted', 'Binder.md')).exists()).toBeTrue()
    })
  })

  test('a headless real run over a formatless deck is a usage error naming --skip-formats', async () => {
    await withWorkspace(async (dir) => {
      const deckPath = path.join(dir, 'decks', 'Jank.md')
      await fs.writeFile(deckPath, '## Main\n1 Sol Ring &1\n')
      // A second dirty file that a partial pass would have renamed.
      await writeWantedFile(dir, 'binder', {
        title: 'Binder',
        entries: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 1 }],
      })

      // runCli's stdin is not a TTY, so prompts are unavailable.
      const result = await runCli(['cleanup'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--skip-formats')
      // The refusal happens before any file is touched — no partial cleanup.
      expect(await Bun.file(path.join(dir, 'wanted', 'binder.md')).exists()).toBeTrue()
      expect(await Bun.file(path.join(dir, 'wanted', 'Binder.md')).exists()).toBeFalse()
    })
  })

  test('--check exits 1 when a file would change and writes nothing', async () => {
    await withWorkspace(async (dir) => {
      // No card IDs: --check must not even trigger the global ID backfill.
      const filePath = path.join(dir, 'wanted', 'binder.md')
      const content = '# Binder\n\n- Sol Ring (ltc:284)\n'
      await fs.writeFile(filePath, content)

      const check = await runCli(['cleanup', '--check'], dir)

      expect(check.exitCode).toBe(1)
      expect(check.stdout).toContain('[check]')
      expect(await fs.readFile(filePath, 'utf-8')).toBe(content)
      expect(await Bun.file(path.join(dir, 'wanted', 'Binder.md')).exists()).toBeFalse()
    })
  })

  test('--check exits 0 on a clean workspace, even with a formatless deck', async () => {
    await withWorkspace(async (dir) => {
      await writeWantedFile(dir, 'Binder', {
        title: 'Binder',
        entries: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 1 }],
      })
      // A formatless deck needs attention, but --check only fails on files a
      // real run would change — and a real run never changes it without an answer.
      await fs.writeFile(path.join(dir, 'decks', 'Jank.md'), '## Main\n1 Sol Ring &1\n')

      const check = await runCli(['cleanup', '--check'], dir)

      expect(check.exitCode).toBe(0)
    })
  })

  test('a real run blocked by parse warnings exits 1', async () => {
    await withWorkspace(async (dir) => {
      // The malformed line is not a card line, so the CLI-wide card-ID
      // backfill leaves the file byte-identical before cleanup sees it.
      const filePath = path.join(dir, 'decks', 'Scraps.md')
      const content =
        '---\nformat: modern\n---\n\n## Main\n1 Sol Ring &1\nsideboard ideas: maybe a counterspell\n'
      await fs.writeFile(filePath, content)

      const result = await runCli(['cleanup'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('not rewritten')
      expect(await fs.readFile(filePath, 'utf-8')).toBe(content)

      // --check reports the blocked file as a failure too.
      const check = await runCli(['cleanup', '--check'], dir)
      expect(check.exitCode).toBe(1)
    })
  })

  test('--output json emits the per-file results and flattened warnings', async () => {
    await withWorkspace(async (dir) => {
      await writeWantedFile(dir, 'binder', {
        title: 'Binder',
        entries: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 1 }],
      })

      const result = await runCli(['cleanup', '--dry-run', '--output', 'json'], dir)

      expect(result.exitCode).toBe(0)
      const report = JSON.parse(result.stdout) as {
        files: CleanupResult[]
        warnings: string[]
      }
      expect(report.warnings).toEqual([])
      expect(report.files).toHaveLength(1)
      expect(report.files[0]).toMatchObject({ type: 'wanted', renamedTo: 'Binder.md' })
    })
  })
})
