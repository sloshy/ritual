import { describe, test, expect, afterEach } from 'bun:test'
import { isNoInput, resolveNoInput, setNoInputOverride } from '../../src/no-input'

const originalEnv = process.env.RITUAL_NO_INPUT

afterEach(() => {
  setNoInputOverride(undefined)
  if (originalEnv === undefined) {
    delete process.env.RITUAL_NO_INPUT
  } else {
    process.env.RITUAL_NO_INPUT = originalEnv
  }
})

describe('resolveNoInput', () => {
  test('an explicit CLI value wins over the environment', () => {
    expect(resolveNoInput(true, '')).toBe(true)
    expect(resolveNoInput(true, undefined)).toBe(true)
    expect(resolveNoInput(false, '1')).toBe(false)
  })

  test('falls back to RITUAL_NO_INPUT when the CLI value is absent', () => {
    expect(resolveNoInput(undefined, '1')).toBe(true)
    expect(resolveNoInput(undefined, 'true')).toBe(true)
    expect(resolveNoInput(undefined, undefined)).toBe(false)
  })

  test('a blank or whitespace-only env value does not count as set', () => {
    expect(resolveNoInput(undefined, '')).toBe(false)
    expect(resolveNoInput(undefined, '   ')).toBe(false)
  })
})

describe('isNoInput', () => {
  test('returns the override once set', () => {
    setNoInputOverride(true)
    expect(isNoInput()).toBe(true)
    setNoInputOverride(false)
    expect(isNoInput()).toBe(false)
  })

  test('an override of false beats a set environment variable', () => {
    process.env.RITUAL_NO_INPUT = '1'
    setNoInputOverride(false)
    expect(isNoInput()).toBe(false)
  })

  test('falls back to the environment when the setter never ran (or was cleared)', () => {
    setNoInputOverride(undefined)
    process.env.RITUAL_NO_INPUT = '1'
    expect(isNoInput()).toBe(true)
    delete process.env.RITUAL_NO_INPUT
    expect(isNoInput()).toBe(false)
  })
})
