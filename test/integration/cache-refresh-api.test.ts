/**
 * `POST /api/cache/refresh` — the route's own contract, not the ingest's.
 *
 * Two things changed with the engine's real progress seam and are pinned here:
 * the route reports a monotonic 0–100 scale to an in-process caller (the MCP
 * `refresh_cache` tool's channel), and a failed refresh now reaches the caller
 * as a non-2xx instead of being swallowed into `success: true`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { handleCacheRefresh, type CacheRefreshResponse } from '../../src/admin/api/cache'
import { cardCache } from '../../src/cache'
import {
  CACHE_LOCK_FILENAME,
  CacheLockTimeoutError,
  type CacheLockInfo,
} from '../../src/cache/lock'
import type { CacheRefreshEvent } from '../../src/scryfall'
import type { SyncMessage, SyncMessageParams } from '../../src/sync/message'
import { gzipJsonLines } from '../test-utils'
import { keyedMessage } from '../helpers/api-message'
import { expectLocaleInForce, pseudoCatalog, withSyntheticLocaleAsync } from '../helpers/sync-text'
import { readStreamFrames } from '../helpers/sse'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'
import type { RouteProgress } from '../../src/util/progress'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { stubScryfallBulk } from './helpers/scryfall-bulk'
import type { StubbedFetch } from '../helpers/stub-fetch'
import { bulkCard, expectMonotonicProgress } from '../test-utils'

let ws: BoundWorkspace
let stubbed: StubbedFetch | undefined

beforeEach(async () => {
  ws = await bindWorkspace({ clearCardCache: true })
})

afterEach(async () => {
  stubbed?.restore()
  stubbed = undefined
  await ws.dispose()
})

describe('handleCacheRefresh', () => {
  test('reports a monotonic 0–100 scale and refreshes the cache', async () => {
    stubbed = stubScryfallBulk({ cards: [bulkCard()] })

    const reports: RouteProgress[] = []
    const resp = await handleCacheRefresh((report) => reports.push(report))

    expect(resp.status).toBe(200)
    expect(((await resp.json()) as CacheRefreshResponse).message).toBe(
      'Cache refreshed successfully',
    )
    expect(await cardCache.get('Sol Ring')).not.toBeNull()

    expectMonotonicProgress(reports, 100)
    expect(reports[0]?.progress).toBe(1)
    expect(reports.at(-1)?.progress).toBe(100)
  })

  test('a cancelled refresh writes nothing, answers 499, and releases the cache lock', async () => {
    stubbed = stubScryfallBulk({ cards: [bulkCard()] })
    const controller = new AbortController()

    // Cancelled from inside the run, once the download is under way — the
    // route's scale puts the metadata and tag steps at 1 and 2 and the download
    // from 3 up (see `cacheRefreshProgress`).
    const resp = await handleCacheRefresh((report) => {
      if (report.progress >= 3) controller.abort()
    }, controller.signal)

    expect(resp.status).toBe(499)
    expect(await resp.json()).toEqual({
      success: false,
      message: 'The cache refresh was cancelled; the existing card cache was left as it was.',
      messageKey: 'domain.cache.refresh.cancelled',
    })
    // The previous cache (empty here) is exactly what was there before.
    expect(await cardCache.get('Sol Ring')).toBeNull()

    // And the lock came off on the way out: the next refresh runs to completion
    // rather than waiting on a lock a cancelled run forgot to release.
    const next = await handleCacheRefresh()
    expect(next.status).toBe(200)
    expect(await cardCache.get('Sol Ring')).not.toBeNull()
  })

  test('a failed download is reported instead of being swallowed as success', async () => {
    stubbed = stubScryfallBulk({ cardBulk: () => new Response('nope', { status: 500 }) })

    const resp = await handleCacheRefresh()

    expect(resp.status).toBe(500)
    expect(((await resp.json()) as { success: boolean }).success).toBe(false)
  })
})

describe('the refresh stream’s progress lines', () => {
  test('stream in English plus their key, sizes nested, whatever the server’s language', async () => {
    stubbed = stubScryfallBulk({ cards: [bulkCard()] })

    const frames = await withSyntheticLocaleAsync('en-XA', pseudoCatalog(), async (locale) => {
      expectLocaleInForce(locale)
      const read = await readStreamFrames('/api/cache/refresh/stream')
      expectLocaleInForce(locale)
      return read
    })

    // The wire shape of the frames that carry nested params: English plus the
    // key, the sizes as sizes, beside the unchanged stage and percentage. (Which
    // steps the engine reports, and that each is keyed, is the engine's own
    // test's: `test/unit/scryfall/cache-progress.test.ts`.)
    const totalBytes = gzipJsonLines([bulkCard()]).byteLength
    const mib = (totalBytes / 1024 / 1024).toFixed(2)
    const progress = frames
      .filter((frame) => frame.event === 'progress')
      .map((frame) => frame.data as unknown as CacheRefreshEvent)
    expect(progress.find((event) => event.stage === 'download')).toEqual({
      stage: 'download',
      message: `Download size: ${mib} MiB (compressed)`,
      messageKey: 'domain.cache.refresh.downloadSize',
      messageParams: { size: { sizeBytes: totalBytes } },
    })
    expect(progress.findLast((event) => event.stage === 'download')).toEqual({
      stage: 'download',
      percentage: 100,
      message: `Processing: 100% (${mib}/${mib} MiB)`,
      messageKey: 'domain.cache.refresh.processing',
      messageParams: {
        percentage: 100,
        received: { sizeBytes: totalBytes },
        total: { sizeBytes: totalBytes },
      },
    })
  })

  test('reach an in-process caller (MCP) as the English line', async () => {
    stubbed = stubScryfallBulk({ cards: [bulkCard()] })

    const reports: RouteProgress[] = []
    await withSyntheticLocaleAsync('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      return handleCacheRefresh((report) => reports.push(report))
    })

    const mib = (gzipJsonLines([bulkCard()]).byteLength / 1024 / 1024).toFixed(2)
    expect(reports.map((report) => report.message)).toEqual([
      'Fetching bulk data metadata from Scryfall…',
      'Downloading oracle/art tags…',
      `Processing: 100% (${mib}/${mib} MiB)`,
      'Saving to cache…',
      'Done! Card cache populated.',
    ])
  })

  test('a failed download streams as a keyed error frame, its status as params', async () => {
    stubbed = stubScryfallBulk({
      cardBulk: () => new Response('nope', { status: 503, statusText: 'Service Unavailable' }),
    })

    const frames = await withSyntheticLocaleAsync('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      return readStreamFrames('/api/cache/refresh/stream')
    })

    const error = frames.find((frame) => frame.event === 'error')?.data as SyncMessage
    expect(error).toEqual({
      message: 'Failed to fetch bulk data: 503 Service Unavailable',
      messageKey: 'domain.cache.refresh.bulkFetchFailed',
      messageParams: { status: 503, statusText: 'Service Unavailable' },
    })
  })
})

describe('handleCacheRefresh behind another process’s cache lock', () => {
  /** A synthetic UI language for the server process; a leak of it is unmistakable. */
  const SYNTHETIC = { 'domain.cache.lockTimedOut': 'ZEIT UM {timeout}' }

  beforeEach(async () => {
    await ws.dispose()
    // The shortest wait the config allows. The acquirer polls once a second, so
    // each refresh below spends about 1–2 s waiting before it times out.
    ws = await bindWorkspace({
      clearCardCache: true,
      init: true,
      config: { cacheLockTimeoutSeconds: 1 },
    })
    setLogger(new MemoryLogger())
    stubbed = stubScryfallBulk({ cards: [bulkCard()] })
    // A live holder on this host: this very process, so it is never stale.
    const holder: CacheLockInfo = {
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: Date.now(),
      operation: 'bulk card cache download',
    }
    const cacheDir = path.join(ws.dir, 'cache')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(path.join(cacheDir, CACHE_LOCK_FILENAME), JSON.stringify(holder))
  })

  afterEach(() => {
    resetLogger()
  })

  /** The time-out's params as the route sends them: a duration and a nested holder. */
  const TIMED_OUT_PARAMS: SyncMessageParams = {
    timeout: { durationMs: 1000 },
    holder: {
      messageKey: 'domain.cache.lockHolder',
      messageParams: {
        operation: 'bulk card cache download',
        pid: process.pid,
        hostname: os.hostname(),
      },
    },
  }

  test('answers the time-out in English plus its key, whatever the server’s language', async () => {
    const resp = await withSyntheticLocaleAsync('xx', SYNTHETIC, async () => {
      // Vacuity guard: this process words the error in the synthetic language.
      expect(new CacheLockTimeoutError(null, 0).message).toStartWith('ZEIT UM')
      return handleCacheRefresh()
    })

    expect(resp.status).toBe(500)
    const body = (await resp.json()) as SyncMessage & { success: boolean }
    expect(body.success).toBe(false)
    expect(body.messageKey).toBe('domain.cache.lockTimedOut')
    expect(body.messageParams).toEqual(TIMED_OUT_PARAMS)
    // English, and exactly what its key and params re-render to.
    keyedMessage(body)
    expect(body.message).not.toContain('ZEIT UM')
  })

  test('streams the time-out as a keyed error frame, and a later refresh’s done frame keyed', async () => {
    const frames = await withSyntheticLocaleAsync('xx', SYNTHETIC, () =>
      readStreamFrames('/api/cache/refresh/stream'),
    )

    const error = frames.find((frame) => frame.event === 'error')?.data as SyncMessage
    expect(error.messageKey).toBe('domain.cache.lockTimedOut')
    expect(error.messageParams).toEqual(TIMED_OUT_PARAMS)
    keyedMessage(error)

    // The holder goes away; the next refresh runs to completion.
    await fs.rm(path.join(ws.dir, 'cache', CACHE_LOCK_FILENAME))
    const next = await readStreamFrames('/api/cache/refresh/stream')
    expect(next.at(-1)).toEqual({
      event: 'done',
      data: { message: 'Cache refreshed successfully', messageKey: 'admin.api.cache.refreshed' },
    })
  })
})
