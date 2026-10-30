import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import path from 'node:path'
import { INCOMING_PREFIX, legacyCacheAction, moveLegacyCache } from '../../src/cache/relocate'
import { CACHE_LOCK_FILENAME } from '../../src/cache/lock'
import { sharedCacheMigration } from '../../src/migrate/migrations'
import { applyMigration, planMigration, type MigrationPlan } from '../../src/migrate/runner'
import { renderSyncParam } from '../../src/sync/message'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import type { UserDirsEnvironment } from '../../src/util/user-dirs'
import { bindWorkspace, snapshotTree, writeConfig, type BoundWorkspace } from '../helpers/workspace'

/**
 * Migration 3: a workspace's old `cache/` folder moves, whole, into the cache
 * directory it now resolves to — only when that directory does not exist or
 * holds nothing but OS litter. Anything else there and nothing moves; nothing
 * in the target is ever touched. Runs against throwaway workspaces and a
 * throwaway "per-user" cache directory, never the real one.
 */

let ws: BoundWorkspace
let userCache: string
let environment: UserDirsEnvironment

beforeEach(async () => {
  ws = await bindWorkspace({ dirs: [], config: {} })
  userCache = await fs.mkdtemp(path.join(tmpdir(), 'ritual-user-cache-'))
  // The per-user default, as a workspace with no override resolves it.
  environment = { env: { XDG_CACHE_HOME: userCache }, platform: 'linux', home: '/nowhere' }
})

afterEach(async () => {
  await ws.dispose()
  await fs.rm(userCache, { recursive: true, force: true })
})

/** The shared directory the migration targets under {@link environment}. */
function sharedDir(): string {
  return path.join(userCache, 'ritual')
}

/** The workspace's old cache folder. */
function legacyDir(): string {
  return path.join(ws.dir, 'cache')
}

const LEGACY_TREE = {
  'cache.json': '{"prices":{},"cards":{}}',
  'images/': '',
  'images/sol-ring.jpg': 'jpeg',
}

async function seedTree(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'images'), { recursive: true })
  await fs.writeFile(path.join(dir, 'cache.json'), LEGACY_TREE['cache.json'])
  await fs.writeFile(path.join(dir, 'images', 'sol-ring.jpg'), 'jpeg')
}

async function seedLegacyCache(): Promise<void> {
  await seedTree(legacyDir())
}

/** Put one file into the shared folder, as another workspace or the user would. */
async function seedShared(name: string, body: string): Promise<void> {
  await fs.mkdir(sharedDir(), { recursive: true })
  await fs.writeFile(path.join(sharedDir(), name), body)
}

/** The temporary folders a cross-device move left beside the target. */
async function incomingLeftovers(): Promise<string[]> {
  return (await fs.readdir(userCache)).filter((entry) => entry.startsWith(INCOMING_PREFIX))
}

async function plan(env: UserDirsEnvironment = environment): Promise<MigrationPlan> {
  const outcome = await planMigration({
    migrations: [sharedCacheMigration(3, env)],
    build: { version: '0.0.0-dev', release: false },
  })
  if (outcome.kind !== 'plan') throw new Error(`expected a plan, got ${outcome.kind}`)
  return outcome
}

/** A rename that always fails as a cross-device rename does. */
const exdev = (): Promise<void> =>
  Promise.reject(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }))

describe('migration 3: shared card cache', () => {
  test('its plan line names the folder, the variable and the key as typed', () => {
    expect(renderSyncParam(sharedCacheMigration(3).description, DEFAULT_LOCALE)).toBe(
      "Move the card cache from the workspace's cache/ folder to the per-user cache every workspace shares (or the one RITUAL_CACHE_DIR or cacheDir names)",
    )
  })

  test('renames the whole old folder to an absent shared cache', async () => {
    await seedLegacyCache()
    const planned = await plan()
    expect(planned.migrations[0]?.ops).toEqual([
      { type: 'cache-move', from: 'cache', to: sharedDir(), source: 'default' },
    ])

    const result = await applyMigration(planned)

    expect(result.cache).toEqual([{ outcome: 'moved', path: 'cache', shared: sharedDir() }])
    expect(await snapshotTree(sharedDir())).toEqual(LEGACY_TREE)
    expect(existsSync(legacyDir())).toBe(false)
    // Only the config is backed up: the moved cache is regenerable and nothing was lost.
    expect(await fs.readdir(result.backupDir ?? '')).toEqual(['ritual.config.json'])
  })

  test('moves into an existing, empty shared folder', async () => {
    await seedLegacyCache()
    await fs.mkdir(sharedDir(), { recursive: true })

    expect(await moveLegacyCache(legacyDir(), sharedDir())).toEqual({ outcome: 'moved' })
    expect(await snapshotTree(sharedDir())).toEqual(LEGACY_TREE)
    expect(existsSync(legacyDir())).toBe(false)
  })

  test.each([
    ['another workspace’s cache', 'cache.json', '{"from":"another workspace"}'],
    ['a file of the user’s own', 'notes.partial-final.docx', 'my notes'],
    ['only a .DS_Store', '.DS_Store', ''],
    [
      'only a lock no process holds',
      CACHE_LOCK_FILENAME,
      JSON.stringify({ pid: 2 ** 22 + 1, hostname: os.hostname(), createdAt: 0, operation: 'x' }),
    ],
  ])('leaves both folders byte for byte when the target holds %s', async (_label, name, body) => {
    await seedLegacyCache()
    await seedShared(name, body)

    const planned = await plan()
    expect(planned.migrations[0]?.ops).toEqual([
      { type: 'cache-keep', path: 'cache', shared: sharedDir() },
    ])
    const result = await applyMigration(planned)

    expect(result.cache).toEqual([{ outcome: 'kept', path: 'cache', shared: sharedDir() }])
    expect(await snapshotTree(legacyDir())).toEqual(LEGACY_TREE)
    expect(await snapshotTree(sharedDir())).toEqual({ [name]: body })
  })

  test('a target that fills between planning and applying keeps the old folder', async () => {
    await seedLegacyCache()
    const planned = await plan()
    await seedShared('notes.txt', 'mine')

    const result = await applyMigration(planned)

    expect(result.cache).toEqual([{ outcome: 'kept', path: 'cache', shared: sharedDir() }])
    expect(await snapshotTree(legacyDir())).toEqual(LEGACY_TREE)
    expect(await snapshotTree(sharedDir())).toEqual({ 'notes.txt': 'mine' })
  })

  test('a target another process holds the lock in is kept clear of', async () => {
    await seedLegacyCache()
    await seedShared(
      CACHE_LOCK_FILENAME,
      JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: Date.now(),
        operation: 'x',
      }),
    )
    expect(await legacyCacheAction(legacyDir(), sharedDir())).toBe('keep')
  })

  test('a running Ritual holding the old cache’s lock stops the move, changing nothing', async () => {
    await seedLegacyCache()
    const lock = JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: 0,
      operation: 'bulk card cache download',
    })
    await fs.writeFile(path.join(legacyDir(), CACHE_LOCK_FILENAME), lock)
    const before = await snapshotTree(legacyDir())

    const failure = await moveLegacyCache(legacyDir(), sharedDir()).catch((e: unknown) => e)

    expect(failure).toMatchObject({ code: 'runtime_error' })
    expect(String((failure as Error).message)).toContain('a running Ritual is using this cache')
    expect(await snapshotTree(legacyDir())).toEqual(before)
    expect(existsSync(sharedDir())).toBe(false)
  })

  test('has nothing to do when the cache still resolves to the workspace folder', async () => {
    await seedLegacyCache()
    await writeConfig(ws.dir, { cacheDir: 'cache' })
    const migration = sharedCacheMigration(3, environment)
    expect(migration.applies({ config: { cacheDir: 'cache' }, baseDir: ws.dir })).toBe(false)
    expect((await plan()).migrations[0]?.ops).toEqual([])
  })

  test('never moves into a folder RITUAL_CACHE_DIR may not name', async () => {
    await seedLegacyCache()
    const unsafe: UserDirsEnvironment = { ...environment, env: { RITUAL_CACHE_DIR: '/' } }
    expect(sharedCacheMigration(3, unsafe).applies({ config: {}, baseDir: ws.dir })).toBe(false)
    expect((await plan(unsafe)).migrations[0]?.ops).toEqual([])
    expect(await snapshotTree(legacyDir())).toEqual(LEGACY_TREE)
  })

  test('an empty workspace cache, or one holding only a lock file or litter, does not apply', async () => {
    const migration = sharedCacheMigration(3, environment)
    await fs.mkdir(legacyDir())
    expect(migration.applies({ config: {}, baseDir: ws.dir })).toBe(false)
    await fs.writeFile(path.join(legacyDir(), CACHE_LOCK_FILENAME), '{}')
    await fs.writeFile(path.join(legacyDir(), '.DS_Store'), '')
    expect(migration.applies({ config: {}, baseDir: ws.dir })).toBe(false)
    expect((await plan()).migrations[0]?.ops).toEqual([])
  })
})

describe('legacyCacheAction', () => {
  test.each([
    ['the workspace itself (cacheDir ".")', (): string => ws.dir],
    ['a folder inside the old cache', (): string => path.join(legacyDir(), 'shared')],
    ['the old cache by another spelling', (): string => path.join(ws.dir, 'x', '..', 'cache')],
  ])('never moves a cache into %s', async (_label, target) => {
    await seedLegacyCache()
    expect(await legacyCacheAction(legacyDir(), target())).toBe('none')
  })

  test('a symlink to the old cache is the same folder', async () => {
    await seedLegacyCache()
    const link = path.join(userCache, 'link')
    await fs.symlink(legacyDir(), link, 'dir')
    expect(await legacyCacheAction(legacyDir(), link)).toBe('none')
  })

  test('a target nested in the old cache under another case counts as overlapping', async () => {
    await seedLegacyCache()
    // On a case-insensitive file system, CACHE/shared is inside cache/.
    const target = path.join(ws.dir, 'CACHE', 'shared')
    expect(await legacyCacheAction(legacyDir(), target, { platform: 'darwin' })).toBe('none')
  })
})

describe('moveLegacyCache across file systems', () => {
  test('copies to a temporary folder beside the target, renames it in, then removes the old one', async () => {
    await seedLegacyCache()
    // The copy holds the old cache's own lock; that lock file is not copied along.

    const result = await moveLegacyCache(legacyDir(), sharedDir(), { rename: exdev })

    expect(result).toEqual({ outcome: 'moved' })
    expect(await snapshotTree(sharedDir())).toEqual(LEGACY_TREE)
    expect(existsSync(legacyDir())).toBe(false)
    expect(await incomingLeftovers()).toEqual([])
  })

  test('a failure after the copy leaves the old folder intact and removes only its own copy', async () => {
    await seedLegacyCache()
    const crash = (): Promise<void> => Promise.reject(new Error('killed'))

    const failure = await moveLegacyCache(legacyDir(), sharedDir(), {
      rename: exdev,
      afterCopy: crash,
    }).catch((e: unknown) => e)

    expect(failure).toMatchObject({ code: 'runtime_error' })
    expect(await snapshotTree(legacyDir())).toEqual(LEGACY_TREE)
    expect(existsSync(sharedDir())).toBe(false)
    expect(await incomingLeftovers()).toEqual([])
  })

  test('a failure part-way through the copy removes only its own copy', async () => {
    if (process.getuid?.() === 0) return // root reads any file
    await seedLegacyCache()
    const unreadable = path.join(legacyDir(), 'images', 'sol-ring.jpg')
    await fs.chmod(unreadable, 0o000)
    try {
      const failure = await moveLegacyCache(legacyDir(), sharedDir(), { rename: exdev }).catch(
        (e: unknown) => e,
      )
      expect(failure).toMatchObject({ code: 'runtime_error' })
    } finally {
      await fs.chmod(unreadable, 0o644)
    }
    expect(await snapshotTree(legacyDir())).toEqual(LEGACY_TREE)
    expect(existsSync(sharedDir())).toBe(false)
    expect(await incomingLeftovers()).toEqual([])
  })

  test('an abandoned temporary folder is removed only once it is an hour old', async () => {
    await seedLegacyCache()
    const old = path.join(userCache, `${INCOMING_PREFIX}1-old`)
    const fresh = path.join(userCache, `${INCOMING_PREFIX}2-fresh`)
    await fs.mkdir(old)
    await fs.mkdir(fresh)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await fs.utimes(old, twoHoursAgo, twoHoursAgo)

    await moveLegacyCache(legacyDir(), sharedDir())

    expect(await incomingLeftovers()).toEqual([`${INCOMING_PREFIX}2-fresh`])
  })
})

describe('moveLegacyCache', () => {
  test('a failed rename says another Ritual may be using the cache, and changes nothing', async () => {
    await seedLegacyCache()
    const denied = (): Promise<void> =>
      Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }))

    const failure = await moveLegacyCache(legacyDir(), sharedDir(), { rename: denied }).catch(
      (e: unknown) => e,
    )

    expect(failure).toMatchObject({ code: 'runtime_error' })
    expect(String((failure as Error).message)).toContain('Another Ritual')
    expect(String((failure as Error).message)).toContain('ritual migrate')
    expect(await snapshotTree(legacyDir())).toEqual(LEGACY_TREE)
    expect(existsSync(sharedDir())).toBe(false)
  })

  test('a symlinked old cache is copied in and the link removed; its folder is left alone', async () => {
    const linked = path.join(userCache, 'linked-cache')
    await seedTree(linked)
    await fs.symlink(linked, legacyDir(), 'dir')

    const result = await moveLegacyCache(legacyDir(), sharedDir())

    expect(result).toEqual({ outcome: 'copied-link', linked: await fs.realpath(linked) })
    // A real directory holding the files, not a copy of the link.
    expect((await fs.lstat(sharedDir())).isDirectory()).toBe(true)
    expect(await snapshotTree(sharedDir())).toEqual(LEGACY_TREE)
    expect(existsSync(legacyDir())).toBe(false)
    expect(await snapshotTree(linked)).toEqual(LEGACY_TREE)
  })
})
