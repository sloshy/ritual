import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'
import { snapshotTree } from '../helpers/workspace'
import { latestMigrationId } from '../../src/migrate/migrations'
import type { ManagedConfig } from '../../src/config/ritual-config'

/**
 * One representative path through `ritual migrate`: an older workspace is
 * reported by `--check`, previewed by `--dry-run`, refused headless without
 * `--yes` — none of which write anything — and brought up to date by `--yes`.
 * The planner's own cases live in test/unit/migrate.test.ts.
 */

const WORKFLOW = path.join('.github', 'workflows', 'deploy-site.yml')

type MigratedConfig = { site?: Record<string, unknown>; managed?: ManagedConfig }

const OLD_CONFIG = JSON.stringify({
  site: {
    version: '0.0.1',
    prerelease: false,
    ciSystem: 'github-actions',
    deployMode: 'publish-for-me',
    distDir: 'dist',
    detectChanges: false,
  },
})

describe('migrate CLI (Integration)', () => {
  test('previews without writing, requires --yes headless, then applies', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'ritual.config.json'), OLD_CONFIG)
      await fs.mkdir(path.dirname(path.join(dir, WORKFLOW)), { recursive: true })
      await fs.writeFile(path.join(dir, WORKFLOW), 'run: ./ritual build-site --allow-refresh\n')
      const before = await snapshotTree(dir)

      const check = await runCli(['migrate', '--check'], dir)
      expect(check.exitCode).toBe(4)
      expect(check.stdout).toContain('pending updates')

      const dryRun = await runCli(['migrate', '--dry-run'], dir)
      expect(dryRun.exitCode).toBe(0)
      expect(dryRun.stdout).toContain('Migration 1')
      expect(dryRun.stdout).toContain('remove site.version')
      expect(dryRun.stdout).toContain('Migration 2')
      expect(dryRun.stdout).toContain('remove site.prerelease')
      expect(dryRun.stdout).toContain(`write ${WORKFLOW}`)

      const headless = await runCli(['migrate'], dir)
      expect(headless.exitCode).toBe(2)
      expect(headless.stderr).toContain('--yes')

      expect(await snapshotTree(dir)).toEqual(before)

      const applied = await runCli(['migrate', '--yes'], dir)
      expect(applied.exitCode).toBe(0)
      // The spawned CLI is a dev build and the workspace has no pin, so CI
      // would fall back to the latest stable release.
      expect(applied.stderr).toContain('did not pin a release')
      // The old config was copied aside first, and the folder is named relative
      // to the workspace.
      const [backup, ...more] = await fs.readdir(path.join(dir, '.backups'))
      expect(more).toEqual([])
      expect(applied.stdout).toContain(
        `Saved a copy of the files it changed in ${path.join('.backups', backup ?? '')}`,
      )
      expect(applied.stdout).not.toContain(dir)
      expect(
        await fs.readFile(path.join(dir, '.backups', backup ?? '', 'ritual.config.json'), 'utf-8'),
      ).toBe(OLD_CONFIG)
      const config = JSON.parse(
        await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8'),
      ) as MigratedConfig
      expect(config.site?.version).toBeUndefined()
      expect(config.site?.prerelease).toBeUndefined()
      const workflow = await fs.readFile(path.join(dir, WORKFLOW), 'utf-8')
      expect(workflow).not.toContain('--allow-refresh')
      expect(workflow).toContain(`jq -r '.managed.version // empty' ritual.config.json`)
      expect(config.managed?.migration).toBe(latestMigrationId())

      const recheck = await runCli(['migrate', '--check'], dir)
      expect(recheck.exitCode).toBe(0)
      expect(recheck.stdout).toBe('')
    })
  })

  test.each([
    ['a config migrations cannot make valid', { cacheSource: 'torrent' }, 'cacheSource'],
    [
      'a workspace a newer release updated',
      { managed: { migration: 99, version: '9.0.0' } },
      'ritual self-update --tag 9.0.0',
    ],
    [
      'a workspace a newer build migrated',
      { managed: { migration: 99 } },
      'Run `ritual self-update` to install a newer Ritual',
    ],
  ])('refuses %s (exit 1) and writes nothing', async (_label, config, message) => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'ritual.config.json'), JSON.stringify(config))
      const before = await snapshotTree(dir)

      const result = await runCli(['migrate', '--yes'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(message)
      // migrate skips the config loader, whose lenient pass would warn first.
      expect(result.stderr).not.toContain('ignoring invalid')
      expect(await snapshotTree(dir)).toEqual(before)
    })
  })

  test('a fresh publish-for-me init is already current', async () => {
    await withTempDir(async (dir) => {
      const init = await runCli(
        [
          'init-site',
          '--ci',
          'github-actions',
          '--deploy',
          'publish-for-me',
          '--no-change-detection',
          '--price-source',
          'tcgplayer',
          '--no-skills',
        ],
        dir,
      )
      expect(init.exitCode).toBe(0)

      const check = await runCli(['migrate', '--check'], dir)
      expect(check.exitCode).toBe(0)
    })
  })

  test('moves an old workspace cache into the empty shared cache, and keeps the next one', async () => {
    await withTempDir(async (userCache) => {
      // The spawned CLIs resolve the per-user default into the throwaway folder.
      const env = { RITUAL_CACHE_DIR: undefined, XDG_CACHE_HOME: userCache }
      const shared = path.join(userCache, 'ritual')
      const seed = async (dir: string, body: string): Promise<void> => {
        await fs.writeFile(path.join(dir, 'ritual.config.json'), '{}')
        await fs.mkdir(path.join(dir, 'cache'))
        await fs.writeFile(path.join(dir, 'cache', 'cache.json'), body)
      }

      await withTempDir(async (first) => {
        await seed(first, '{"first":true}')
        const dryRun = await runCli(['migrate', '--dry-run'], first, env)
        expect(dryRun.stdout).toContain(`move the card cache cache → ${shared}`)

        const applied = await runCli(['migrate', '--yes'], first, env)
        expect(applied.exitCode).toBe(0)
        expect(applied.stdout).toContain(`✓ Moved the card cache from cache to ${shared}`)
        expect(await fs.readFile(path.join(shared, 'cache.json'), 'utf-8')).toBe('{"first":true}')
        expect(await snapshotTree(first)).not.toHaveProperty('cache/')
      })

      await withTempDir(async (second) => {
        await seed(second, '{"second":true}')
        const applied = await runCli(['migrate', '--yes'], second, env)
        expect(applied.exitCode).toBe(0)
        expect(applied.stdout).toContain(`Left cache in place: ${shared} is not empty`)
        expect(await fs.readFile(path.join(second, 'cache', 'cache.json'), 'utf-8')).toBe(
          '{"second":true}',
        )
        expect(await fs.readFile(path.join(shared, 'cache.json'), 'utf-8')).toBe('{"first":true}')
        const config = JSON.parse(
          await fs.readFile(path.join(second, 'ritual.config.json'), 'utf-8'),
        ) as MigratedConfig
        expect(config.managed?.migration).toBe(latestMigrationId())
      })
    })
  })

  test('a directory without ritual.config.json has nothing to migrate', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['migrate'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('nothing to migrate')
      expect(await Bun.file(path.join(dir, 'ritual.config.json')).exists()).toBeFalse()
    })
  })
})
