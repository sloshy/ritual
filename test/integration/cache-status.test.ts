import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { bindWorkspace, writeConfig, type BoundWorkspace } from '../helpers/workspace'
import { defaultUserCacheDir } from '../../src/util/user-dirs'
import { cardCache } from '../../src/cache'
import { makeScryfallCard } from '../test-utils'
import type { CacheStatusResult } from '../../src/cache/status'

/**
 * `ritual cache status` — the read-only cache report. The CLI runs against a
 * throwaway workspace whose cache is seeded in-process through the real
 * `cardCache.bulkSet` (the same write path a bulk preload uses), so the
 * lastRefreshedAt metadata stamp is exercised for real rather than faked.
 */

/** What `cache status --output json` prints — the collector's report verbatim. */
type CacheStatusPayload = CacheStatusResult

// Keep the spawned CLI deterministic even when the host shell has a cache
// server configured.
const NO_CACHE_SERVER = { RITUAL_CACHE_SERVER: undefined }

type StatusJsonRun = { exitCode: number; payload: CacheStatusPayload }

async function statusJson(
  dir: string,
  env: Record<string, string | undefined> = {},
): Promise<StatusJsonRun> {
  const result = await runCli(['cache', 'status', '--output', 'json'], dir, {
    ...NO_CACHE_SERVER,
    ...env,
  })
  return { exitCode: result.exitCode, payload: JSON.parse(result.stdout) as CacheStatusPayload }
}

let workspace: BoundWorkspace

beforeEach(async () => {
  workspace = await bindWorkspace({ clearCardCache: true })
})

afterEach(async () => {
  await workspace.dispose()
})

describe('cache status CLI (Integration)', () => {
  test('an empty workspace reports empty with exit 0', async () => {
    const { exitCode, payload } = await statusJson(workspace.dir)
    expect(exitCode).toBe(0)
    expect(payload).toEqual({
      empty: true,
      cardCount: 0,
      lastCardRefresh: null,
      priceAgeHours: null,
      priceStale: true,
      tagsPresent: false,
      source: 'local',
      // The test preload pins RITUAL_CACHE_DIR=cache: each workspace keeps its own.
      cacheDir: path.join(workspace.dir, 'cache'),
      cacheDirSource: 'env',
      defaultLanguage: 'en',
      cardBulkType: null,
      bulkTypeStale: false,
    })
  })

  test('text output renders a never-refreshed cache as never, exit 0', async () => {
    const result = await runCli(['cache', 'status'], workspace.dir, NO_CACHE_SERVER)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Last card refresh:')
    expect(result.stdout).toContain('never')
  })

  test('a bulk-seeded cache reports counts and a fresh refresh timestamp', async () => {
    await cardCache.bulkSet({
      'Sol Ring': [makeScryfallCard({ name: 'Sol Ring' })],
      'Llanowar Elves': [makeScryfallCard({ name: 'Llanowar Elves' })],
    })
    const { exitCode, payload } = await statusJson(workspace.dir)
    expect(exitCode).toBe(0)
    expect(payload.empty).toBe(false)
    expect(payload.cardCount).toBe(2)
    expect(payload.lastCardRefresh).not.toBeNull()
    expect(Number.isNaN(Date.parse(payload.lastCardRefresh!))).toBe(false)
    expect(payload.priceAgeHours).toBe(0)
    expect(payload.priceStale).toBe(false)
    expect(payload.tagsPresent).toBe(false)
  })

  test('text output words each value for its reader; json keeps the raw values', async () => {
    await cardCache.bulkSet({ 'Sol Ring': [makeScryfallCard({ name: 'Sol Ring' })] })
    const result = await runCli(['cache', 'status'], workspace.dir, NO_CACHE_SERVER)
    expect(result.exitCode).toBe(0)
    const rows = new Map(
      result.stdout
        .trim()
        .split('\n')
        .map((line): [string, string] => {
          const [label = '', ...value] = line.split(/:\s+/)
          return [label, value.join(': ')]
        }),
    )
    expect(rows.get('Empty')).toBe('no')
    expect(rows.get('Prices stale')).toBe('no')
    expect(rows.get('Tags present')).toBe('no')
    expect(rows.get('Source')).toBe('local')
    // The instant is formatted for the reader, never the raw ISO stamp JSON carries.
    const refreshed = rows.get('Last card refresh') ?? ''
    expect(refreshed).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2}\s[AP]M$/)
    const { payload } = await statusJson(workspace.dir)
    expect(payload.lastCardRefresh).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(payload.empty).toBe(false)
  })

  test('a German run formats the refresh time the German way', async () => {
    await cardCache.bulkSet({ 'Sol Ring': [makeScryfallCard({ name: 'Sol Ring' })] })
    const result = await runCli(['cache', 'status'], workspace.dir, {
      ...NO_CACHE_SERVER,
      RITUAL_LOCALE: 'de',
    })
    expect(result.exitCode).toBe(0)
    const refreshed = result.stdout
      .split('\n')
      .find((line) => line.startsWith('Last card refresh:'))
    expect(refreshed).toMatch(/\d{1,2}\.\d{1,2}\.\d{4}, \d{2}:\d{2}:\d{2}$/)
  })

  test('tagsPresent flips when a cached card carries oracle tags', async () => {
    await cardCache.bulkSet({
      'Sol Ring': [makeScryfallCard({ name: 'Sol Ring' })],
      'Rampant Growth': [makeScryfallCard({ name: 'Rampant Growth', oracleTags: ['ramp'] })],
    })
    const { payload } = await statusJson(workspace.dir)
    expect(payload.tagsPresent).toBe(true)
  })

  describe('cache location', () => {
    let elsewhere: string

    beforeEach(async () => {
      elsewhere = await mkdtemp(path.join(tmpdir(), 'ritual-shared-cache-'))
    })

    afterEach(async () => {
      await rm(elsewhere, { recursive: true, force: true })
    })

    test('RITUAL_CACHE_DIR outranks the cacheDir key, and the cache is read from it', async () => {
      await writeConfig(workspace.dir, { cacheDir: 'workspace-cache' })
      // Seed the shared directory the variable names, not the workspace's own cache.
      await Bun.write(
        path.join(elsewhere, 'cache.json'),
        JSON.stringify({
          prices: {},
          cards: {
            'Sol Ring': { timestamp: Date.now(), data: [makeScryfallCard({ name: 'Sol Ring' })] },
          },
        }),
      )
      const { payload } = await statusJson(workspace.dir, { RITUAL_CACHE_DIR: elsewhere })
      expect(payload).toMatchObject({ cacheDir: elsewhere, cacheDirSource: 'env', cardCount: 1 })
    })

    test('without the variable, a relative cacheDir resolves against the workspace', async () => {
      await writeConfig(workspace.dir, { cacheDir: 'workspace-cache' })
      const { payload } = await statusJson(workspace.dir, { RITUAL_CACHE_DIR: undefined })
      expect(payload).toMatchObject({
        cacheDir: path.join(workspace.dir, 'workspace-cache'),
        cacheDirSource: 'config',
      })
    })

    test('with neither, the per-user default is used and the text report says it is shared', async () => {
      // Every platform's base directory points into the throwaway folder, so no
      // run reads a real per-user cache; the expected path is the platform's own rule.
      const env = {
        RITUAL_CACHE_DIR: undefined,
        XDG_CACHE_HOME: undefined,
        HOME: elsewhere,
        USERPROFILE: elsewhere,
        LOCALAPPDATA: elsewhere,
      }
      const expected = defaultUserCacheDir({
        env: { LOCALAPPDATA: elsewhere },
        platform: process.platform,
        home: elsewhere,
      })
      const { payload } = await statusJson(workspace.dir, env)
      expect(payload).toMatchObject({ cacheDir: expected, cacheDirSource: 'default' })
      const text = await runCli(['cache', 'status'], workspace.dir, { ...NO_CACHE_SERVER, ...env })
      expect(text.stdout.match(/^Location:\s+(.*)$/m)?.[1]).toBe(
        `${expected} (per-user default, shared by every workspace)`,
      )
    })
  })
})
