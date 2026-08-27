import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ExitCode } from '../../src/util/errors'
import { runCli } from './helpers/cli'
import { withWorkspace } from './helpers/workspace'

/**
 * CLI wiring for text-file imports with unparseable lines: the skipped lines
 * are reported on stderr, carried in the JSON payload, and fail the run with
 * exit 1 even though the import was written. (The parser's warning semantics
 * are pinned in test/unit; this covers the command's reporting contract.)
 */
describe('import text file skipped-line reporting (Integration)', () => {
  const lossySource = 'Lightning Bolt\nMonastery Swiftspear\n2 Mountain\n'

  test('reports each skipped line on stderr and exits 1, but writes the valid cards', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'decklist.txt')
      await fs.writeFile(source, lossySource)

      const result = await runCli(['import', source, '--type', 'deck', '--no-input'], dir)

      expect(result.exitCode).toBe(ExitCode.RuntimeError)
      expect(result.stderr).toContain('2 line(s) could not be imported:')
      expect(result.stderr).toContain('Skipped malformed line: Lightning Bolt')
      expect(result.stderr).toContain('Skipped malformed line: Monastery Swiftspear')
      const deck = await fs.readFile(path.join(dir, 'decks', 'decklist.md'), 'utf-8')
      expect(deck).toContain('2 Mountain &1')
      expect(deck).not.toContain('Lightning Bolt')
    })
  })

  test('carries the warnings in the JSON payload', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'decklist.txt')
      await fs.writeFile(source, lossySource)

      const result = await runCli(
        ['import', source, '--type', 'deck', '--no-input', '--output', 'json'],
        dir,
      )

      expect(result.exitCode).toBe(ExitCode.RuntimeError)
      type Payload = { action: string; warnings: string[] }
      const payload = JSON.parse(result.stdout) as Payload
      expect(payload.action).toBe('created')
      expect(payload.warnings).toEqual([
        'Skipped malformed line: Lightning Bolt',
        'Skipped malformed line: Monastery Swiftspear',
      ])
    })
  })

  test('a fully parseable file still imports cleanly with exit 0 and no warnings', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'decklist.txt')
      await fs.writeFile(source, '2 Mountain\n\n## Sideboard\n1 Pyroblast\n')

      const result = await runCli(
        ['import', source, '--type', 'deck', '--no-input', '--output', 'json'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      type Payload = { warnings: string[] }
      expect((JSON.parse(result.stdout) as Payload).warnings).toEqual([])
    })
  })
})

/**
 * The Arena/MTGO dialect end to end: the CLI opts the parser in, so the file
 * lands with real printings and sections. (The dialect grammar itself is pinned
 * in test/unit; this covers the wiring, the file content, and the advisory
 * channel.)
 */
describe('import Arena-dialect text file (Integration)', () => {
  const arenaExport = [
    'About',
    'Name Mono-Red Aggro',
    '',
    'Commander',
    '1 Krenko, Mob Boss (M19) 149',
    '',
    'Deck',
    '4 Lightning Bolt (M10) 146',
    '2 Shock (M20) 160',
    '',
    'Sideboard',
    '2 Pyroblast (ICE) 213',
    '',
  ].join('\n')

  test('imports printings, sections, and the About name', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'arena-export.txt')
      await fs.writeFile(source, arenaExport)

      const result = await runCli(['import', source, '--type', 'deck', '--no-input'], dir)

      expect(result.exitCode).toBe(0)
      const deck = await fs.readFile(path.join(dir, 'decks', 'Mono-Red Aggro.md'), 'utf-8')
      // Set codes are written uppercase in markdown, lowercase internally.
      expect(deck).toContain('## Commander\n1 Krenko, Mob Boss (M19:149) &1')
      expect(deck).toContain('## Main\n4 Lightning Bolt (M10:146) &2')
      expect(deck).toContain('2 Shock (M20:160) &3')
      expect(deck).toContain('## Sideboard\n2 Pyroblast (ICE:213) &4')
      expect(deck).not.toContain('(M10) 146')
    })
  })

  test('an unreadable printing token is an advisory, not a failure', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'odd.txt')
      await fs.writeFile(source, '4 (M10) 146\n')

      const result = await runCli(
        ['import', source, '--type', 'deck', '--no-input', '--output', 'json'],
        dir,
      )

      // The card is written, so the run is clean — but the line is called out.
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('still contains a printing token')
      type Payload = { warnings: string[]; advisories: string[] }
      const payload = JSON.parse(result.stdout) as Payload
      expect(payload.warnings).toEqual([])
      expect(payload.advisories).toHaveLength(1)
    })
  })

  test('a second import under --no-input is the conflict usage error, not a prompt', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'decklist.txt')
      await fs.writeFile(source, '2 Mountain\n')
      await runCli(['import', source, '--type', 'deck', '--no-input'], dir)

      const result = await runCli(['import', source, '--type', 'deck', '--no-input'], dir)

      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr).toContain("Import conflict for 'decklist.md'")
    })
  })

  test.each<[string, string, string, string, boolean]>([
    [
      'a collection keeps a [sale] label',
      'collection',
      'collections',
      '- Sol Ring (C19:221) [sale] &1',
      true,
    ],
    ['a wanted list drops it with a warning', 'wanted', 'wanted', '- Sol Ring (C19:221) &1', false],
  ])('%s', async (_label, type, listDir, line, kept) => {
    // The destination type — not the parser's deck grammar — decides which
    // label tokens survive a text import.
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'binder.txt')
      await fs.writeFile(source, '1 Sol Ring (C19:221) [sale]\n')

      const result = await runCli(['import', source, '--type', type, '--no-input'], dir)

      expect(result.exitCode).toBe(kept ? 0 : ExitCode.RuntimeError)
      const written = await fs.readFile(path.join(dir, listDir, 'binder.md'), 'utf-8')
      expect(written).toContain(line)
      if (!kept) expect(result.stderr).toContain('not supported on a wanted list')
    })
  })

  test('a name with nothing usable in a file name is a usage error, not a crash', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'decklist.txt')
      await fs.writeFile(source, '---\nname: "???"\n---\n2 Mountain\n')

      const result = await runCli(['import', source, '--type', 'deck', '--no-input'], dir)

      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr).toContain('no characters usable in a file name')
      expect(result.stderr).not.toContain('Failed to import:')
    })
  })

  test('--dry-run over an existing deck says it would overwrite it', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'decklist.txt')
      await fs.writeFile(source, '2 Mountain\n')
      await runCli(['import', source, '--type', 'deck', '--no-input'], dir)

      const result = await runCli(
        ['import', source, '--type', 'deck', '--no-input', '--yes', '--dry-run'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[dry-run] Would overwrite deck:')
      expect(result.stdout).not.toContain('Would save deck to:')
    })
  })

  test.each([
    ['decklist.txt', 'text-file'],
    ['cards.csv', 'CSV'],
  ])('--moxfield-user-agent on a %s import is a usage error', async (fileName, kindLabel) => {
    // Two branches with two messages; only naming the source kind in the
    // assertion tells them apart.
    await withWorkspace(async (dir) => {
      const source = path.join(dir, fileName)
      await fs.writeFile(source, fileName.endsWith('.csv') ? 'name\nMountain\n' : '2 Mountain\n')

      const result = await runCli(
        ['import', source, '--type', 'deck', '--no-input', '--moxfield-user-agent', 'Foo/1.0'],
        dir,
      )

      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr).toContain(
        `--moxfield-user-agent only applies to URL imports; it does not apply to ${kindLabel} imports.`,
      )
      expect(await Bun.file(path.join(dir, 'decks', 'decklist.md')).exists()).toBeFalse()
    })
  })

  test('a decklist wrapped in a ``` fence imports its cards', async () => {
    // A paste from Discord/Reddit/GitHub arrives fenced. Reading the fence as
    // prose imported nothing and still reported success.
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'pasted.txt')
      await fs.writeFile(source, '```\n4 Lightning Bolt (M10) 146\n2 Shock (M20) 160\n```\n')

      const result = await runCli(
        ['import', source, '--type', 'deck', '--no-input', '--yes', '--output', 'json'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      const deck = await fs.readFile(path.join(dir, 'decks', 'pasted.md'), 'utf-8')
      expect(deck).toContain('4 Lightning Bolt (M10:146) &1')
      expect(deck).toContain('2 Shock (M20:160) &2')
    })
  })

  test('an export finish marker becomes a finish rather than part of the name', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'moxtext.txt')
      await fs.writeFile(source, '1 Forest (UNF) 235 *F*\n4 Lightning Bolt (M10) 146\n')

      const result = await runCli(
        ['import', source, '--type', 'deck', '--no-input', '--yes', '--output', 'json'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      type Payload = { warnings: string[]; advisories: string[] }
      const payload = JSON.parse(result.stdout) as Payload
      expect(payload).toMatchObject({ warnings: [], advisories: [] })
      const deck = await fs.readFile(path.join(dir, 'decks', 'moxtext.md'), 'utf-8')
      expect(deck).toContain('1 Forest (UNF:235) [foil] &1')
    })
  })

  test('a name-only parenthesized suffix is kept verbatim and advised about', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'tricky.txt')
      await fs.writeFile(source, '1 Very Cryptic Command (Untap)\n')

      const result = await runCli(
        ['import', source, '--type', 'deck', '--no-input', '--yes', '--output', 'json'],
        dir,
      )

      // An advisory is not loss, so the run still succeeds.
      expect(result.exitCode).toBe(0)
      type Payload = { advisories: string[] }
      const payload = JSON.parse(result.stdout) as Payload
      expect(payload.advisories).toHaveLength(1)
      const deck = await fs.readFile(path.join(dir, 'decks', 'tricky.md'), 'utf-8')
      expect(deck).toContain('1 Very Cryptic Command (Untap) &1')
    })
  })

  test('the overwrite notice survives --quiet', async () => {
    // Replacing a file is destructive; silence must not hide it.
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'decklist.txt')
      await fs.writeFile(source, '2 Mountain\n')
      await runCli(['import', source, '--type', 'deck', '--no-input'], dir)

      const result = await runCli(
        ['import', source, '--type', 'deck', '--no-input', '--yes', '--quiet'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Overwriting decklist.md...')
      expect(result.stdout).toBe('')
    })
  })
})
