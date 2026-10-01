import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  applyMigration,
  hasPendingWork,
  planMigration,
  type BuildIdentity,
  type MigrateOptions,
  type MigrationPlan,
} from '../../src/migrate/runner'
import { computeManagedOutput, refreshChangesFiles } from '../../src/migrate/managed-output'
import { latestMigrationId, MIGRATIONS } from '../../src/migrate/migrations'
import type { Migration, MigrationContext, MigrationOp } from '../../src/migrate/types'
import {
  getDefaultRitualConfig,
  type GitHubActionsSiteConfig,
  type ManagedConfig,
  type RitualConfig,
} from '../../src/config/ritual-config'
import { renderSkillFile, SKILLS } from '../../src/skills/catalog'
import { skillFilePath } from '../../src/skills/install'
import type { RitualSkill } from '../../src/skills/types'
import { CardCommandError, hasErrorCode } from '../../src/util/errors'
import { fileExists } from '../../src/util/fs'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

const DEV_BUILD: BuildIdentity = { version: '0.0.0-dev.abc', release: false }

const PUBLISH_SITE = {
  ciSystem: 'github-actions',
  deployMode: 'publish-for-me',
  distDir: 'dist',
  detectChanges: false,
} as const satisfies GitHubActionsSiteConfig

const WORKFLOW = '.github/workflows/deploy-site.yml'

let ws: BoundWorkspace | null = null

afterEach(async () => {
  await ws?.dispose()
  ws = null
})

async function workspace(config: Record<string, unknown> | false): Promise<string> {
  ws = await bindWorkspace({ dirs: [], config })
  return ws.dir
}

async function readConfig(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8'))
}

/** Plan as a dev build (unless overridden), expecting a plan rather than a refusal. */
async function plan(options: MigrateOptions = {}): Promise<MigrationPlan> {
  const outcome = await planMigration({ build: DEV_BUILD, ...options })
  if (outcome.kind !== 'plan') throw new Error(`expected a plan, got ${outcome.kind}`)
  return outcome
}

/** A test migration that plans a fixed op list whenever it runs. */
function fixedMigration(id: number, ops: MigrationOp[]): Migration {
  return {
    id,
    descriptionKey: 'cli.migrate.migration.dropSiteVersion',
    applies: () => true,
    plan: () => Promise.resolve(ops),
  }
}

/** The effective config a raw file object loads as, for computing its expected output hash. */
function configWithSite(site: Record<string, unknown>): RitualConfig {
  return { ...getDefaultRitualConfig(), site: site as RitualConfig['site'] }
}

function outputHash(site: Record<string, unknown>): string | undefined {
  return computeManagedOutput(configWithSite(site))?.hash
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  )
}

describe('MIGRATIONS', () => {
  test('ids are unique and run 1, 2, 3, … in list order', () => {
    expect(MIGRATIONS.map((migration) => migration.id)).toEqual(
      MIGRATIONS.map((_migration, index) => index + 1),
    )
  })
})

describe('migration 1: drop site.version', () => {
  test('plans the delete, applies it, stamps managed, and re-plans to nothing', async () => {
    const dir = await workspace({ site: { ...PUBLISH_SITE, version: '0.1.0' } })

    const pending = await plan()
    expect(pending.migrations.map((m) => [m.migration.id, m.ops])).toEqual([
      [1, [{ type: 'config-delete', path: ['site', 'version'] }]],
      [2, []],
    ])
    expect(hasPendingWork(pending)).toBeTrue()

    await applyMigration(pending)

    const config = await readConfig(dir)
    expect(config.site).toEqual(PUBLISH_SITE)
    expect(config.managed).toEqual({
      migration: latestMigrationId(),
      output: outputHash(PUBLISH_SITE),
    })
    expect(hasPendingWork(await plan())).toBeFalse()
  })

  test('an already-satisfied migration plans zero ops even with the counter at 0', async () => {
    await workspace({ site: { includeDecks: ['*'] } })
    const pending = await plan()
    expect(pending.migrations.map((m) => m.ops)).toEqual([[], []])
    // No deploy config means nothing is managed, so there is nothing to do.
    expect(pending.refresh).toBeNull()
    expect(hasPendingWork(pending)).toBeFalse()
  })
})

describe('migration 2: drop site.prerelease', () => {
  test.each([true, false, null])(
    'plans the delete when the key is present, whatever its value (%p)',
    async (prerelease) => {
      await workspace({ site: { ...PUBLISH_SITE, prerelease }, managed: { migration: 1 } })
      const pending = await plan()
      expect(pending.migrations.map((m) => [m.migration.id, m.ops])).toEqual([
        [2, [{ type: 'config-delete', path: ['site', 'prerelease'] }]],
      ])
    },
  )

  test('plans nothing for a site block without the key', async () => {
    await workspace({ site: PUBLISH_SITE, managed: { migration: 1 } })
    expect((await plan()).migrations.map((m) => [m.migration.id, m.ops])).toEqual([[2, []]])
  })
})

describe('pin bump', () => {
  const LOCAL_SITE = {
    ...PUBLISH_SITE,
    deployMode: 'local-build',
  } as const satisfies GitHubActionsSiteConfig
  const release = (version: string): BuildIdentity => ({ version, release: true })

  /** A workspace current in every respect except, possibly, its pin. */
  async function currentWorkspace(
    site: Record<string, unknown>,
    version: string | undefined,
  ): Promise<string> {
    const managed = {
      migration: latestMigrationId(),
      output: outputHash(site),
      ...(version === undefined ? {} : { version }),
    }
    return workspace({ site, managed })
  }

  test.each([
    ['a newer release than the pin', '1.0.0', release('1.1.0'), { to: '1.1.0', from: '1.0.0' }],
    ['a release and no pin yet', undefined, release('1.1.0'), { to: '1.1.0' }],
    [
      'a prerelease of the next version',
      '1.0.0',
      release('1.1.0-rc1'),
      { to: '1.1.0-rc1', from: '1.0.0' },
    ],
    ['the pinned release itself', '1.1.0', release('1.1.0'), null],
    ['a dev build', '1.0.0', DEV_BUILD, null],
  ])('publish-for-me with %s', async (_label, pinned, build, expected) => {
    await currentWorkspace(PUBLISH_SITE, pinned)
    const pending = await plan({ build })
    expect(pending.pinBump).toEqual(expected)
    expect(hasPendingWork(pending)).toBe(expected !== null)
  })

  test.each([
    ['local-build', LOCAL_SITE],
    ['manual', { ciSystem: 'manual' }],
    ['no deploy config', { includeDecks: ['*'] }],
  ])('is never pending for a %s workspace, yet the pin is stamped on a run', async (_l, site) => {
    await currentWorkspace(site, '1.0.0')
    const pending = await plan({ build: release('1.1.0') })
    expect(pending.pinBump).toBeNull()
    expect(hasPendingWork(pending)).toBeFalse()
    expect(pending.managed.version).toBe('1.1.0')
  })

  test('applying a bump-only plan stamps just managed.version', async () => {
    const dir = await currentWorkspace(PUBLISH_SITE, '1.0.0')
    const before = await readConfig(dir)

    const result = await applyMigration(await plan({ build: release('1.1.0') }))

    expect(result).toEqual({ applied: [], refresh: null })
    expect(await readConfig(dir)).toEqual({
      ...before,
      managed: { ...(before.managed as ManagedConfig), version: '1.1.0' },
    })
    expect(hasPendingWork(await plan({ build: release('1.1.0') }))).toBeFalse()
  })
})

describe('planMigration', () => {
  test('no config file means nothing to migrate', async () => {
    await workspace(false)
    expect(await planMigration()).toEqual({ kind: 'no-config' })
  })

  test('a workspace migrated past this build is refused with the recorded release', async () => {
    await workspace({ managed: { migration: 99, version: '1.4.0' } })
    expect(await planMigration({ build: DEV_BUILD })).toEqual({
      kind: 'ahead',
      applied: 99,
      latest: latestMigrationId(),
      version: '1.4.0',
    })
  })

  test('a release older than the recorded one is refused rather than downgrading the pin', async () => {
    await workspace({ site: PUBLISH_SITE, managed: { migration: 1, version: '1.4.0' } })
    const older: BuildIdentity = { version: '1.3.0', release: true }
    expect(await planMigration({ build: older })).toEqual({
      kind: 'ahead',
      applied: 1,
      latest: latestMigrationId(),
      version: '1.4.0',
    })
    // A dev build never records a version, so it has no pin to move backwards.
    expect((await plan()).managed.version).toBe('1.4.0')
  })

  test.each([
    ['a non-integer counter', { migration: 'one' }],
    ['a negative counter', { migration: -1 }],
    ['a null block', null],
    ['a malformed output hash', { migration: 0, output: 'not-a-hash' }],
    ['a malformed version', { migration: 0, version: 'latest' }],
  ])('%s never locks the workspace out', async (_label, managed) => {
    await workspace({ site: { ...PUBLISH_SITE, version: '0.1.0' }, managed })
    const pending = await plan()
    // The counter reads as 0 or better, so migration 1 is still planned by state.
    expect(pending.migrations.filter((m) => m.ops.length > 0).map((m) => m.migration.id)).toEqual([
      1,
    ])
    expect(pending.managed).toEqual({
      migration: latestMigrationId(),
      output: outputHash(PUBLISH_SITE),
    })
  })

  test('migrations fix raw keys the strict parser would reject', async () => {
    await workspace({ cacheSource: 'torrent' })
    const fix = fixedMigration(1, [
      { type: 'config-set', path: ['cacheSource'], value: 'scryfall' },
    ])
    expect(hasPendingWork(await plan({ migrations: [fix] }))).toBeTrue()
  })

  test('a config that would still be invalid is reported without a plan', async () => {
    await workspace({})
    const breaking = fixedMigration(1, [
      { type: 'config-set', path: ['cacheSource'], value: 'torrent' },
    ])
    const outcome = await planMigration({ migrations: [breaking], build: DEV_BUILD })
    expect(outcome.kind).toBe('invalid')
    if (outcome.kind === 'invalid') expect(outcome.error).toContain('cacheSource')
  })

  test('migrations run in id order, each planning against the config earlier ones leave', async () => {
    await workspace({})
    const first = fixedMigration(1, [{ type: 'config-set', path: ['decksDir'], value: './lists' }])
    const seen: unknown[] = []
    const second: Migration = {
      ...fixedMigration(2, []),
      plan: (ctx: MigrationContext): Promise<MigrationOp[]> => {
        seen.push(ctx.config.decksDir)
        return Promise.resolve([])
      },
    }
    const pending = await plan({ migrations: [second, first] })
    expect(pending.migrations.map((m) => m.migration.id)).toEqual([1, 2])
    expect(seen).toEqual(['./lists'])
  })

  test('a changed output hash makes a refresh due; a matching one does not', async () => {
    const current = outputHash(PUBLISH_SITE)
    await workspace({ site: PUBLISH_SITE, managed: { migration: 1, output: current } })
    expect((await plan()).refresh).toBeNull()

    const edited: RitualSkill[] = SKILLS.map((skill, i) =>
      i === 0 ? { ...skill, body: `${skill.body}\nOne more line.` } : skill,
    )
    const pending = await plan({ skills: edited })
    expect(pending.refresh).not.toBeNull()
    expect(pending.managed.output).not.toBe(current)
  })

  test('a refresh carries only the files that differ from disk', async () => {
    const dir = await workspace({ site: PUBLISH_SITE })
    const workflow = computeManagedOutput(configWithSite(PUBLISH_SITE))?.files[0]
    if (workflow === undefined) throw new Error('expected a generated workflow')
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true })
    await fs.writeFile(path.join(dir, WORKFLOW), workflow.content)
    await fs.writeFile(path.join(dir, '.gitignore'), computeGitignore())

    const pending = await plan()
    // Everything already matches: only the hash needs recording.
    expect(pending.refresh?.filesToWrite).toEqual([])
    expect(pending.refresh === null ? true : refreshChangesFiles(pending.refresh)).toBeFalse()
    expect(hasPendingWork(pending)).toBeTrue()
  })

  test('only a release build records its version', async () => {
    await workspace({ site: PUBLISH_SITE, managed: { migration: 1, version: '1.0.0' } })
    expect((await plan()).managed.version).toBe('1.0.0')
    expect((await plan({ build: { version: '1.5.0', release: true } })).managed.version).toBe(
      '1.5.0',
    )
  })
})

/** The `.gitignore` block the publish-for-me deploy generates. */
function computeGitignore(): string {
  return computeManagedOutput(configWithSite(PUBLISH_SITE))?.gitignoreEntries ?? ''
}

describe('applyMigration', () => {
  test('stamps the counter after each migration, so a failure resumes where it stopped', async () => {
    const dir = await workspace({})
    // A file where the second migration needs a directory makes its write fail.
    await fs.writeFile(path.join(dir, 'blocker'), 'not a directory')
    const first = fixedMigration(1, [{ type: 'config-set', path: ['decksDir'], value: './lists' }])
    const second = fixedMigration(2, [
      { type: 'write', path: 'blocker/notes.txt', content: 'hello' },
    ])
    const migrations = [first, second]

    const failure = await rejection(applyMigration(await plan({ migrations })))
    // mkdir -p of `blocker/` meets the file of that name.
    expect(hasErrorCode(failure, 'EEXIST')).toBeTrue()

    const config = await readConfig(dir)
    expect(config.decksDir).toBe('./lists')
    expect(config.managed).toEqual({ migration: 1 })

    await fs.rm(path.join(dir, 'blocker'))
    const resumed = await plan({ migrations })
    expect(resumed.migrations.map((m) => m.migration.id)).toEqual([2])
    await applyMigration(resumed)
    expect(await fs.readFile(path.join(dir, 'blocker', 'notes.txt'), 'utf-8')).toBe('hello')
    expect((await readConfig(dir)).managed).toEqual({ migration: 2 })
  })

  test('a migration with no ops writes no intermediate stamp', async () => {
    const dir = await workspace({})
    const before = await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8')
    await fs.writeFile(path.join(dir, 'blocker'), 'not a directory')
    const migrations = [
      fixedMigration(1, []),
      fixedMigration(2, [{ type: 'write', path: 'blocker/notes.txt', content: 'hello' }]),
    ]
    await rejection(applyMigration(await plan({ migrations })))
    expect(await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8')).toBe(before)
  })

  test('applies delete and rename ops', async () => {
    const dir = await workspace({})
    await fs.writeFile(path.join(dir, 'old.txt'), 'moved')
    const migrations = [
      fixedMigration(1, [
        { type: 'rename', from: 'old.txt', to: 'new/dir/moved.txt' },
        { type: 'delete', path: 'never-existed.txt' },
      ]),
    ]
    await applyMigration(await plan({ migrations }))
    expect(await fileExists(path.join(dir, 'old.txt'))).toBeFalse()
    expect(await fs.readFile(path.join(dir, 'new', 'dir', 'moved.txt'), 'utf-8')).toBe('moved')
  })

  test('a config changed since planning aborts before anything is written', async () => {
    const dir = await workspace({ site: { ...PUBLISH_SITE, version: '0.1.0' } })
    const pending = await plan()
    const changed = JSON.stringify({ site: { ...PUBLISH_SITE, version: '0.1.0' }, artDir: './x' })
    await fs.writeFile(path.join(dir, 'ritual.config.json'), changed)

    const failure = await rejection(applyMigration(pending))

    expect(failure).toBeInstanceOf(CardCommandError)
    expect(await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8')).toBe(changed)
    expect(await fileExists(path.join(dir, WORKFLOW))).toBeFalse()
  })

  test('a refresh rewrites the workflow and appends missing .gitignore entries', async () => {
    const dir = await workspace({ site: PUBLISH_SITE })
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true })
    await fs.writeFile(path.join(dir, WORKFLOW), 'run: ./ritual build-site --allow-refresh\n')
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules/\ncache/\n')

    const pending = await plan()
    expect(pending.refresh?.filesToWrite.map((file) => file.path)).toEqual([WORKFLOW])
    expect(pending.refresh?.gitignoreMissing).toContain('dist/')
    expect(pending.refresh?.gitignoreMissing).not.toContain('cache/')
    await applyMigration(pending)

    const workflow = await fs.readFile(path.join(dir, WORKFLOW), 'utf-8')
    expect(workflow).toContain('./ritual build-site --refresh auto')
    const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')
    expect(gitignore.startsWith('node_modules/\ncache/\n')).toBeTrue()
    expect(gitignore).toContain('dist/')
  })

  test('a refresh force-overwrites installed skills and removes retired ones only', async () => {
    const dir = await workspace({ site: { ciSystem: 'manual' } })
    const skillsDir = path.join(dir, '.claude', 'skills')
    const [edited, ...neverInstalled] = SKILLS
    if (edited === undefined) throw new Error('empty skill catalog')
    const write = async (name: string, content: string): Promise<void> => {
      await fs.mkdir(path.join(skillsDir, name), { recursive: true })
      await fs.writeFile(skillFilePath(skillsDir, name), content)
    }

    // A catalog skill someone edited: overwritten regardless (no edit detection).
    await write(edited.name, `${renderSkillFile(edited)}\nlocal edit\n`)
    // A Ritual skill a newer catalog no longer ships: deleted, folder and all.
    const retired: RitualSkill = { name: 'ritual-retired', description: 'Old.', body: 'Gone.' }
    await write(retired.name, renderSkillFile(retired))
    // Another retired skill, edited, with a file of the user's beside it: the
    // skill goes, the folder (and the user's file) stays.
    const kept: RitualSkill = { name: 'ritual-kept', description: 'Old.', body: 'Gone.' }
    await write(kept.name, `${renderSkillFile(kept)}\nlocal edit\n`)
    await fs.writeFile(path.join(skillsDir, kept.name, 'notes.md'), 'mine')
    // The user's own skill, with no Ritual marker: untouched.
    const ownContent = '---\nname: my-skill\ndescription: mine\n---\n\nMine.\n'
    await write('my-skill', ownContent)

    const pending = await plan()
    expect(pending.refresh?.skillsToWrite).toEqual([edited.name])
    expect(pending.refresh?.skillsToRemove.toSorted()).toEqual([kept.name, retired.name])
    await applyMigration(pending)

    expect(await fs.readFile(skillFilePath(skillsDir, edited.name), 'utf-8')).toBe(
      renderSkillFile(edited),
    )
    expect(await fileExists(path.join(skillsDir, retired.name))).toBeFalse()
    expect(await fileExists(skillFilePath(skillsDir, kept.name))).toBeFalse()
    expect(await fs.readFile(path.join(skillsDir, kept.name, 'notes.md'), 'utf-8')).toBe('mine')
    expect(await fs.readFile(skillFilePath(skillsDir, 'my-skill'), 'utf-8')).toBe(ownContent)
    for (const skill of neverInstalled) {
      expect(await fileExists(skillFilePath(skillsDir, skill.name))).toBeFalse()
    }
  })
})

describe('computeManagedOutput', () => {
  test('is null when init-site never ran', () => {
    expect(computeManagedOutput(getDefaultRitualConfig())).toBeNull()
  })

  test('generates the workflow only for GitHub Actions deploys', () => {
    const actions = computeManagedOutput(configWithSite(PUBLISH_SITE))
    expect(actions?.files.map((file) => file.path)).toEqual([WORKFLOW])
    expect(actions?.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    const manual = computeManagedOutput(configWithSite({ ciSystem: 'manual' }))
    expect(manual?.files).toEqual([])
    expect(manual?.hash).not.toBe(actions?.hash)
  })

  test('the hash follows the deploy settings, not the rest of the site block', () => {
    const base = outputHash(PUBLISH_SITE)
    expect(outputHash({ ...PUBLISH_SITE, sellMode: true, includeDecks: ['Atraxa'] })).toBe(base)
    expect(outputHash({ ...PUBLISH_SITE, detectChanges: true })).not.toBe(base)
  })
})
