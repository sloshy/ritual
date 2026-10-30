import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CACHE_MOVE_MARKER,
  canonicalPath,
  legacyCacheAction,
  moveLegacyCache,
  pathsOverlap,
} from '../../src/cache/relocate'
import { CACHE_LOCK_FILENAME } from '../../src/cache/lock'
import { sharedCacheMigration } from '../../src/migrate/migrations'
import { applyMigration, planMigration, type MigrationPlan } from '../../src/migrate/runner'
import { renderSyncParam } from '../../src/sync/message'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import type { UserDirsEnvironment } from '../../src/util/user-dirs'
import { bindWorkspace, snapshotTree, writeConfig, type BoundWorkspace } from '../helpers/workspace'

/**
 * Migration 3: a workspace's old `cache/` folder moves into the cache directory
 * it now resolves to, unless that directory already holds data — then the old
 * folder is left exactly as it was. Runs against throwaway workspaces and a
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

const OTHER_WORKSPACE_TREE = { 'cache.json': '{"from":"another workspace"}' }

async function seedLegacyCache(): Promise<void> {
  await fs.mkdir(path.join(legacyDir(), 'images'), { recursive: true })
  await fs.writeFile(path.join(legacyDir(), 'cache.json'), LEGACY_TREE['cache.json'])
  await fs.writeFile(path.join(legacyDir(), 'images', 'sol-ring.jpg'), 'jpeg')
}

/** Give the shared cache data of its own, as another workspace would have. */
async function seedShared(): Promise<void> {
  await fs.mkdir(sharedDir(), { recursive: true })
  await fs.writeFile(path.join(sharedDir(), 'cache.json'), OTHER_WORKSPACE_TREE['cache.json'])
}

async function plan(): Promise<MigrationPlan> {
  const outcome = await planMigration({
    migrations: [sharedCacheMigration(3, environment)],
    build: { version: '0.0.0-dev', release: false },
  })
  if (outcome.kind !== 'plan') throw new Error(`expected a plan, got ${outcome.kind}`)
  return outcome
}

describe('migration 3: shared card cache', () => {
  test('its plan line names the folder, the variable and the key as typed', () => {
    expect(renderSyncParam(sharedCacheMigration(3).description, DEFAULT_LOCALE)).toBe(
      "Move the card cache from the workspace's cache/ folder to the per-user cache every workspace shares (or the one RITUAL_CACHE_DIR or cacheDir names)",
    )
  })

  test('moves the workspace cache into an empty shared cache and removes the old folder', async () => {
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

  test('leaves the workspace cache untouched when the shared cache already has data', async () => {
    await seedLegacyCache()
    await seedShared()

    const planned = await plan()
    expect(planned.migrations[0]?.ops).toEqual([
      { type: 'cache-keep', path: 'cache', shared: sharedDir() },
    ])
    const result = await applyMigration(planned)

    expect(result.cache).toEqual([{ outcome: 'kept', path: 'cache', shared: sharedDir() }])
    expect(await snapshotTree(legacyDir())).toEqual(LEGACY_TREE)
    expect(await snapshotTree(sharedDir())).toEqual(OTHER_WORKSPACE_TREE)
  })

  test('a shared cache filled between planning and applying turns the move into a keep', async () => {
    await seedLegacyCache()
    const planned = await plan()
    await seedShared()

    const result = await applyMigration(planned)

    expect(result.cache).toEqual([{ outcome: 'kept', path: 'cache', shared: sharedDir() }])
    expect(await snapshotTree(legacyDir())).toEqual(LEGACY_TREE)
    expect(await snapshotTree(sharedDir())).toEqual(OTHER_WORKSPACE_TREE)
  })

  test('has nothing to do when the cache still resolves to the workspace folder', async () => {
    await seedLegacyCache()
    await writeConfig(ws.dir, { cacheDir: 'cache' })
    const migration = sharedCacheMigration(3, environment)
    expect(migration.applies({ config: { cacheDir: 'cache' }, baseDir: ws.dir })).toBe(false)
    expect((await plan()).migrations[0]?.ops).toEqual([])
  })

  test('an empty workspace cache, or one holding only a lock file, does not apply', async () => {
    const migration = sharedCacheMigration(3, environment)
    await fs.mkdir(legacyDir())
    expect(migration.applies({ config: {}, baseDir: ws.dir })).toBe(false)
    await fs.writeFile(path.join(legacyDir(), CACHE_LOCK_FILENAME), '{}')
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

  test('pathsOverlap treats a name starting with two dots as a child, not a parent', () => {
    expect(pathsOverlap('/w/..cache', '/w')).toBe(true)
    expect(pathsOverlap('/w/cache', '/elsewhere/cache')).toBe(false)
  })

  test('OS litter is not cache data on either side', async () => {
    await fs.mkdir(legacyDir())
    await fs.writeFile(path.join(legacyDir(), '.DS_Store'), '')
    expect(await legacyCacheAction(legacyDir(), sharedDir())).toBe('none')

    await seedLegacyCache()
    await fs.mkdir(sharedDir(), { recursive: true })
    await fs.writeFile(path.join(sharedDir(), 'Thumbs.db'), '')
    expect(await legacyCacheAction(legacyDir(), sharedDir())).toBe('move')
  })

  test('a target nested in the old cache under another case counts as overlapping', async () => {
    await seedLegacyCache()
    // On a case-insensitive file system, CACHE/shared is inside cache/.
    const target = path.join(ws.dir, 'CACHE', 'shared')
    expect(await legacyCacheAction(legacyDir(), target, { platform: 'darwin' })).toBe('none')
  })

  test('a marker another workspace left counts as data: this cache is kept, not merged', async () => {
    await seedLegacyCache()
    await writeMarker('/some/other/workspace/cache')
    expect(await legacyCacheAction(legacyDir(), sharedDir())).toBe('keep')
    expect(await moveLegacyCache(legacyDir(), sharedDir())).toEqual({ outcome: 'kept' })
    expect(await snapshotTree(legacyDir())).toEqual(LEGACY_TREE)
  })

  test('this workspace’s own marker over an emptied folder plans the finish, which clears both', async () => {
    await fs.mkdir(legacyDir())
    await writeMarker(await canonicalPath(legacyDir()))
    expect(sharedCacheMigration(3, environment).applies({ config: {}, baseDir: ws.dir })).toBe(true)

    const planned = await plan()
    expect(planned.migrations[0]?.ops).toEqual([
      { type: 'cache-finish', path: 'cache', shared: sharedDir() },
    ])
    const result = await applyMigration(planned)

    expect(result.cache).toEqual([{ outcome: 'moved', path: 'cache', shared: sharedDir() }])
    expect(existsSync(legacyDir())).toBe(false)
    expect(existsSync(path.join(sharedDir(), CACHE_MOVE_MARKER))).toBe(false)
  })
})

/** Leave a move marker in the shared cache, as an interrupted move would. */
async function writeMarker(source: string): Promise<void> {
  await fs.mkdir(sharedDir(), { recursive: true })
  await fs.writeFile(path.join(sharedDir(), CACHE_MOVE_MARKER), JSON.stringify({ source }))
}

/** A rename that always fails as a cross-device rename does. */
const exdev = (): Promise<void> =>
  Promise.reject(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }))

describe('moveLegacyCache', () => {
  test('falls back to copy-then-delete across file systems', async () => {
    await seedLegacyCache()

    const result = await moveLegacyCache(legacyDir(), sharedDir(), { rename: exdev })

    expect(result).toEqual({ outcome: 'moved' })
    expect(await snapshotTree(sharedDir())).toEqual(LEGACY_TREE)
    expect(existsSync(legacyDir())).toBe(false)
  })

  test('a crash while deleting a copied source resumes without touching the complete copy', async () => {
    await seedLegacyCache()
    // The first run copies `images/` across devices, then dies part-way
    // through deleting the source: the old folder is half gone.
    const crash = async (destination: string): Promise<void> => {
      if (path.basename(destination) !== 'images') return
      await fs.rm(path.join(legacyDir(), 'images', 'sol-ring.jpg'))
      throw new Error('killed')
    }
    const failure = await moveLegacyCache(legacyDir(), sharedDir(), {
      rename: exdev,
      afterCopy: crash,
    }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(Error)

    expect(await legacyCacheAction(legacyDir(), sharedDir())).toBe('move')
    expect(await moveLegacyCache(legacyDir(), sharedDir())).toEqual({ outcome: 'moved' })

    expect(await snapshotTree(sharedDir())).toEqual(LEGACY_TREE)
    expect(existsSync(legacyDir())).toBe(false)
  })

  test('a failed rename says another Ritual may be using the cache, and deletes nothing', async () => {
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
  })

  test('files that appear in the old folder mid-move are reported, not called moved', async () => {
    await seedLegacyCache()
    const busy = async (from: string, to: string): Promise<void> => {
      await fs.rename(from, to)
      // An older Ritual still running writes its cache back into the old folder.
      if (path.basename(from) === 'images')
        await fs.writeFile(path.join(legacyDir(), 'tags.json'), '{}')
    }

    const result = await moveLegacyCache(legacyDir(), sharedDir(), { rename: busy })

    expect(result).toEqual({ outcome: 'partial', left: ['tags.json'] })
    expect(await snapshotTree(sharedDir())).toEqual(LEGACY_TREE)
  })

  test('a symlinked old cache moves its contents and removes only the link', async () => {
    const elsewhere = path.join(userCache, 'linked-cache')
    await fs.mkdir(path.join(elsewhere, 'images'), { recursive: true })
    await fs.writeFile(path.join(elsewhere, 'cache.json'), LEGACY_TREE['cache.json'])
    await fs.writeFile(path.join(elsewhere, 'images', 'sol-ring.jpg'), 'jpeg')
    await fs.symlink(elsewhere, legacyDir(), 'dir')

    expect(await moveLegacyCache(legacyDir(), sharedDir())).toEqual({ outcome: 'moved' })

    expect(await snapshotTree(sharedDir())).toEqual(LEGACY_TREE)
    expect(existsSync(legacyDir())).toBe(false)
    expect(await fs.readdir(elsewhere)).toEqual([])
  })
})
