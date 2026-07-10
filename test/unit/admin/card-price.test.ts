import { describe, test, expect } from 'bun:test'
import { isPriceStale, PRICE_STALENESS_THRESHOLD_MS } from '../../../src/admin/api/card-price'

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
