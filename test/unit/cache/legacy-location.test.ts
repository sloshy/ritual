import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getCacheDirLocation } from '../../../src/cache/file-cache'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import { MemoryLogger, resetLogger, setLogger } from '../../test-utils'

/**
 * Until migration 3 has run, a workspace with data in its own old `cache/`
 * keeps reading it, so nothing downloads into the empty shared cache first.
 * These run with the test preload's RITUAL_CACHE_DIR removed (and the per-user
 * default pointed at a throwaway folder), since the variable outranks the rule.
 */

let ws: BoundWorkspace | null = null
let userCache: string
const saved = { cacheDir: process.env.RITUAL_CACHE_DIR, xdg: process.env.XDG_CACHE_HOME }

beforeEach(async () => {
  userCache = await fs.mkdtemp(path.join(tmpdir(), 'ritual-user-cache-'))
  delete process.env.RITUAL_CACHE_DIR
  process.env.XDG_CACHE_HOME = userCache
})

afterEach(async () => {
  await ws?.dispose()
  ws = null
  if (saved.cacheDir === undefined) delete process.env.RITUAL_CACHE_DIR
  else process.env.RITUAL_CACHE_DIR = saved.cacheDir
  if (saved.xdg === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = saved.xdg
  await fs.rm(userCache, { recursive: true, force: true })
})

/** A workspace whose `cache/` holds `entry`, with the config loaded. */
async function workspaceWithCache(
  config: Record<string, unknown>,
  entry = 'cache.json',
): Promise<string> {
  ws = await bindWorkspace({ dirs: [], config, init: true })
  await fs.mkdir(path.join(ws.dir, 'cache'))
  await fs.writeFile(path.join(ws.dir, 'cache', entry), '{}')
  return ws.dir
}

describe('the workspace’s old cache while migration 3 is pending', () => {
  test('is the cache this workspace reads, and says why', async () => {
    const dir = await workspaceWithCache({})
    expect(getCacheDirLocation()).toEqual({ dir: path.join(dir, 'cache'), source: 'legacy' })
  })

  test('ends as soon as another process records the migration, though this one never reloads', async () => {
    const dir = await workspaceWithCache({})
    expect(getCacheDirLocation().source).toBe('legacy')

    // Another process migrates: the file now records migration 3, while this
    // process's loaded config (like a running server's) still says 0.
    await fs.writeFile(
      path.join(dir, 'ritual.config.json'),
      JSON.stringify({ managed: { migration: 3 } }),
    )
    expect(getCacheDirLocation().source).toBe('default')
  })

  test('ends when the old folder is moved away', async () => {
    const dir = await workspaceWithCache({})
    expect(getCacheDirLocation().source).toBe('legacy')
    await fs.rename(path.join(dir, 'cache'), path.join(userCache, 'moved'))
    expect(getCacheDirLocation().source).toBe('default')
  })

  test('stops being read once the migration is recorded', async () => {
    await workspaceWithCache({ managed: { migration: 3 } })
    expect(getCacheDirLocation()).toEqual({
      dir: path.join(userCache, 'ritual'),
      source: 'default',
    })
  })

  test('is not a cache when it holds only OS litter', async () => {
    await workspaceWithCache({}, '.DS_Store')
    expect(getCacheDirLocation().source).toBe('default')
  })

  test('an unsafe RITUAL_CACHE_DIR is skipped with a warning, and does not hide it', async () => {
    const dir = await workspaceWithCache({})
    // The workspace itself: unusable, and unique to this test (each value warns once per process).
    process.env.RITUAL_CACHE_DIR = dir
    const logger = new MemoryLogger()
    setLogger(logger)
    try {
      expect(getCacheDirLocation()).toEqual({ dir: path.join(dir, 'cache'), source: 'legacy' })
      getCacheDirLocation()
    } finally {
      resetLogger()
    }
    const warnings = logger.entries
      .filter((entry) => entry.level === 'warn')
      .map((entry) => String(entry.args[0]))
      .filter((line) => line.includes('Ignoring the card cache folder'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"RITUAL_CACHE_DIR" must not be the workspace')
  })

  test('gives way to a configured cacheDir', async () => {
    const dir = await workspaceWithCache({ cacheDir: 'elsewhere' })
    expect(getCacheDirLocation()).toEqual({ dir: path.join(dir, 'elsewhere'), source: 'config' })
  })
})
