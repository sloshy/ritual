import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { snapshotTree, withWorkspace } from '../helpers/workspace'
import { latestMigrationId } from '../../src/migrate/migrations'

/**
 * The check before every command, through the spawned (non-TTY) CLI: a
 * pending workspace gets one stderr line and is otherwise left alone, a
 * workspace a newer Ritual updated gets a warning, and neither changes the
 * command's outcome. The offer's prompt and once-a-day snooze are covered
 * in-process by test/unit/commands/migrate-check.test.ts.
 */

const OLD_SITE = { site: { version: '0.0.1', ciSystem: 'manual' } }

const PENDING_NOTICE =
  'This workspace has pending updates. Run `ritual migrate --dry-run` to see them, then `ritual migrate` to apply them.'

/** Lines of stderr that mention `ritual migrate`. */
function migrateLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.includes('ritual migrate'))
}

describe('pending-migration check (Integration)', () => {
  test('a pending workspace gets one stderr line and is not changed', async () => {
    await withWorkspace(
      async (dir) => {
        const before = await snapshotTree(dir)

        const result = await runCli(['lists'], dir)

        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('(no lists)')
        expect(migrateLines(result.stderr)).toEqual([PENDING_NOTICE])
        expect(await snapshotTree(dir)).toEqual(before)
      },
      { config: OLD_SITE },
    )
  })

  test('an exempt command prints nothing about migrating', async () => {
    await withWorkspace(
      async (dir) => {
        const result = await runCli(['config', 'list'], dir)

        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
      },
      { config: OLD_SITE },
    )
  })

  test('a recorded newer release is named in the warning', async () => {
    await withWorkspace(
      async (dir) => {
        const result = await runCli(['lists'], dir)

        expect(result.exitCode).toBe(0)
        expect(result.stderr).toContain('last updated by Ritual 99.0.0')
      },
      { config: { managed: { migration: latestMigrationId() + 1, version: '99.0.0' } } },
    )
  })

  test('a workspace migrated by a newer Ritual warns and the command still runs', async () => {
    const applied = latestMigrationId() + 1
    await withWorkspace(
      async (dir) => {
        const result = await runCli(['lists', '--output', 'json'], dir)

        expect(result.exitCode).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual([])
        expect(result.stderr).toContain(`migration ${applied}`)
        expect(result.stderr).toContain('Run `ritual self-update` to install a newer Ritual')
      },
      { config: { managed: { migration: applied } } },
    )
  })

  test('config warnings a migration fixes come with the hint to migrate', async () => {
    await withWorkspace(
      async (dir) => {
        const result = await runCli(['lists'], dir)

        expect(result.exitCode).toBe(0)
        // The notice precedes the config load's warning: the check runs first.
        const notice = result.stderr.indexOf('ritual migrate')
        expect(notice).toBeGreaterThanOrEqual(0)
        expect(notice).toBeLessThan(result.stderr.indexOf('ignoring invalid managed'))
        expect(migrateLines(result.stderr)).toEqual([
          'This workspace has pending updates, and ritual.config.json loads with warnings until they are applied. Run `ritual migrate --dry-run` to see them, then `ritual migrate` to apply them.',
        ])
      },
      { config: { ...OLD_SITE, managed: { migration: 'one' } } },
    )
  })

  test('updates that cannot apply still get the plain notice', async () => {
    await withWorkspace(
      async (dir) => {
        const result = await runCli(['lists'], dir)

        expect(result.exitCode).toBe(0)
        expect(migrateLines(result.stderr)).toEqual([PENDING_NOTICE])
      },
      { config: { ...OLD_SITE, defaultPriceSource: 42 } },
    )
  })

  test('an unreadable config is reported by the loader alone', async () => {
    await withWorkspace(
      async (dir) => {
        await fs.writeFile(path.join(dir, 'ritual.config.json'), '{ not json')

        const result = await runCli(['lists'], dir)

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('ritual.config.json is not valid JSON')
        expect(migrateLines(result.stderr)).toEqual([])
      },
      { config: false },
    )
  })
})
