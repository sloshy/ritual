import { describe, test, expect, afterEach } from 'bun:test'
import { Command } from 'commander'
import prompts from 'prompts'
import {
  addRefreshOption,
  bulkAllowed,
  parseRefreshFlag,
  refreshStaleAllowed,
  shouldBulkRefresh,
} from '../../src/refresh'
import { setNoInputOverride } from '../../src/no-input'

describe('parseRefreshFlag', () => {
  test('accepts the four modes', () => {
    expect(parseRefreshFlag('ask')).toBe('ask')
    expect(parseRefreshFlag('auto')).toBe('auto')
    expect(parseRefreshFlag('no-bulk')).toBe('no-bulk')
    expect(parseRefreshFlag('never')).toBe('never')
  })

  test('is case-insensitive', () => {
    expect(parseRefreshFlag('AUTO')).toBe('auto')
    expect(parseRefreshFlag('Never')).toBe('never')
  })

  test('rejects anything else, listing the valid modes', () => {
    expect(() => parseRefreshFlag('allow')).toThrow('ask, auto, no-bulk, never')
    expect(() => parseRefreshFlag('')).toThrow("Invalid refresh mode ''")
  })
})

describe('addRefreshOption', () => {
  test('registers --refresh <mode> defaulting to ask', () => {
    const command = addRefreshOption(new Command('x'))
    command.parse([], { from: 'user' })
    expect(command.opts().refresh).toBe('ask')
  })

  test('parses an explicit mode through parseRefreshFlag', () => {
    const command = addRefreshOption(new Command('x'))
    command.parse(['--refresh', 'no-bulk'], { from: 'user' })
    expect(command.opts().refresh).toBe('no-bulk')
  })
})

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
