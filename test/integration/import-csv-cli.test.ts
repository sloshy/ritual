import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ExitCode } from '../../src/util/errors'
import { runCli } from './helpers/cli'
import { withWorkspace } from './helpers/workspace'

/**
 * The scripted (`--columns`) CSV path of `ritual import`, from the CLI in.
 * The conversion engine's semantics are pinned in test/unit and
 * `csv-apply.test.ts`; these cover what the command itself decides and says:
 * the header-row assumption, the column-width check, and the disclosure that a
 * run replaced an existing list.
 */
describe('import CSV scripted path (Integration)', () => {
  const headerless = 'Lightning Bolt,lea,161,4\nShock,m20,160,2\n'
  const columns = 'name=1,set=2,collector-number=3,quantity=4'

  test('names the row it dropped and warns when that row looks like data', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'headerless.csv')
      await fs.writeFile(source, headerless)

      const result = await runCli(
        ['import', source, '--type', 'collection', '--name', 'Binder', '--columns', columns],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Skipping header row: Lightning Bolt,lea,161,4')
      expect(result.stderr).toContain('does not look like a header')
      expect(result.stderr).toContain('--no-header')
      // The default is still deterministic: the row really was dropped.
      const list = await fs.readFile(path.join(dir, 'collections', 'Binder.md'), 'utf-8')
      expect(list).not.toContain('Lightning Bolt')
    })
  })

  test('--no-header wins outright: the row is imported and neither line is printed', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'headerless.csv')
      await fs.writeFile(source, headerless)

      const result = await runCli(
        [
          'import',
          source,
          '--type',
          'collection',
          '--name',
          'Binder',
          '--columns',
          columns,
          '--no-header',
        ],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).not.toContain('Skipping header row')
      expect(result.stderr).not.toContain('does not look like a header')
      const list = await fs.readFile(path.join(dir, 'collections', 'Binder.md'), 'utf-8')
      expect(list).toContain('Lightning Bolt (LEA:161)')
    })
  })

  test('a real header row is dropped quietly, with no data warning', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'cards.csv')
      await fs.writeFile(source, `Name,Set,Collector Number,Quantity\n${headerless}`)

      const result = await runCli(
        ['import', source, '--type', 'collection', '--name', 'Binder', '--columns', columns],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Skipping header row: Name,Set,Collector Number,Quantity')
      expect(result.stderr).not.toContain('does not look like a header')
    })
  })

  test('a missing source file is a not-found naming the file', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'absent.csv')

      const result = await runCli(
        ['import', source, '--type', 'collection', '--name', 'binder'],
        dir,
      )

      expect(result.exitCode).toBe(ExitCode.NotFound)
      expect(result.stderr.trim()).toBe(`Could not read CSV file: ${source}`)
    })
  })

  test('an out-of-range column is one usage error naming the index and the width', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'cards.csv')
      await fs.writeFile(source, headerless)

      const result = await runCli(
        [
          'import',
          source,
          '--type',
          'wanted',
          '--name',
          'OOR',
          '--columns',
          'name=99',
          '--no-header',
        ],
        dir,
      )

      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr).toContain("Column 99 (mapped to 'name') does not exist")
      expect(result.stderr).toContain('the file has 4 column(s)')
      // Not a single per-row complaint about the data.
      expect(result.stderr).not.toContain('Missing card name')
    })
  })

  test('replacing an existing list says so, and --dry-run previews the replacement', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'cards.csv')
      await fs.writeFile(source, headerless)
      const args = [
        'import',
        source,
        '--type',
        'wanted',
        '--name',
        'ToBuy',
        '--columns',
        columns,
        '--no-header',
      ]
      await runCli(args, dir)

      const preview = await runCli([...args, '--yes', '--dry-run', '--output', 'json'], dir)
      expect(preview.exitCode).toBe(0)
      type Payload = { mode: string; dryRun: boolean; replacesExisting: boolean }
      const payload = JSON.parse(preview.stdout) as Payload
      expect(payload).toMatchObject({ mode: 'overwrite', dryRun: true, replacesExisting: true })

      const previewText = await runCli([...args, '--yes', '--dry-run'], dir)
      expect(previewText.stdout).toContain("[dry-run] Would overwrite wanted 'ToBuy'")

      const overwrite = await runCli([...args, '--yes'], dir)
      expect(overwrite.exitCode).toBe(0)
      // Essential, so it survives --quiet and lands on stderr.
      expect(overwrite.stderr).toContain('Overwriting ToBuy.md...')

      const quiet = await runCli([...args, '--yes', '--quiet'], dir)
      expect(quiet.stdout).toBe('')
      expect(quiet.stderr).toContain('Overwriting ToBuy.md...')
    })
  })

  test('a fresh create reports no replacement', async () => {
    await withWorkspace(async (dir) => {
      const source = path.join(dir, 'cards.csv')
      await fs.writeFile(source, headerless)

      const result = await runCli(
        [
          'import',
          source,
          '--type',
          'wanted',
          '--name',
          'Fresh',
          '--columns',
          columns,
          '--no-header',
          '--output',
          'json',
        ],
        dir,
      )

      type Payload = { mode: string; replacesExisting: boolean }
      expect(JSON.parse(result.stdout) as Payload).toMatchObject({
        mode: 'create',
        replacesExisting: false,
      })
      expect(result.stderr).not.toContain('Overwriting')
    })
  })
})
