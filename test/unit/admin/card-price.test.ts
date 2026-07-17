import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { isPriceStale, PRICE_STALENESS_THRESHOLD_MS } from '../../../src/admin/api/card-price'
import { getBaseDir, setBaseDir } from '../../../src/base-dir'
import { cardCache } from '../../../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../../../src/logger'

describe('isPriceStale', () => {
  test('returns true for null timestamp (never cached)', () => {
    expect(isPriceStale(null)).toBe(true)
  })

  test('returns false for a timestamp exactly at threshold', () => {
    // "more than a day old" uses strict >, so exactly at the threshold is not yet stale
    const now = Date.now()
    const exactThreshold = now - PRICE_STALENESS_THRESHOLD_MS
    expect(isPriceStale(exactThreshold, now)).toBe(false)
  })

  test('returns true for a timestamp one millisecond past the threshold', () => {
    const now = Date.now()
    const justOver = now - PRICE_STALENESS_THRESHOLD_MS - 1
    expect(isPriceStale(justOver, now)).toBe(true)
  })
})

describe('handleCardPrice', () => {
  test('returns 400 when name query param is missing', async () => {
    const { handleCardPrice } = await import('../../../src/admin/api/card-price')
    const req = new Request('http://localhost/api/card-price')
    const resp = await handleCardPrice(req)
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toContain('required')
  })
})

describe('handleCardPrice unknown card', () => {
  let dir: string
  let originalBase: string
  let originalFetch: typeof fetch

  beforeEach(async () => {
    originalBase = getBaseDir()
    originalFetch = globalThis.fetch
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-card-price-'))
    setBaseDir(dir)
    await cardCache.clear()
    setLogger(new MemoryLogger())
    // Offline Scryfall stub: every lookup 404s, so no printings can be found.
    globalThis.fetch = ((_input: string | URL | Request) =>
      Promise.resolve(
        Response.json({ object: 'error', code: 'not_found', status: 404 }, { status: 404 }),
      )) as typeof fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    resetLogger()
    await cardCache.clear()
    setBaseDir(originalBase)
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('returns 404 when no printings exist for the name', async () => {
    const { handleCardPrice } = await import('../../../src/admin/api/card-price')
    const req = new Request('http://localhost/api/card-price?name=No%20Such%20Card')
    const resp = await handleCardPrice(req)
    expect(resp.status).toBe(404)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toContain('No printings found')
  })
})
