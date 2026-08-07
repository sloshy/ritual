import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runCli } from './helpers/cli'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'
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

async function statusJson(dir: string): Promise<StatusJsonRun> {
  const result = await runCli(['cache', 'status', '--output', 'json'], dir, NO_CACHE_SERVER)
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

  test('tagsPresent flips when a cached card carries oracle tags', async () => {
    await cardCache.bulkSet({
      'Sol Ring': [makeScryfallCard({ name: 'Sol Ring' })],
      'Rampant Growth': [makeScryfallCard({ name: 'Rampant Growth', oracleTags: ['ramp'] })],
    })
    const { payload } = await statusJson(workspace.dir)
    expect(payload.tagsPresent).toBe(true)
  })
})
