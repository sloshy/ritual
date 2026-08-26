import { describe, test, expect, afterEach } from 'bun:test'
import prompts from 'prompts'
import { bulkAllowed, refreshStaleAllowed, shouldBulkRefresh } from '../../src/cache/refresh'
import { setNoInputOverride } from '../../src/util/no-input'

describe('bulkAllowed', () => {
  test('permits bulk only for ask and auto', () => {
    expect(bulkAllowed('ask')).toBe(true)
    expect(bulkAllowed('auto')).toBe(true)
    expect(bulkAllowed('no-bulk')).toBe(false)
    expect(bulkAllowed('never')).toBe(false)
  })
})

describe('refreshStaleAllowed', () => {
  test('refreshes stale prices for every mode except never', () => {
    expect(refreshStaleAllowed('ask')).toBe(true)
    expect(refreshStaleAllowed('auto')).toBe(true)
    expect(refreshStaleAllowed('no-bulk')).toBe(true)
    expect(refreshStaleAllowed('never')).toBe(false)
  })
})

describe('shouldBulkRefresh', () => {
  const originalIsTty = process.stdin.isTTY

  afterEach(() => {
    process.stdin.isTTY = originalIsTty
    setNoInputOverride(undefined)
  })

  test('auto always accepts', async () => {
    expect(await shouldBulkRefresh('auto', { message: 'go?', initial: false })).toBe(true)
  })

  test('no-bulk and never always decline', async () => {
    expect(await shouldBulkRefresh('no-bulk', { message: 'go?', initial: true })).toBe(false)
    expect(await shouldBulkRefresh('never', { message: 'go?', initial: true })).toBe(false)
  })

  test('ask always declines when stdin is not a TTY, whatever the prompt default', async () => {
    process.stdin.isTTY = false
    expect(await shouldBulkRefresh('ask', { message: 'go?', initial: true })).toBe(false)
    expect(await shouldBulkRefresh('ask', { message: 'go?', initial: false })).toBe(false)
  })

  test('ask always declines under --no-input, even on a TTY', async () => {
    process.stdin.isTTY = true
    setNoInputOverride(true)
    expect(await shouldBulkRefresh('ask', { message: 'go?', initial: true })).toBe(false)
  })

  test('ask on a TTY with prompts enabled follows an accepting answer', async () => {
    process.stdin.isTTY = true
    setNoInputOverride(false)
    prompts.inject([true])
    expect(await shouldBulkRefresh('ask', { message: 'go?', initial: false })).toBe(true)
  })

  test('ask on a TTY with prompts enabled follows a declining answer', async () => {
    process.stdin.isTTY = true
    setNoInputOverride(false)
    prompts.inject([false])
    expect(await shouldBulkRefresh('ask', { message: 'go?', initial: true })).toBe(false)
  })
})
