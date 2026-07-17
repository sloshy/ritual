import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getBaseDir, setBaseDir } from '../../src/base-dir'
import { maybeInstallSkills, refreshSkillsOnUpgrade } from '../../src/commands/init-site'
import { SKILLS, renderSkillFile } from '../../src/skills/catalog'
import { installSkills, refreshInstalledSkills, resolveSkillsDir } from '../../src/skills/install'
import { fileExists } from '../../src/utils'
import { runCli, withTempDir } from './helpers/cli'

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

  test('reports a mixed written/skipped result set without halting iteration', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      const [a, b, c] = SKILLS

      // Pre-install only the middle skill so the second install sees one conflict.
      await installSkills([b!], skillsDir, { force: false })

      const results = await installSkills([a!, b!, c!], skillsDir, { force: false })
      expect(results.map((r) => r.status)).toEqual(['written', 'skipped', 'written'])
    })
  })

  test('skips existing files unless forced, then force overwrites', async () => {
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
})

describe('refreshInstalledSkills (Integration)', () => {
  test('overwrites present skills and leaves absent ones uninstalled', async () => {
    await withTempDir(async (dir) => {
      const skillsDir = path.join(dir, '.claude', 'skills')
      const [present, absent] = SKILLS

      // Install one skill, then tamper with it so a refresh has something to restore.
      const presentPath = path.join(skillsDir, present!.name, 'SKILL.md')
      await installSkills([present!], skillsDir, { force: false })
      await fs.writeFile(presentPath, 'stale content', 'utf-8')

      const results = await refreshInstalledSkills([present!, absent!], skillsDir)

      expect(results.find((r) => r.name === present!.name)?.status).toBe('written')
      expect(results.find((r) => r.name === absent!.name)?.status).toBe('absent')

      // The installed skill is refreshed to current content...
      expect(await fs.readFile(presentPath, 'utf-8')).toBe(renderSkillFile(present!))
      // ...and the never-installed skill stays absent.
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

  test('install rejects an unknown skill name', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['skills', 'install', 'ritual-bogus'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Unknown skill')
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

      // Without force, a user's edit is preserved.
      await maybeInstallSkills({ skills: true }, false)
      expect(await fs.readFile(filePath, 'utf-8')).toBe('user edit')

      // With force, it is rewritten with the current rendered content.
      await maybeInstallSkills({ skills: true }, true)
      expect(await fs.readFile(filePath, 'utf-8')).toBe(renderSkillFile(skill))
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

      // Install one skill and let it go stale, simulating a pre-upgrade repo.
      const installedPath = path.join(skillsDir, installed!.name, 'SKILL.md')
      await installSkills([installed!], skillsDir, { force: false })
      await fs.writeFile(installedPath, 'stale content', 'utf-8')

      await refreshSkillsOnUpgrade({})

      expect(await fs.readFile(installedPath, 'utf-8')).toBe(renderSkillFile(installed!))
      expect(await fileExists(path.join(skillsDir, notInstalled!.name, 'SKILL.md'))).toBe(false)
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
