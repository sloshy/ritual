import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'
import { version as ritualVersion } from '../../src/version'

/**
 * Headless `init-site` runs in synthetic directories. runCli's stdin is not a
 * TTY, so every value must come from a flag — any prompt that would fire is a
 * usage error naming the missing flag.
 */

type SiteConfigFile = {
  site?: {
    version?: string
    ciSystem?: string
    deployMode?: string
    distDir?: string
    detectChanges?: boolean
  }
  defaultCurrency?: string
}

async function readConfig(dir: string): Promise<SiteConfigFile> {
  return JSON.parse(await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8'))
}

const workflowRelPath = path.join('.github', 'workflows', 'deploy-site.yml')

describe('init-site CLI (Integration)', () => {
  test('a fully-flagged headless publish-for-me init writes every file without prompting', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        [
          'init-site',
          '--ci',
          'github-actions',
          '--deploy',
          'publish-for-me',
          '--change-detection',
          '--currency',
          'eur',
          '--no-skills',
        ],
        dir,
      )

      expect(result.exitCode).toBe(0)

      const workflow = await fs.readFile(path.join(dir, workflowRelPath), 'utf-8')
      expect(workflow).toContain('./ritual build-site --refresh auto')
      expect(workflow).not.toContain('--allow-refresh')
      expect(workflow).toContain('git-detect-changes')

      const config = await readConfig(dir)
      expect(config.site).toMatchObject({
        version: ritualVersion,
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: true,
      })
      expect(config.defaultCurrency).toBe('eur')

      expect(await Bun.file(path.join(dir, 'README.md')).exists()).toBeTrue()
      expect(await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')).toContain('cache/')
    })
  })

  test('a headless local-build init honors --dist-dir and --no-change-detection', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        [
          'init-site',
          '--ci',
          'github-actions',
          '--deploy',
          'local-build',
          '--dist-dir',
          'public',
          '--currency',
          'usd',
          '--no-skills',
        ],
        dir,
      )

      expect(result.exitCode).toBe(0)
      const workflow = await fs.readFile(path.join(dir, workflowRelPath), 'utf-8')
      expect(workflow).toContain('path: public')
      expect((await readConfig(dir)).site).toMatchObject({
        deployMode: 'local-build',
        distDir: 'public',
      })
    })
  })

  test('a headless manual init needs only --ci and --currency', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['init-site', '--ci', 'manual', '--currency', 'usd', '--no-skills'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect((await readConfig(dir)).site).toMatchObject({ ciSystem: 'manual' })
      expect(await Bun.file(path.join(dir, 'README.md')).exists()).toBeTrue()
      expect(await Bun.file(path.join(dir, workflowRelPath)).exists()).toBeFalse()
    })
  })

  test.each([
    ['missing --ci', ['init-site', '--currency', 'usd', '--no-skills'], '--ci'],
    [
      'missing --deploy',
      ['init-site', '--ci', 'github-actions', '--currency', 'usd', '--no-skills'],
      '--deploy',
    ],
    [
      'missing --dist-dir',
      [
        'init-site',
        '--ci',
        'github-actions',
        '--deploy',
        'local-build',
        '--currency',
        'usd',
        '--no-skills',
      ],
      '--dist-dir',
    ],
    [
      'missing --change-detection',
      [
        'init-site',
        '--ci',
        'github-actions',
        '--deploy',
        'publish-for-me',
        '--currency',
        'usd',
        '--no-skills',
      ],
      '--change-detection',
    ],
    ['missing --currency', ['init-site', '--ci', 'manual', '--no-skills'], '--currency'],
  ])('a headless init with a %s is a usage error naming the flag', async (_name, args, flag) => {
    await withTempDir(async (dir) => {
      const result = await runCli(args, dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain(flag)
      // Nothing was initialized. (The CLI bootstrap may create a default
      // ritual.config.json, but never the site block.)
      if (await Bun.file(path.join(dir, 'ritual.config.json')).exists()) {
        expect((await readConfig(dir)).site).toBeUndefined()
      }
      expect(await Bun.file(path.join(dir, workflowRelPath)).exists()).toBeFalse()
    })
  })

  test('an invalid --ci value is rejected at parse time', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['init-site', '--ci', 'jenkins'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Invalid CI system 'jenkins'")
    })
  })

  test('GitHub Actions flags are rejected with --ci manual', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        [
          'init-site',
          '--ci',
          'manual',
          '--deploy',
          'publish-for-me',
          '--currency',
          'usd',
          '--no-skills',
        ],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--ci github-actions')
    })
  })

  test('an existing README without a decision flag is a headless usage error', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'README.md'), 'my own readme\n')

      const result = await runCli(
        ['init-site', '--ci', 'manual', '--currency', 'usd', '--no-skills'],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--overwrite-readme')
      expect(await fs.readFile(path.join(dir, 'README.md'), 'utf-8')).toBe('my own readme\n')
    })
  })

  test('--no-overwrite-readme keeps an existing README', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'README.md'), 'my own readme\n')

      const result = await runCli(
        [
          'init-site',
          '--ci',
          'manual',
          '--currency',
          'usd',
          '--no-overwrite-readme',
          '--no-skills',
        ],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('⊘ Skipped README.md')
      expect(await fs.readFile(path.join(dir, 'README.md'), 'utf-8')).toBe('my own readme\n')
    })
  })

  test('--force overwrites an existing README without prompting', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'README.md'), 'my own readme\n')

      const result = await runCli(
        ['init-site', '--force', '--ci', 'manual', '--currency', 'usd', '--no-skills'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('✓ Created README.md')
      expect(await fs.readFile(path.join(dir, 'README.md'), 'utf-8')).toContain('# My Ritual Site')
    })
  })

  test('config flags on an already-initialized repository are a usage error', async () => {
    await withTempDir(async (dir) => {
      const init = await runCli(
        ['init-site', '--ci', 'manual', '--currency', 'usd', '--no-skills'],
        dir,
      )
      expect(init.exitCode).toBe(0)

      const result = await runCli(['init-site', '--ci', 'github-actions', '--no-skills'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('already initialized')
      expect(result.stderr).toContain('--force')
    })
  })

  test('a headless version upgrade requires --upgrade and migrates the workflow', async () => {
    await withTempDir(async (dir) => {
      // A repository initialized by an older build: old site version, and a
      // workflow still using the old build-site flag.
      await fs.writeFile(
        path.join(dir, 'ritual.config.json'),
        JSON.stringify({
          site: {
            version: '0.0.1',
            ciSystem: 'github-actions',
            deployMode: 'publish-for-me',
            distDir: 'dist',
            detectChanges: false,
          },
        }),
      )
      const workflowPath = path.join(dir, workflowRelPath)
      await fs.mkdir(path.dirname(workflowPath), { recursive: true })
      await fs.writeFile(workflowPath, 'run: ./ritual build-site --allow-refresh\n')

      // Without --upgrade, the confirm prompt cannot run headless.
      const refused = await runCli(['init-site'], dir)
      expect(refused.exitCode).toBe(2)
      expect(refused.stderr).toContain('--upgrade')

      const upgraded = await runCli(['init-site', '--upgrade', '--no-skills'], dir)
      expect(upgraded.exitCode).toBe(0)

      const workflow = await fs.readFile(workflowPath, 'utf-8')
      expect(workflow).toContain('./ritual build-site --refresh auto')
      expect(workflow).not.toContain('--allow-refresh')
      expect((await readConfig(dir)).site?.version).toBe(ritualVersion)
    })
  })
})
