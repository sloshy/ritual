import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { collectAllCards, formatAllCardsFile } from '../../src/commands/list-all-cards'
import { runCli } from './helpers/cli'
import {
  bindWorkspace,
  withWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'

describe('list-all-cards engine', () => {
  let ws: BoundWorkspace

  beforeEach(async () => {
    // No list subdirectories up front: the empty-workspace test needs them absent.
    ws = await bindWorkspace({ dirs: [], config: false, init: true })
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('dedupes cards across decks, collections, and wanted lists', async () => {
    await writeDeckFile(ws.dir, 'sample', {
      frontMatter: { name: 'Sample Deck', format: 'commander' },
      sections: [
        {
          name: 'Commander',
          cards: [
            { quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161' },
            { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
          ],
        },
        {
          name: 'Mainboard',
          cards: [
            { quantity: 3, name: 'Counterspell', set: 'lea', collectorNumber: '55' },
            { quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161' },
          ],
        },
      ],
    })
    await writeCollectionFile(ws.dir, 'main', {
      title: 'My Collection',
      entries: [
        { name: 'Sol Ring', set: 'cmr', collectorNumber: '1' },
        { name: 'Counterspell', set: 'lea', collectorNumber: '55' },
        {
          name: 'Black Lotus',
          set: 'lea',
          collectorNumber: '232',
          finish: 'foil',
          condition: 'NM',
          note: 'first edition',
          cardId: 7,
        },
      ],
    })
    await writeWantedFile(ws.dir, 'wishlist', {
      title: 'Wishlist',
      entries: [
        { name: 'Mox Ruby', set: 'lea', collectorNumber: '265' },
        { name: 'Lightning Bolt' },
        { name: 'Black Lotus', set: 'lea', collectorNumber: '232' },
      ],
    })

    const { entries, skipped, warnings } = await collectAllCards()
    const keys = entries.map((e) => `${e.name}|${e.set ?? ''}|${e.collectorNumber ?? ''}`)

    // Sol Ring (LEA:161) appears in deck twice and isn't duplicated; Sol Ring
    // (CMR:1) is a separate printing.
    expect(keys.filter((k) => k === 'Sol Ring|lea|161')).toHaveLength(1)
    expect(keys.filter((k) => k === 'Sol Ring|cmr|1')).toHaveLength(1)

    // Black Lotus (LEA:232) appears in collection (with foil/NM/note) AND
    // wanted list — should still collapse to one entry, with no finish/etc.
    expect(keys.filter((k) => k === 'Black Lotus|lea|232')).toHaveLength(1)

    // Lightning Bolt with no printing AND with printing are separate entries
    expect(keys).toContain('Lightning Bolt||')
    expect(keys).toContain('Lightning Bolt|lea|161')

    // A clean workspace produces no diagnostics.
    expect(skipped).toEqual([])
    expect(warnings).toEqual([])
  })

  test('sorts entries alphabetically by name, then by set, then by collector number', async () => {
    await writeDeckFile(ws.dir, 'sample', {
      frontMatter: { name: 'S' },
      cards: [
        { quantity: 1, name: 'Sol Ring', set: 'cmr', collectorNumber: '1' },
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
        { quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161' },
        { quantity: 1, name: 'Black Lotus', set: 'lea', collectorNumber: '232' },
      ],
    })

    const { entries } = await collectAllCards()
    expect(entries.map((e) => e.name)).toEqual([
      'Black Lotus',
      'Lightning Bolt',
      'Sol Ring',
      'Sol Ring',
    ])
    const solRings = entries.filter((e) => e.name === 'Sol Ring')
    expect(solRings.map((e) => e.set)).toEqual(['cmr', 'lea'])
  })

  test('formatAllCardsFile produces deterministic output without finish/condition/notes', () => {
    const content = formatAllCardsFile([
      { name: 'Black Lotus', set: 'lea', collectorNumber: '232' },
      { name: 'Lightning Bolt' },
      { name: 'Sol Ring', set: 'cmr', collectorNumber: '1' },
    ])
    expect(content).toBe(
      [
        '# All cards',
        '',
        '- Black Lotus (LEA:232)',
        '- Lightning Bolt',
        '- Sol Ring (CMR:1)',
        '',
      ].join('\n'),
    )
  })

  test('returns an empty result when no list directories exist', async () => {
    const { entries, skipped, warnings } = await collectAllCards()
    expect(entries).toEqual([])
    expect(skipped).toEqual([])
    expect(warnings).toEqual([])
    expect(formatAllCardsFile(entries)).toBe('# All cards\n\n')
  })

  test('reports an unparseable deck as skipped while keeping the rest of the data', async () => {
    await writeDeckFile(ws.dir, 'good', {
      frontMatter: { name: 'Good Deck' },
      cards: [{ quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161', cardId: 1 }],
    })
    // Broken YAML front matter makes importFromTextFile throw.
    await fs.writeFile(
      path.join(ws.dir, 'decks', 'bad.md'),
      '---\nname: [unclosed\n---\n1 Island &1\n',
    )

    const { entries, skipped } = await collectAllCards()

    expect(entries).toEqual([{ name: 'Sol Ring', set: 'lea', collectorNumber: '161' }])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.file).toBe(path.join('decks', 'bad.md'))
    expect(skipped[0]?.reason).not.toBe('')
  })

  test('collects flat-list parser warnings prefixed with their file without skipping the file', async () => {
    await writeCollectionFile(ws.dir, 'binder', {
      title: 'Binder',
      entries: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 1 }],
    })
    // A printing-less collection line parses with a warning, not a skip.
    await fs.appendFile(path.join(ws.dir, 'collections', 'binder.md'), '- Counterspell &2\n')

    const { entries, skipped, warnings } = await collectAllCards()

    expect(entries).toEqual([{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284' }])
    expect(skipped).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toStartWith(path.join('collections', 'binder.md'))
    expect(warnings[0]).toContain('Counterspell')
  })
})

describe('list-all-cards CLI', () => {
  test('prints the text manifest to stdout by default without writing a file', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'sample', {
        frontMatter: { name: 'Sample' },
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161', cardId: 1 }],
      })

      const result = await runCli(['list-all-cards'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('# All cards\n\n- Sol Ring (LEA:161)\n')
      expect(await Bun.file(path.join(dir, 'all-cards.md')).exists()).toBeFalse()
    })
  })

  test('--out - is stdout, byte-identical to the default', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'sample', {
        frontMatter: { name: 'Sample' },
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161', cardId: 1 }],
      })

      const result = await runCli(['list-all-cards', '--out', '-'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('# All cards\n\n- Sol Ring (LEA:161)\n')
      expect(await Bun.file(path.join(dir, 'all-cards.md')).exists()).toBeFalse()
    })
  })

  test('--out writes the manifest file and prints a confirmation', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'sample', {
        frontMatter: { name: 'Sample' },
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161', cardId: 1 }],
      })

      const result = await runCli(['list-all-cards', '--out', 'build/manifest.md'], dir)

      const outPath = path.join(dir, 'build', 'manifest.md')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Wrote 1 cards to ${outPath}`)
      expect(await fs.readFile(outPath, 'utf-8')).toBe('# All cards\n\n- Sol Ring (LEA:161)\n')
    })
  })

  test('--output json emits the entry array on stdout with lowercase sets', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'sample', {
        frontMatter: { name: 'Sample' },
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161', cardId: 1 }],
      })
      await writeWantedFile(dir, 'needs', {
        title: 'Needs',
        entries: [{ name: 'Demonic Tutor', cardId: 1 }],
      })

      const result = await runCli(['list-all-cards', '--output', 'json'], dir)

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual([
        { name: 'Demonic Tutor' },
        { name: 'Sol Ring', set: 'lea', collectorNumber: '161' },
      ])
    })
  })

  test('--out with --output json writes the JSON payload to the file', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'sample', {
        frontMatter: { name: 'Sample' },
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161', cardId: 1 }],
      })

      const result = await runCli(
        ['list-all-cards', '--output', 'json', '--out', 'cards.json'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      const written = JSON.parse(await fs.readFile(path.join(dir, 'cards.json'), 'utf-8'))
      expect(written).toEqual([{ name: 'Sol Ring', set: 'lea', collectorNumber: '161' }])
    })
  })

  test('an unparseable list file warns on stderr and exits 1 while still emitting data', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'good', {
        frontMatter: { name: 'Good Deck' },
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161', cardId: 1 }],
      })
      await fs.writeFile(
        path.join(dir, 'decks', 'bad.md'),
        '---\nname: [unclosed\n---\n1 Island &1\n',
      )

      const result = await runCli(['list-all-cards'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(`warning: skipped ${path.join('decks', 'bad.md')}:`)
      // The manifest is still produced from the readable files.
      expect(result.stdout).toContain('- Sol Ring (LEA:161)')
    })
  })

  test('flat-list parser warnings go to stderr but do not affect the exit code', async () => {
    await withWorkspace(async (dir) => {
      await writeCollectionFile(dir, 'binder', {
        title: 'Binder',
        entries: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 1 }],
      })
      await fs.appendFile(path.join(dir, 'collections', 'binder.md'), '- Counterspell &2\n')

      const result = await runCli(['list-all-cards'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain(`warning: ${path.join('collections', 'binder.md')}:`)
      expect(result.stdout).toContain('- Sol Ring (LTC:284)')
    })
  })
})
