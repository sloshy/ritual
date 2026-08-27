import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'
import { version as ritualVersion } from '../../src/config/version'
import { renderSkillFile, SKILLS } from '../../src/skills/catalog'

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
      // The exact invocation, not the substring: 'detect-changes' also appears
      // as the step id and in the has-changes guard, so it cannot tell the
      // current command from the retired `git-detect-changes`.
      expect(workflow).toContain('./ritual detect-changes "$BEFORE"')
      expect(workflow).not.toContain('git-detect-changes')

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
          '--currency',
          'usd',
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
          '--currency',
          'usd',
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

  test('--no-change-detection is rejected with --deploy local-build, like --ci manual', async () => {
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
          '--no-change-detection',
          '--currency',
          'usd',
          '--no-skills',
        ],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--change-detection/--no-change-detection')
      expect(result.stderr).toContain('publish-for-me')
    })
  })

  test('re-running an up-to-date init is a friendly no-op, not an error', async () => {
    await withTempDir(async (dir) => {
      const init = await runCli(
        ['init-site', '--ci', 'manual', '--currency', 'usd', '--no-skills'],
        dir,
      )
      expect(init.exitCode).toBe(0)

      const rerun = await runCli(['init-site', '--no-skills'], dir)

      expect(rerun.exitCode).toBe(0)
      expect(rerun.stdout).toContain('Already initialized with the current version')
      expect(rerun.stdout).toContain('nothing to do')
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
    // The skills question is asked last, after the files are written, so its
    // missing flag is refused up front like the others — nothing is written.
    ['missing --skills', ['init-site', '--ci', 'manual', '--currency', 'usd'], '--skills'],
    [
      'missing --skills on --force',
      ['init-site', '--force', '--ci', 'manual', '--currency', 'usd'],
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

  test('an upgrade un-ignores the committed dist of an existing local-build scaffold', async () => {
    await withTempDir(async (dir) => {
      // The only delivery path for the un-ignore into an existing scaffold: a
      // local-build repo initialized before the fix commits its built site, but
      // its .gitignore still holds the `dist/` line an older init wrote, so the
      // deploy workflow publishes an empty site.
      await fs.writeFile(
        path.join(dir, 'ritual.config.json'),
        JSON.stringify({
          site: {
            version: '0.0.1',
            ciSystem: 'github-actions',
            deployMode: 'local-build',
            distDir: 'dist',
            detectChanges: false,
          },
        }),
      )
      await fs.writeFile(path.join(dir, '.gitignore'), 'cache/\ndist/\n')

      const upgraded = await runCli(['init-site', '--upgrade', '--no-skills'], dir)
      expect(upgraded.exitCode).toBe(0)

      const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')
      // The pre-existing `dist/` line stays (the file is only appended to), so
      // the un-ignore is what has to be there to override it.
      expect(gitignore).toContain('!dist/')
      // Build scratch directories are the one build residue left in a repo that
      // deliberately commits dist/.
      expect(gitignore).toContain('.dist-build-*')
    })
  })

  test('--upgrade without a skills flag refreshes installed skills and never prompts', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(
        path.join(dir, 'ritual.config.json'),
        JSON.stringify({
          site: {
            version: '0.0.1',
            ciSystem: 'manual',
            deployMode: 'publish-for-me',
            distDir: 'dist',
            detectChanges: false,
          },
        }),
      )
      // One skill installed by an older Ritual (machine-managed, stale
      // version marker); every other skill was never installed.
      const [installed, ...neverInstalled] = SKILLS
      if (!installed || neverInstalled.length === 0) throw new Error('catalog too small')
      const skillPath = path.join(dir, '.claude', 'skills', installed.name, 'SKILL.md')
      await fs.mkdir(path.dirname(skillPath), { recursive: true })
      await fs.writeFile(
        skillPath,
        renderSkillFile(installed).replace(
          `ritual-version: ${ritualVersion}`,
          'ritual-version: 0.0.1',
        ),
      )

      // The upgrade path answers the skills question itself (refresh what is
      // installed), so no --skills/--no-skills flag is needed headless.
      const upgraded = await runCli(['init-site', '--upgrade'], dir)
      expect(upgraded.exitCode).toBe(0)
      expect(upgraded.stderr).not.toContain('--skills')

      expect(await fs.readFile(skillPath, 'utf-8')).toContain(`ritual-version: ${ritualVersion}`)
      for (const skill of neverInstalled) {
        const absentPath = path.join(dir, '.claude', 'skills', skill.name, 'SKILL.md')
        expect(await Bun.file(absentPath).exists()).toBeFalse()
      }
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
