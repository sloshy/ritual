import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'
import { REFRESH_DUE_CONFIG } from '../helpers/migrations'
import { snapshotTree } from '../helpers/workspace'
import { latestMigrationId } from '../../src/migrate/migrations'

/**
 * Headless `init-site` runs in synthetic directories. runCli's stdin is not a
 * TTY, so every value must come from a flag — any prompt that would fire is a
 * usage error naming the missing flag.
 */

type SiteConfigFile = {
  site?: {
    ciSystem?: string
    deployMode?: string
    distDir?: string
    detectChanges?: boolean
  }
  defaultPriceSource?: string
  priceSources?: string[]
  managed?: { version?: string; migration: number; output?: string }
}

async function readConfig(dir: string): Promise<SiteConfigFile> {
  return JSON.parse(await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8'))
}

const workflowRelPath = path.join('.github', 'workflows', 'deploy-site.yml')

describe('init-site CLI (Integration)', () => {
  test('a fully-flagged headless publish-for-me init writes every file without prompting', async () => {
    await withTempDir(async (dir) => {
      // A store list that does not already hold the chosen store, and whose
      // one entry sorts *after* it — so appending and canonical insertion differ.
      await fs.writeFile(
        path.join(dir, 'ritual.config.json'),
        JSON.stringify({ priceSources: ['cardkingdom'] }),
      )
      const result = await runCli(
        [
          'init-site',
          '--ci',
          'github-actions',
          '--deploy',
          'publish-for-me',
          '--change-detection',
          '--price-source',
          'cardmarket',
          '--no-skills',
        ],
        dir,
      )

      expect(result.exitCode).toBe(0)

      const workflow = await fs.readFile(path.join(dir, workflowRelPath), 'utf-8')
      expect(workflow).toContain('./ritual build-site --refresh auto')
      expect(workflow).not.toContain('--allow-refresh')
      // CI downloads the release pinned in the config, not "whatever is newest".
      expect(workflow).toContain(`jq -r '.managed.version // empty' ritual.config.json`)
      // The exact invocation, not the substring: 'detect-changes' also appears
      // as the step id and in the has-changes guard, so it cannot tell the
      // current command from the retired `git-detect-changes`.
      expect(workflow).toContain('./ritual detect-changes "$BEFORE"')
      expect(workflow).not.toContain('git-detect-changes')

      const config = await readConfig(dir)
      expect(config.site).toMatchObject({
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: true,
      })
      // A fresh init is current by construction: every migration applied and
      // the output just generated recorded.
      expect(config.managed?.migration).toBe(latestMigrationId())
      expect(config.managed?.output).toMatch(/^sha256:/)
      expect(config.defaultPriceSource).toBe('cardmarket')
      // Choosing a store the sites did not offer enables it, in canonical order.
      expect(config.priceSources).toEqual(['cardmarket', 'cardkingdom'])

      expect(await Bun.file(path.join(dir, 'README.md')).exists()).toBeTrue()
      const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')
      expect(gitignore).toContain('cache/')
      // Server-written exports (POST /api/export with write: true) land here.
      expect(gitignore).toContain('exports/')
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
          '--price-source',
          'tcgplayer',
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

  test('a local-build init generates a README and .gitignore that agree', async () => {
    await withTempDir(async (dir) => {
      // The default dist dir with the deploy mode that commits it: the README
      // said "commit dist/" while the .gitignore in the same run ignored it.
      const result = await runCli(
        [
          'init-site',
          '--ci',
          'github-actions',
          '--deploy',
          'local-build',
          '--dist-dir',
          'dist',
          '--price-source',
          'tcgplayer',
          '--no-skills',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)

      const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf-8')
      const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')
      const ignored = gitignore
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))

      expect(readme).toContain('Commit the built `dist` directory')
      expect(ignored).not.toContain('dist/')
      expect(ignored).toContain('!dist/')
      // The layout section must not call the committed directory gitignored.
      expect(readme).not.toContain('`cache/`, `dist/`')
    })
  })

  test('a local-build init with a custom dist dir renders --out-dir everywhere', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        [
          'init-site',
          '--ci',
          'github-actions',
          '--deploy',
          'local-build',
          '--dist-dir',
          'out',
          '--price-source',
          'tcgplayer',
          '--no-skills',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)

      const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf-8')
      const workflow = await fs.readFile(path.join(dir, workflowRelPath), 'utf-8')
      // The workflow uploads `out`, so every instruction must build into `out`.
      expect(workflow).toContain('path: out')
      expect(readme).toContain('ritual build-site --out-dir out')
      expect(readme).toContain('ritual serve --build --out-dir out')
      expect(readme).not.toMatch(/```sh\nritual build-site\n/)
      expect(result.stdout).toContain('ritual build-site --out-dir out')
      expect(await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')).toContain('!out/')
    })
  })

  // Either form of each publish-for-me-only flag is refused: a silently
  // ignored `--no-…` is the bug these scope checks exist to prevent.
  test.each([
    ['--change-detection', '--change-detection/--no-change-detection'],
    ['--no-change-detection', '--change-detection/--no-change-detection'],
  ])('%s is rejected with --deploy local-build', async (flag, message) => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        [
          'init-site',
          '--ci',
          'github-actions',
          '--deploy',
          'local-build',
          '--dist-dir',
          'dist',
          flag,
          '--price-source',
          'tcgplayer',
          '--no-skills',
        ],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain(message)
      expect(result.stderr).toContain('publish-for-me')
    })
  })

  test('re-running an up-to-date init is a friendly no-op, not an error', async () => {
    await withTempDir(async (dir) => {
      const init = await runCli(
        ['init-site', '--ci', 'manual', '--price-source', 'tcgplayer', '--no-skills'],
        dir,
      )
      expect(init.exitCode).toBe(0)
      const before = await snapshotTree(dir)

      const rerun = await runCli(['init-site', '--no-skills'], dir)

      expect(rerun.exitCode).toBe(0)
      expect(rerun.stdout).toContain('Already initialized and up to date')
      expect(await snapshotTree(dir)).toEqual(before)
    })
  })

  test('a headless manual init needs only --ci and --price-source', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['init-site', '--ci', 'manual', '--price-source', 'tcgplayer', '--no-skills'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      const config = await readConfig(dir)
      expect(config.site).toMatchObject({ ciSystem: 'manual' })
      // An already-enabled store leaves the list as it was.
      expect(config.priceSources).toEqual(['tcgplayer'])
      expect(await Bun.file(path.join(dir, 'README.md')).exists()).toBeTrue()
      expect(await Bun.file(path.join(dir, workflowRelPath)).exists()).toBeFalse()
    })
  })

  test.each([
    ['missing --ci', ['init-site', '--price-source', 'tcgplayer', '--no-skills'], '--ci'],
    [
      'missing --deploy',
      ['init-site', '--ci', 'github-actions', '--price-source', 'tcgplayer', '--no-skills'],
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
        '--price-source',
        'tcgplayer',
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
        '--price-source',
        'tcgplayer',
        '--no-skills',
      ],
      '--change-detection',
    ],
    ['missing --price-source', ['init-site', '--ci', 'manual', '--no-skills'], '--price-source'],
    // The skills question is asked last, after the files are written, so its
    // missing flag is refused up front like the others — nothing is written.
    [
      'missing --skills',
      ['init-site', '--ci', 'manual', '--price-source', 'tcgplayer'],
      '--skills',
    ],
    [
      'missing --skills on --force',
      ['init-site', '--force', '--ci', 'manual', '--price-source', 'tcgplayer'],
      '--skills',
    ],
  ])('a headless init with a %s is a usage error naming the flag', async (_name, args, flag) => {
    await withTempDir(async (dir) => {
      const result = await runCli(args, dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain(flag)
      // Nothing was initialized. (The CLI bootstrap may create a default
      // ritual.config.json, but never the site block.)
      expect((await readConfig(dir).catch((): SiteConfigFile => ({}))).site).toBeUndefined()
      expect(await Bun.file(path.join(dir, workflowRelPath)).exists()).toBeFalse()
      expect(await Bun.file(path.join(dir, 'README.md')).exists()).toBeFalse()
      expect(await Bun.file(path.join(dir, '.gitignore')).exists()).toBeFalse()
    })
  })

  test('an invalid --ci value is rejected at parse time', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['init-site', '--ci', 'jenkins'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Invalid --ci 'jenkins'")
    })
  })

  test.each([[['--deploy', 'publish-for-me']], [['--change-detection']]])(
    'GitHub Actions flag %p is rejected with --ci manual',
    async (flag) => {
      await withTempDir(async (dir) => {
        const result = await runCli(
          ['init-site', '--ci', 'manual', ...flag, '--price-source', 'tcgplayer', '--no-skills'],
          dir,
        )

        expect(result.exitCode).toBe(2)
        expect(result.stderr).toContain('--ci github-actions')
      })
    },
  )

  test('an existing README without a decision flag is a headless usage error', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'README.md'), 'my own readme\n')

      const result = await runCli(
        ['init-site', '--ci', 'manual', '--price-source', 'tcgplayer', '--no-skills'],
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
          '--price-source',
          'tcgplayer',
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
        ['init-site', '--force', '--ci', 'manual', '--price-source', 'tcgplayer', '--no-skills'],
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
        ['init-site', '--ci', 'manual', '--price-source', 'tcgplayer', '--no-skills'],
        dir,
      )
      expect(init.exitCode).toBe(0)

      const result = await runCli(['init-site', '--ci', 'github-actions', '--no-skills'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('already initialized')
      expect(result.stderr).toContain('--force')
    })
  })

  test('a re-run with pending updates points at migrate and writes nothing', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'ritual.config.json'), JSON.stringify(REFRESH_DUE_CONFIG))
      const before = await snapshotTree(dir)

      const rerun = await runCli(['init-site'], dir)

      expect(rerun.exitCode).toBe(0)
      expect(rerun.stdout).toContain('ritual migrate')
      expect(await snapshotTree(dir)).toEqual(before)
    })
  })

  test('a re-run on a workspace a newer Ritual updated is refused like migrate refuses it', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(
        path.join(dir, 'ritual.config.json'),
        JSON.stringify({ site: { ciSystem: 'manual' }, managed: { migration: 99 } }),
      )

      const rerun = await runCli(['init-site'], dir)

      expect(rerun.exitCode).toBe(1)
      expect(rerun.stderr).toContain('Run `ritual self-update` to install a newer Ritual')
    })
  })
})
