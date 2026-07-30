import { afterEach, describe, expect, test } from 'bun:test'
import { resolvePagerMode } from '../../src/pager'
import { setNoInputOverride } from '../../src/no-input'
import { stubTty } from '../test-utils'

// `less` is only ever spawned when both ends are a terminal, so the stubs have
// to simulate one — the test process has neither.
stubTty({ stdin: true, stdout: true })
afterEach(() => setNoInputOverride(undefined))

describe('resolvePagerMode', () => {
  test('pages on a terminal with prompts available', () => {
    setNoInputOverride(false)
    expect(resolvePagerMode(false)).toBe('interactive')
  })

  test('--plain always wins', () => {
    setNoInputOverride(true)
    expect(resolvePagerMode(true)).toBe('plain')
  })

  test('a non-terminal stdout prints plainly even with a terminal stdin', () => {
    setNoInputOverride(false)
    process.stdout.isTTY = false
    expect(resolvePagerMode(false)).toBe('plain')
  })

  test('--no-input prints plainly instead of blocking in the pager', () => {
    setNoInputOverride(true)
    expect(resolvePagerMode(false)).toBe('plain')
  })

  test('a non-terminal stdin prints plainly even with a terminal stdout', () => {
    setNoInputOverride(false)
    process.stdin.isTTY = false
    expect(resolvePagerMode(false)).toBe('plain')
  })
})
