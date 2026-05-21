import { describe, test, expect, afterEach } from 'bun:test'
import { refreshMode, bulkAllowed, refreshStaleAllowed, shouldBulkRefresh } from '../../src/refresh'

describe('refreshMode', () => {
  test('"ask" when no refresh flag is set', () => {
    expect(refreshMode({})).toBe('ask')
    expect(refreshMode({ refresh: true })).toBe('ask')
  })

  test('"allow" for --allow-refresh', () => {
    expect(refreshMode({ allowRefresh: true })).toBe('allow')
  })

  test('"no-bulk" for --allow-refresh-no-bulk', () => {
    expect(refreshMode({ allowRefreshNoBulk: true })).toBe('no-bulk')
  })

  test('"none" for --no-refresh (commander negates to refresh: false)', () => {
    expect(refreshMode({ refresh: false })).toBe('none')
  })

  test('no-bulk takes precedence over allow', () => {
    expect(refreshMode({ allowRefresh: true, allowRefreshNoBulk: true })).toBe('no-bulk')
  })
})

describe('bulkAllowed', () => {
  test('permits bulk only for ask and allow', () => {
    expect(bulkAllowed('ask')).toBe(true)
    expect(bulkAllowed('allow')).toBe(true)
    expect(bulkAllowed('no-bulk')).toBe(false)
    expect(bulkAllowed('none')).toBe(false)
  })
})

describe('refreshStaleAllowed', () => {
  test('refreshes stale prices for every mode except none', () => {
    expect(refreshStaleAllowed('ask')).toBe(true)
    expect(refreshStaleAllowed('allow')).toBe(true)
    expect(refreshStaleAllowed('no-bulk')).toBe(true)
    expect(refreshStaleAllowed('none')).toBe(false)
  })
})

describe('shouldBulkRefresh', () => {
  const originalIsTty = process.stdin.isTTY

  afterEach(() => {
    process.stdin.isTTY = originalIsTty
  })

  test('allow always accepts', async () => {
    expect(await shouldBulkRefresh('allow', { message: 'go?', initial: false })).toBe(true)
  })

  test('no-bulk and none always decline', async () => {
    expect(await shouldBulkRefresh('no-bulk', { message: 'go?', initial: true })).toBe(false)
    expect(await shouldBulkRefresh('none', { message: 'go?', initial: true })).toBe(false)
  })

  test('ask falls back to initial when stdin is not a TTY', async () => {
    process.stdin.isTTY = false
    expect(await shouldBulkRefresh('ask', { message: 'go?', initial: true })).toBe(true)
    expect(await shouldBulkRefresh('ask', { message: 'go?', initial: false })).toBe(false)
  })
})
