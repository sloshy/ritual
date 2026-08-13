import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cleanupAllLists, cleanupList, type CleanupResult } from '../../src/commands/cleanup'
import { parseDeckFrontMatter } from '../../src/deck-file'
import type { DeckFormatSignal } from '../../src/deck-format'
import { computeHash, hashPath, writeFileWithHash } from '../../src/content-hash'
import { runCli } from './helpers/cli'
import {
  bindWorkspace,
  withWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from './helpers/workspace'

function resultFor(results: CleanupResult[], fileName: string): CleanupResult {
  const match = results.find((r) => path.basename(r.filePath) === fileName)
  if (!match) throw new Error(`no cleanup result for ${fileName}`)
  return match
}

describe('cleanup (Integration)', () => {
  let workspace: BoundWorkspace

  beforeEach(async () => {
    workspace = await bindWorkspace({ init: true })
  })

  afterEach(async () => {
    await workspace.dispose()
  })

  const dir = (): string => workspace.dir

  test('rewrites a non-canonical collection in canonical form', async () => {
    // Hand-written: no H1, lowercase set code, explicit default finish/condition.
    const filePath = path.join(dir(), 'collections', 'Binder.md')
    await fs.writeFile(filePath, '- Sol Ring (ltc:284) [nonfoil] [NM] &1\n')

    const results = await cleanupAllLists()

    expect(resultFor(results, 'Binder.md')).toMatchObject({ rewritten: true, warnings: [] })
    const content = await fs.readFile(filePath, 'utf-8')
    // Title from the file name, uppercase set code, default finish/condition omitted.
    expect(content).toBe('# Binder\n\n## Main\n- Sol Ring (LTC:284) &1\n')
    // The file was hand-written, so it had no matching sidecar and gets none:
    // stamping one would make detect-changes call the hand-added card recorded.
    expect(await Bun.file(hashPath(filePath)).exists()).toBeFalse()
  })

  test('refreshes the hash sidecar of a file that was already Ritual-clean', async () => {
    const filePath = path.join(dir(), 'collections', 'Binder.md')
    const original = '# Binder\n\n## Main\n- Sol Ring (ltc:284) [nonfoil] &1\n'
    await writeFileWithHash(filePath, original)

    const results = await cleanupAllLists()

    expect(resultFor(results, 'Binder.md')).toMatchObject({ rewritten: true })
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('# Binder\n\n## Main\n- Sol Ring (LTC:284) &1\n')
    expect(await Bun.file(hashPath(filePath)).text()).toBe(computeHash(content) + '\n')
  })

  test('reports a quantity-prefixed line without refusing to rewrite the file', async () => {
    // An advisory, not a warning: the line parses and the canonical re-emit
    // preserves it, so cleanup names it *and* still rewrites. `cleanup` is the
    // one command that reads every list file, so it is where a wanted list's
    // advisory reliably surfaces — nothing else touches wanted lists in bulk.
    const filePath = path.join(dir(), 'wanted', 'Wants.md')
    await fs.writeFile(filePath, '- 1 Sol Ring (ltc:284) &1\n')

    const result = resultFor(await cleanupAllLists(), 'Wants.md')

    expect(result.rewriteBlocked).toBeUndefined()
    expect(result.rewritten).toBeTrue()
    expect(result.warnings.join('\n')).toContain("reads as a card named '1 Sol Ring'")
    expect(await fs.readFile(filePath, 'utf-8')).toContain('- 1 Sol Ring (LTC:284) &1')
  })

  test("clears a deck's empty extras section and says so", async () => {
    // The one advisory that names content the canonical re-emit *removes*. It
    // must not block the rewrite (an empty `## Maybeboard` holds nothing to
    // lose) and must not be silent either — cleanup is where a deck's advisories
    // reach the user.
    const filePath = path.join(dir(), 'decks', 'Winota Stax.md')
    await writeDeckFile(dir(), 'Winota Stax', {
      frontMatter: { name: 'Winota Stax', format: 'commander' },
      cards: [{ quantity: 1, name: 'Winota, Joiner of Forces', cardId: 1 }],
    })
    await fs.writeFile(filePath, `${await fs.readFile(filePath, 'utf-8')}\n## Maybeboard\n`)

    const result = resultFor(await cleanupAllLists(), 'Winota Stax.md')

    expect(result.rewriteBlocked).toBeUndefined()
    expect(result.rewritten).toBeTrue()
    expect(result.warnings).toContain('Dropped empty section: Maybeboard')
    expect(await fs.readFile(filePath, 'utf-8')).not.toContain('Maybeboard')
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

  test('refuses a name-derived rename that would fold onto another list', async () => {
    // Renaming `trade binder.md` to `Trade-Binder.md` would leave the two lists
    // mutually unaddressable, so cleanup reports it instead.
    await writeCollectionFile(dir(), 'trade binder', { title: 'Trade-Binder', entries: [] })
    await writeCollectionFile(dir(), 'Trade Binder', { title: 'Trade Binder', entries: [] })

    const results = await cleanupAllLists()

    const result = resultFor(results, 'trade binder.md')
    expect(result.renamedTo).toBeUndefined()
    expect(result.warnings.join('\n')).toContain('already exists')
    expect(await Bun.file(path.join(dir(), 'collections', 'trade binder.md')).exists()).toBeTrue()
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

  test('a case-only rename onto the same file actually changes the spelling on disk', async () => {
    // What a case-insensitive file system produces: the destination path names
    // the source file. The seam makes the branch reachable on a case-sensitive
    // one — where the outcome is indistinguishable from a direct rename, so
    // this pins that cleanup takes the two-step path and leaves no temp file,
    // not that the two paths differ here.
    const filePath = await writeDeckFile(dir(), 'winota stax', {
      frontMatter: { name: 'Winota Stax', format: 'commander' },
      cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
    })
    const originalInode = (await fs.stat(filePath)).ino

    const result = await cleanupList(
      { type: 'deck', name: 'winota stax', filePath },
      { isSameFile: async () => true },
    )

    expect(result.renamedTo).toBe('Winota Stax.md')
    const newPath = path.join(dir(), 'decks', 'Winota Stax.md')
    expect(await Bun.file(newPath).exists()).toBeTrue()
    expect((await fs.stat(newPath)).ino).toBe(originalInode)
    expect(
      (await fs.readdir(path.join(dir(), 'decks'))).filter((f) => f.startsWith('.ritual-rename')),
    ).toEqual([])
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

  test('a file that cannot be parsed is reported by name and its siblings still clean up', async () => {
    // Broken YAML front matter used to abort the whole pass with a fileless
    // js-yaml error — in exactly the hand-edited workspaces cleanup exists for.
    const brokenPath = path.join(dir(), 'decks', 'Broken.md')
    await fs.writeFile(brokenPath, '---\nname: [broken\n---\n\n## Main\n1 Sol Ring &1\n')
    const collectionPath = path.join(dir(), 'collections', 'Binder.md')
    await fs.writeFile(collectionPath, '- Sol Ring (ltc:284) &1\n')

    const results = await cleanupAllLists()

    const broken = resultFor(results, 'Broken.md')
    expect(broken.unreadable).toBeTrue()
    expect(broken.rewritten).toBeFalse()
    expect(broken.renamedTo).toBeUndefined()
    expect(broken.warnings.join('\n')).toContain('could not be read')
    // The file itself is untouched, and every other list was still cleaned up.
    expect(await fs.readFile(brokenPath, 'utf-8')).toContain('name: [broken')
    expect(resultFor(results, 'Binder.md').rewritten).toBeTrue()
    expect(await fs.readFile(collectionPath, 'utf-8')).toBe(
      '# Binder\n\n## Main\n- Sol Ring (LTC:284) &1\n',
    )
  })
})

describe('cleanup CLI (Integration)', () => {
  /** A workspace with one unparseable deck and one collection needing cleanup. */
  async function writeBrokenWorkspace(dir: string): Promise<void> {
    await fs.writeFile(
      path.join(dir, 'decks', 'Broken.md'),
      '---\nname: [broken\n---\n\n## Main\n1 Sol Ring &1\n',
    )
    await fs.writeFile(path.join(dir, 'collections', 'Binder.md'), '- Sol Ring (ltc:284) &1\n')
  }

  test('a format prompt that cannot run under --no-input is a usage error, not a bad file', async () => {
    await withWorkspace(async (dir) => {
      // A file the pre-flight format check cannot classify still reaches the
      // prompt. That prompt used to sit inside `cleanupList`'s per-file read
      // guard, so its `--no-input` failure was relabelled "Broken.md could not
      // be read" and exited 1 — blaming a file for the command's own usage
      // error, and hiding the exit code the docs promise.
      await writeBrokenWorkspace(dir)

      const result = await runCli(['--no-input', 'cleanup'], dir)

      expect(result.exitCode).toBe(2)
      const output = `${result.stdout}\n${result.stderr}`
      expect(output).toContain('Deck format')
      expect(output).not.toContain('could not be read')
    })
  })

  test.each([['--dry-run'], ['--check'], ['']])(
    'a broken file names itself, exits 1, and does not stop the pass (%s)',
    async (flag: string) => {
      const flags = flag === '' ? [] : [flag]
      await withWorkspace(async (dir) => {
        await writeBrokenWorkspace(dir)

        const result = await runCli(['cleanup', '--skip-formats', ...flags], dir)

        expect(result.exitCode).toBe(1)
        const output = `${result.stdout}\n${result.stderr}`
        expect(output).toContain('Broken.md')
        expect(output).toContain('could not be read')
        // Distinct from "needs cleanup": the file was skipped, not rewritten.
        // Pinned in full — a bare 'skipped' also matches the unrelated 'format
        // skipped' action phrase that --skip-formats emits for every deck.
        expect(output).toContain('skipped: fix the file and rerun cleanup')
        // The sibling collection is still reported (and, in a real run, written).
        expect(output).toContain('Binder.md')
        if (flags.length === 0) {
          expect(await fs.readFile(path.join(dir, 'collections', 'Binder.md'), 'utf-8')).toContain(
            '(LTC:284)',
          )
        }
      })
    },
  )

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

  test('a collection with hand-written prose is rewrite-blocked, not silently stripped', async () => {
    await withWorkspace(async (dir) => {
      // Non-bullet lines now warn in the flat parsers, arming the same
      // rewrite-block guard that already protected decks.
      const filePath = path.join(dir, 'collections', 'Bad.md')
      const content = '# Bad\n\n- Opt (XLN:65) &1\nthis is not a card line\n'
      await fs.writeFile(filePath, content)

      const result = await runCli(['cleanup', '--skip-formats'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Skipped malformed line: this is not a card line')
      expect(result.stderr).toContain('not rewritten')
      expect(await fs.readFile(filePath, 'utf-8')).toBe(content)
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

describe('cleanup — labels and front matter', () => {
  let workspace: BoundWorkspace

  beforeEach(async () => {
    workspace = await bindWorkspace({ init: true })
  })

  afterEach(async () => {
    await workspace.dispose()
  })

  test('a canonical labeled, front-mattered collection is left alone', async () => {
    const filePath = path.join(workspace.dir, 'collections', 'Binder.md')
    const canonical =
      '---\nlabels: [sale, trade]\n---\n\n# Binder\n\n## Main\n- Sol Ring (LTC:284) [keep] &1\n'
    await fs.writeFile(filePath, canonical)

    const results = await cleanupAllLists()

    expect(resultFor(results, 'Binder.md')).toMatchObject({ rewritten: false, warnings: [] })
    expect(await fs.readFile(filePath, 'utf-8')).toBe(canonical)
  })

  test('a non-canonical labels token is normalized with the front matter preserved', async () => {
    const filePath = path.join(workspace.dir, 'collections', 'Binder.md')
    await fs.writeFile(
      filePath,
      '---\nlabels: [keep]\n---\n\n# Binder\n\n## Main\n- Sol Ring (ltc:284) [trade,sale] &1\n',
    )

    const results = await cleanupAllLists()

    expect(resultFor(results, 'Binder.md')).toMatchObject({ rewritten: true, warnings: [] })
    expect(await fs.readFile(filePath, 'utf-8')).toBe(
      '---\nlabels: [keep]\n---\n\n# Binder\n\n## Main\n- Sol Ring (LTC:284) [sale,trade] &1\n',
    )
  })

  test('a conflicting labels token blocks the rewrite and leaves the file untouched', async () => {
    const filePath = path.join(workspace.dir, 'collections', 'Binder.md')
    // Non-canonical (lowercase set code) so a rewrite WOULD happen — but the
    // `[sale,keep]` token is a warning, and warnings block whole-file rewrites
    // (a re-serialize would silently drop the token).
    const original = '# Binder\n\n## Main\n- Sol Ring (ltc:284) [sale,keep] &1\n'
    await fs.writeFile(filePath, original)

    const results = await cleanupAllLists()

    const result = resultFor(results, 'Binder.md')
    expect(result.rewritten).toBe(false)
    expect(result.warnings.join('\n')).toContain('Conflicting labels')
    expect(await fs.readFile(filePath, 'utf-8')).toBe(original)
  })
})
