import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { promptsUnavailable, requireInteractive } from '../../../src/commands/card-target'
import { CardCommandError } from '../../../src/errors'
import { setNoInputOverride } from '../../../src/no-input'

// The integration harness always spawns the CLI without a TTY, so the !isTTY
// half of the prompt gate trips on its own there — only a unit test with a
// simulated terminal can prove the isNoInput() half is still in the condition.
// Same isTTY-stub pattern as test/unit/prompts-helpers.test.ts.
const originalIsTty = process.stdin.isTTY
beforeAll(() => {
  process.stdin.isTTY = true
})
afterAll(() => {
  process.stdin.isTTY = originalIsTty
})
afterEach(() => setNoInputOverride(undefined))

describe('promptsUnavailable', () => {
  test('is false on a TTY with input allowed', () => {
    setNoInputOverride(false)
    expect(promptsUnavailable()).toBe(false)
  })

  test('is true under --no-input even on a TTY', () => {
    setNoInputOverride(true)
    expect(promptsUnavailable()).toBe(true)
  })

  test('is true without a TTY even when input is allowed', () => {
    setNoInputOverride(false)
    process.stdin.isTTY = false
    try {
      expect(promptsUnavailable()).toBe(true)
    } finally {
      process.stdin.isTTY = true
    }
  })
})

describe('requireInteractive', () => {
  test('throws a usage error under --no-input even on a TTY', () => {
    setNoInputOverride(true)
    expect(() => requireInteractive('a card name or --card-id <id>')).toThrow(CardCommandError)
    try {
      requireInteractive('a card name or --card-id <id>')
      throw new Error('expected requireInteractive to throw')
    } catch (error) {
      if (!(error instanceof CardCommandError)) throw error
      expect(error.code).toBe('usage_error')
      expect(error.message).toContain('Input required: pass a card name or --card-id <id>')
    }
  })

  test('passes on a TTY with input allowed', () => {
    setNoInputOverride(false)
    expect(() => requireInteractive('a card name or --card-id <id>')).not.toThrow()
  })
})
