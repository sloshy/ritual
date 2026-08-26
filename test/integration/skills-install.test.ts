import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getBaseDir, setBaseDir } from '../../src/config/base-dir'
import { maybeInstallSkills, refreshSkillsOnUpgrade } from '../../src/commands/init-site'
import { SKILLS, renderSkillFile } from '../../src/skills/catalog'
import { installSkills, refreshInstalledSkills, resolveSkillsDir } from '../../src/skills/install'
import { fileExists } from '../../src/util/fs'
import { runCli, withTempDir } from './helpers/cli'

/**
 * Re-stamp rendered `SKILL.md` content with a fake old `ritual-version`. The
 * content hash deliberately excludes the marker lines, so the result is still
 * machine-managed — exactly what a file installed by an older Ritual looks
 * like. Throws if no marker was found (the simulation would silently test
 * nothing).
 */
function withFakeOldVersion(rendered: string): string {
  const stale = rendered.replace(/^ritual-version: .+$/m, 'ritual-version: 0.0.1-old')
  if (stale === rendered) throw new Error('expected a ritual-version marker to replace')
  return stale
}

/** Run `fn` with console.log captured, returning everything it printed. */
async function captureConsoleLog(fn: () => Promise<void>): Promise<string> {
  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  try {
    await fn()
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n')
  } finally {
    logSpy.mockRestore()
  }
}

describe('resolveSkillsDir', () => {
  test('targets a project .claude/skills under the given dir', () => {
    expect(resolveSkillsDir({ dir: '/tmp/workspace' })).toBe(
      path.join('/tmp/workspace', '.claude', 'skills'),
    )
  })

  test('targets ~/.claude/skills when global', () => {
    expect(resolveSkillsDir({ global: true })).toBe(path.join(os.homedir(), '.claude', 'skills'))
  })
})

describe('installSkills (Integration)', () => {
  test('writes every skill to its own SKILL.md with rendered content', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      const results = await installSkills(SKILLS, skillsDir, { force: false })

      expect(results.map((r) => r.status)).toEqual(SKILLS.map(() => 'written'))

      for (const [index, skill] of SKILLS.entries()) {
        const filePath = path.join(skillsDir, skill.name, 'SKILL.md')
        expect(results[index]?.path).toBe(filePath)
        const written = await fs.readFile(filePath, 'utf-8')
        expect(written).toBe(renderSkillFile(skill))
      }
    })
  })

  test('reports a mixed written/up-to-date result set without halting iteration', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      const [a, b, c] = SKILLS

      // Pre-install only the middle skill: unedited at the current version, a
      // re-install reports it up-to-date rather than rewriting or skipping it.
      await installSkills([b!], skillsDir, { force: false })

      const results = await installSkills([a!, b!, c!], skillsDir, { force: false })
      expect(results.map((r) => r.status)).toEqual(['written', 'up-to-date', 'written'])
    })
  })

  test('re-running an install reports every unmodified skill as up-to-date', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      await installSkills(SKILLS, skillsDir, { force: false })

      const results = await installSkills(SKILLS, skillsDir, { force: false })
      expect(results.map((r) => r.status)).toEqual(SKILLS.map(() => 'up-to-date'))
    })
  })

  test('skips user-edited files unless forced, then force overwrites', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      const [first] = SKILLS
      const filePath = path.join(skillsDir, first!.name, 'SKILL.md')

      await installSkills([first!], skillsDir, { force: false })
      await fs.writeFile(filePath, 'edited by the user', 'utf-8')

      const skipped = await installSkills([first!], skillsDir, { force: false })
      expect(skipped[0]?.status).toBe('skipped')
      expect(await fs.readFile(filePath, 'utf-8')).toBe('edited by the user')

      const forced = await installSkills([first!], skillsDir, { force: true })
      expect(forced[0]?.status).toBe('written')
      expect(await fs.readFile(filePath, 'utf-8')).toBe(renderSkillFile(first!))
    })
  })

  test('rewrites a machine-managed install from another version without force', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      const [first] = SKILLS
      const filePath = path.join(skillsDir, first!.name, 'SKILL.md')

      await installSkills([first!], skillsDir, { force: false })
      await fs.writeFile(filePath, withFakeOldVersion(renderSkillFile(first!)), 'utf-8')

      const results = await installSkills([first!], skillsDir, { force: false })
      expect(results[0]?.status).toBe('written')
      expect(await fs.readFile(filePath, 'utf-8')).toBe(renderSkillFile(first!))
    })
  })
})

describe('refreshInstalledSkills (Integration)', () => {
  test('updates stale skills, protects user edits, and leaves absent ones uninstalled', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      const [stale, edited, absent] = SKILLS

      // One machine-managed install from an older version, one user-edited file.
      const stalePath = path.join(skillsDir, stale!.name, 'SKILL.md')
      const editedPath = path.join(skillsDir, edited!.name, 'SKILL.md')
      await installSkills([stale!, edited!], skillsDir, { force: false })
      await fs.writeFile(stalePath, withFakeOldVersion(renderSkillFile(stale!)), 'utf-8')
      await fs.writeFile(editedPath, 'my local notes', 'utf-8')

      const results = await refreshInstalledSkills([stale!, edited!, absent!], skillsDir, {
        force: false,
      })

      expect(results.map((r) => r.status)).toEqual(['written', 'skipped', 'absent'])

      // The stale machine-managed skill is refreshed to current content...
      expect(await fs.readFile(stalePath, 'utf-8')).toBe(renderSkillFile(stale!))
      // ...the user-edited one survives untouched...
      expect(await fs.readFile(editedPath, 'utf-8')).toBe('my local notes')
      // ...and the never-installed skill stays absent.
      expect(await fileExists(path.join(skillsDir, absent!.name, 'SKILL.md'))).toBe(false)
    })
  })

  test('reports up-to-date installs without rewriting them', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      const [skill] = SKILLS

      await installSkills([skill!], skillsDir, { force: false })
      const results = await refreshInstalledSkills([skill!], skillsDir, { force: false })
      expect(results.map((r) => r.status)).toEqual(['up-to-date'])
    })
  })

  test('force overwrites user-edited skills but still never installs absent ones', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      const [edited, absent] = SKILLS
      const editedPath = path.join(skillsDir, edited!.name, 'SKILL.md')

      await installSkills([edited!], skillsDir, { force: false })
      await fs.writeFile(editedPath, 'my local notes', 'utf-8')

      const results = await refreshInstalledSkills([edited!, absent!], skillsDir, { force: true })

      expect(results.map((r) => r.status)).toEqual(['written', 'absent'])
      expect(await fs.readFile(editedPath, 'utf-8')).toBe(renderSkillFile(edited!))
      expect(await fileExists(path.join(skillsDir, absent!.name, 'SKILL.md'))).toBe(false)
    })
  })
})

describe('ritual skills command (Integration)', () => {
  test('list prints the available skill names', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['skills', 'list'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('ritual-decks')
      expect(result.stdout).toContain('ritual-site')
    })
  })

  test('list --output json emits every skill as { name, description }', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['skills', 'list', '--output', 'json'], dir)
      expect(result.exitCode).toBe(0)

      const entries = JSON.parse(result.stdout) as { name: string; description: string }[]
      // The full catalog is present, in catalog order, with non-empty descriptions.
      expect(entries.map((entry) => entry.name)).toEqual(SKILLS.map((skill) => skill.name))
      for (const entry of entries) {
        expect(entry.description.length).toBeGreaterThan(0)
      }
    })
  })

  test('install writes skills under the workspace .claude/skills', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['skills', 'install'], dir)
      expect(result.exitCode).toBe(0)

      const overview = path.join(dir, '.claude', 'skills', 'ritual', 'SKILL.md')
      // The CLI must write the exact rendered content the catalog produces.
      expect(await fs.readFile(overview, 'utf-8')).toBe(renderSkillFile(SKILLS[0]!))
    })
  })

  test('install writes only the named skill', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['skills', 'install', 'ritual-decks'], dir)
      expect(result.exitCode).toBe(0)

      const decks = path.join(dir, '.claude', 'skills', 'ritual-decks', 'SKILL.md')
      expect(await fs.readFile(decks, 'utf-8')).toContain('name: ritual-decks')

      // The unnamed overview skill must not have been installed.
      const overview = path.join(dir, '.claude', 'skills', 'ritual', 'SKILL.md')
      expect(await fileExists(overview)).toBe(false)
    })
  })

  test('install --output json reports the skills dir and per-skill results with absolute paths', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['skills', 'install', '--output', 'json'], dir)
      expect(result.exitCode).toBe(0)

      // stdout is pure JSON (parse would fail if the glyph chatter leaked in).
      const report = JSON.parse(result.stdout) as {
        skillsDir: string
        results: { name: string; path: string; status: string }[]
      }
      // Absolute paths, never the display-relative form used in text mode.
      expect(path.isAbsolute(report.skillsDir)).toBe(true)
      expect(report.skillsDir.endsWith(path.join('.claude', 'skills'))).toBe(true)
      expect(report.results.map((r) => r.name)).toEqual(SKILLS.map((skill) => skill.name))
      for (const entry of report.results) {
        expect(entry.status).toBe('written')
        expect(path.isAbsolute(entry.path)).toBe(true)
        expect(entry.path.startsWith(report.skillsDir)).toBe(true)
      }
    })
  })

  test('install --quiet suppresses the text chatter but still writes the skills', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['skills', 'install', '--quiet'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(await fileExists(path.join(dir, '.claude', 'skills', 'ritual', 'SKILL.md'))).toBe(true)
    })
  })

  test('install rejects an unknown skill name', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['skills', 'install', 'ritual-bogus'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Unknown skill')
    })
  })

  test('installs the same English skill files under a non-English UI locale', async () => {
    await withTempDir(async (dir) => {
      // Skill content is English by contract (plan §11): it is model-facing
      // prose, and `ritual-content-hash` decides machine-managed vs user-edited
      // at one fixed path — a per-locale body would make every install look
      // edited the moment the reader's language changed.
      const english = await runCli(['skills', 'install', 'ritual', 'ritual-site'], dir)
      expect(english.exitCode).toBe(0)
      const paths = ['ritual', 'ritual-site'].map((name) =>
        path.join(dir, '.claude', 'skills', name, 'SKILL.md'),
      )
      const installed = await Promise.all(paths.map((file) => fs.readFile(file, 'utf-8')))

      // `--force` so the files are genuinely rewritten rather than reported
      // up-to-date: an unchanged file proves nothing about what would be written.
      const pseudo = await runCli(['skills', 'install', 'ritual', 'ritual-site', '--force'], dir, {
        RITUAL_LOCALE: 'en-XA',
      })
      expect(pseudo.exitCode).toBe(0)
      for (const [index, file] of paths.entries()) {
        expect(await fs.readFile(file, 'utf-8')).toBe(installed[index]!)
      }

      // Vacuity guard: the *command's* own status lines do follow the locale,
      // so the run really did happen in en-XA — the files above are unchanged
      // because their content is fenced, not because the flag did nothing.
      // Matched on the pseudo-locale's actual signature — a bracketed run holding
      // an accented substitute — rather than on a bare `[`, which any future
      // English status line carrying a `[dry-run]` prefix or an `[n/m]` counter
      // would trip over for a reason unrelated to localization.
      expect(pseudo.stdout).toMatch(/\[[^[\]]*[\u0100-\u024f\u1e00-\u1eff][^[\]]*\]/)
      expect(english.stdout).not.toMatch(/\[[^[\]]*[\u0100-\u024f\u1e00-\u1eff][^[\]]*\]/)
    })
  })

  test('re-running install reports up-to-date and preserves the installed bytes', async () => {
    await withTempDir(async (dir) => {
      await runCli(['skills', 'install', 'ritual-decks'], dir)
      const decksPath = path.join(dir, '.claude', 'skills', 'ritual-decks', 'SKILL.md')
      const installed = await fs.readFile(decksPath, 'utf-8')

      const result = await runCli(['skills', 'install', 'ritual-decks', '--output', 'json'], dir)
      expect(result.exitCode).toBe(0)
      const report = JSON.parse(result.stdout) as { results: { status: string }[] }
      expect(report.results.map((r) => r.status)).toEqual(['up-to-date'])
      expect(await fs.readFile(decksPath, 'utf-8')).toBe(installed)
    })
  })
})

describe('ritual skills update command (Integration)', () => {
  test('refreshes a stale installed skill but never installs missing ones', async () => {
    await withTempDir(async (dir) => {
      await runCli(['skills', 'install', 'ritual-decks'], dir)
      const decksPath = path.join(dir, '.claude', 'skills', 'ritual-decks', 'SKILL.md')
      // Compare against the CLI's own install output so the expectation cannot
      // drift from the binary's compiled-in version.
      const current = await fs.readFile(decksPath, 'utf-8')
      await fs.writeFile(decksPath, withFakeOldVersion(current), 'utf-8')

      const result = await runCli(['skills', 'update'], dir)
      expect(result.exitCode).toBe(0)

      // The stale skill is rewritten with the current render...
      expect(await fs.readFile(decksPath, 'utf-8')).toBe(current)
      // ...and no other skill is introduced by an update.
      const overview = path.join(dir, '.claude', 'skills', 'ritual', 'SKILL.md')
      expect(await fileExists(overview)).toBe(false)
    })
  })

  test('skips user-edited skills unless --force overwrites them', async () => {
    await withTempDir(async (dir) => {
      await runCli(['skills', 'install', 'ritual-decks'], dir)
      const decksPath = path.join(dir, '.claude', 'skills', 'ritual-decks', 'SKILL.md')
      const installed = await fs.readFile(decksPath, 'utf-8')
      await fs.writeFile(decksPath, 'my local notes', 'utf-8')

      const skipped = await runCli(['skills', 'update', 'ritual-decks'], dir)
      expect(skipped.exitCode).toBe(0)
      expect(skipped.stdout).toContain('--force')
      expect(await fs.readFile(decksPath, 'utf-8')).toBe('my local notes')

      const forced = await runCli(['skills', 'update', 'ritual-decks', '--force'], dir)
      expect(forced.exitCode).toBe(0)
      expect(await fs.readFile(decksPath, 'utf-8')).toBe(installed)
    })
  })

  test('update --output json reports per-skill statuses including absent', async () => {
    await withTempDir(async (dir) => {
      await runCli(['skills', 'install', 'ritual-decks'], dir)

      const result = await runCli(['skills', 'update', '--output', 'json'], dir)
      expect(result.exitCode).toBe(0)

      const report = JSON.parse(result.stdout) as {
        skillsDir: string
        results: { name: string; path: string; status: string }[]
      }
      expect(path.isAbsolute(report.skillsDir)).toBe(true)
      expect(report.results.map((r) => r.name)).toEqual(SKILLS.map((skill) => skill.name))
      for (const entry of report.results) {
        expect(entry.status).toBe(entry.name === 'ritual-decks' ? 'up-to-date' : 'absent')
      }

      // The absent skills were reported, not installed.
      const overview = path.join(dir, '.claude', 'skills', 'ritual', 'SKILL.md')
      expect(await fileExists(overview)).toBe(false)
    })
  })

  test('update rejects an unknown skill name', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['skills', 'update', 'ritual-bogus'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Unknown skill')
    })
  })

  test('update --global refreshes the HOME skills dir, protecting user edits', async () => {
    await withTempDir(async (dir) => {
      // os.homedir() honors HOME on POSIX, so a temp HOME keeps the test away
      // from the real ~/.claude/skills.
      const home = path.join(dir, 'home')
      await fs.mkdir(home, { recursive: true })
      const env = { HOME: home }

      const install = await runCli(
        ['skills', 'install', 'ritual-decks', 'ritual-cards', '--global'],
        dir,
        env,
      )
      expect(install.exitCode).toBe(0)

      const globalSkills = path.join(home, '.claude', 'skills')
      const stalePath = path.join(globalSkills, 'ritual-decks', 'SKILL.md')
      const editedPath = path.join(globalSkills, 'ritual-cards', 'SKILL.md')
      const current = await fs.readFile(stalePath, 'utf-8')
      await fs.writeFile(stalePath, withFakeOldVersion(current), 'utf-8')
      await fs.writeFile(editedPath, 'my global notes', 'utf-8')

      const result = await runCli(['skills', 'update', '--global'], dir, env)
      expect(result.exitCode).toBe(0)

      // The stale machine-managed global install is refreshed to current...
      expect(await fs.readFile(stalePath, 'utf-8')).toBe(current)
      // ...the user-edited one is left untouched...
      expect(await fs.readFile(editedPath, 'utf-8')).toBe('my global notes')
      // ...and nothing was written into the project directory.
      expect(await fileExists(path.join(dir, '.claude'))).toBe(false)
    })
  })
})

describe('init-site maybeInstallSkills (Integration)', () => {
  let originalBaseDir: string
  beforeEach(() => {
    originalBaseDir = getBaseDir()
  })
  afterEach(() => setBaseDir(originalBaseDir))

  test('installs every skill into the workspace .claude/skills when --skills is set', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      await maybeInstallSkills({ skills: true }, false)

      // Every skill lands under the base-dir's .claude/skills (the wiring under test)...
      for (const skill of SKILLS) {
        expect(await fileExists(path.join(dir, '.claude', 'skills', skill.name, 'SKILL.md'))).toBe(
          true,
        )
      }
      // ...with the exact rendered content (spot-checked; installSkills owns full fidelity).
      const overview = SKILLS[0]!
      const overviewPath = path.join(dir, '.claude', 'skills', overview.name, 'SKILL.md')
      expect(await fs.readFile(overviewPath, 'utf-8')).toBe(renderSkillFile(overview))
    })
  })

  test('overwrites an existing skill only when force is set', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      const skill = SKILLS[0]!
      const filePath = path.join(dir, '.claude', 'skills', skill.name, 'SKILL.md')

      await maybeInstallSkills({ skills: true }, false)
      await fs.writeFile(filePath, 'user edit', 'utf-8')

      // Without force, a user's edit is preserved — and reported as such.
      const output = await captureConsoleLog(() => maybeInstallSkills({ skills: true }, false))
      expect(await fs.readFile(filePath, 'utf-8')).toBe('user edit')
      expect(output).toContain('1 Ritual agent skill with local edits left untouched')

      // With force, it is rewritten with the current rendered content.
      await maybeInstallSkills({ skills: true }, true)
      expect(await fs.readFile(filePath, 'utf-8')).toBe(renderSkillFile(skill))
    })
  })

  test('a rerun over a current unmodified install reports every skill as up to date', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      await maybeInstallSkills({ skills: true }, false)

      // The regression this pins: an all-up-to-date rerun used to print
      // nothing at all, leaving no confirmation that skills were checked.
      const output = await captureConsoleLog(() => maybeInstallSkills({ skills: true }, false))
      expect(output).toContain(`${SKILLS.length} Ritual agent skills already up to date`)
      expect(output).not.toContain('Installed')
    })
  })

  test('writes nothing when --no-skills is set', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      await maybeInstallSkills({ skills: false }, false)
      expect(await fileExists(path.join(dir, '.claude'))).toBe(false)
    })
  })
})

describe('init-site refreshSkillsOnUpgrade (Integration)', () => {
  let originalBaseDir: string
  beforeEach(() => {
    originalBaseDir = getBaseDir()
  })
  afterEach(() => setBaseDir(originalBaseDir))

  test('refreshes installed skills but does not introduce uninstalled ones', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      const skillsDir = path.join(dir, '.claude', 'skills')
      const [installed, notInstalled] = SKILLS

      // Install one skill and let it go stale (a machine-managed file from an
      // older Ritual), simulating a pre-upgrade repo.
      const installedPath = path.join(skillsDir, installed!.name, 'SKILL.md')
      await installSkills([installed!], skillsDir, { force: false })
      await fs.writeFile(installedPath, withFakeOldVersion(renderSkillFile(installed!)), 'utf-8')

      await refreshSkillsOnUpgrade({})

      expect(await fs.readFile(installedPath, 'utf-8')).toBe(renderSkillFile(installed!))
      expect(await fileExists(path.join(skillsDir, notInstalled!.name, 'SKILL.md'))).toBe(false)
    })
  })

  test('preserves user-edited skills during an upgrade refresh', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      const skillsDir = path.join(dir, '.claude', 'skills')
      const skill = SKILLS[0]!
      const filePath = path.join(skillsDir, skill.name, 'SKILL.md')

      await installSkills([skill], skillsDir, { force: false })
      await fs.writeFile(filePath, 'my local notes', 'utf-8')

      await refreshSkillsOnUpgrade({})

      expect(await fs.readFile(filePath, 'utf-8')).toBe('my local notes')
    })
  })

  test('does nothing when no skills are installed', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      await refreshSkillsOnUpgrade({})
      expect(await fileExists(path.join(dir, '.claude'))).toBe(false)
    })
  })

  test('--no-skills skips the refresh', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      const skillsDir = path.join(dir, '.claude', 'skills')
      const skill = SKILLS[0]!
      const filePath = path.join(skillsDir, skill.name, 'SKILL.md')

      await installSkills([skill], skillsDir, { force: false })
      await fs.writeFile(filePath, 'stale content', 'utf-8')

      await refreshSkillsOnUpgrade({ skills: false })
      expect(await fs.readFile(filePath, 'utf-8')).toBe('stale content')
    })
  })

  test('--skills force-installs the full set, overwriting stale skills and adding missing ones', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      const skillsDir = path.join(dir, '.claude', 'skills')
      const installed = SKILLS[0]!

      // Pre-install one skill and tamper with it; leave the rest uninstalled.
      const installedPath = path.join(skillsDir, installed.name, 'SKILL.md')
      await installSkills([installed], skillsDir, { force: false })
      await fs.writeFile(installedPath, 'stale content', 'utf-8')

      await refreshSkillsOnUpgrade({ skills: true })

      // The tampered skill is force-overwritten with current rendered content...
      expect(await fs.readFile(installedPath, 'utf-8')).toBe(renderSkillFile(installed))
      // ...and the full set is installed, including skills never present before.
      for (const skill of SKILLS) {
        expect(await fileExists(path.join(skillsDir, skill.name, 'SKILL.md'))).toBe(true)
      }
    })
  })
})
