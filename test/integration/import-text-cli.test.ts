import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ExitCode } from '../../src/commands/scripting'
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
