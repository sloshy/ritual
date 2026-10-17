import { describe, expect, test } from 'bun:test'
import { assertNever, describeUnhandled, UNHANDLED_VALUE_MAX } from '../../src/util/assert-never'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import { tDynamic } from '../../src/i18n/t'
import { pseudoCatalog, withSyntheticLocale } from '../helpers/sync-text'

/** Reach the runtime throw the `never` parameter exists to make unreachable. */
function forceUnhandled(value: unknown): never {
  return assertNever(value as never)
}

describe('describeUnhandled', () => {
  test('quotes a string token as JSON, so an empty one is visible', () => {
    expect(describeUnhandled('sideways')).toBe('"sideways"')
    expect(describeUnhandled('')).toBe('""')
    expect(describeUnhandled('a\nb')).toBe('"a\\nb"')
  })

  test('names an object by its kind when it has one', () => {
    expect(describeUnhandled({ kind: 'new-kind', items: [1, 2] })).toBe('"new-kind"')
  })

  test('spells any other value as JSON', () => {
    expect(describeUnhandled({ status: 7 })).toBe('{"status":7}')
    expect(describeUnhandled(3)).toBe('3')
  })

  test('falls back to the type tag for what JSON cannot spell, never throwing', () => {
    expect(describeUnhandled(undefined)).toBe('[object Undefined]')
    expect(describeUnhandled(Symbol('s'))).toBe('[object Symbol]')
    expect(describeUnhandled(10n)).toBe('[object BigInt]')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(describeUnhandled(cyclic)).toBe('[object Object]')
  })

  test('never quotes a function’s source', () => {
    const secret = (): string => 'source-of-the-function'
    expect(describeUnhandled(secret)).toBe('[object Function]')
  })

  test('caps an oversize value with an ellipsis', () => {
    const text = describeUnhandled('x'.repeat(UNHANDLED_VALUE_MAX * 2))
    expect(text).toHaveLength(UNHANDLED_VALUE_MAX + 1)
    expect(text).toBe(`"${'x'.repeat(UNHANDLED_VALUE_MAX - 1)}…`)
  })
})

describe('assertNever', () => {
  test('throws the catalog sentence with the value interpolated', () => {
    expect(() => forceUnhandled({ kind: 'new-kind' })).toThrow('new-kind')
    expect(() => forceUnhandled({ kind: 'new-kind' })).toThrow(
      tDynamic(DEFAULT_LOCALE, 'errors.invariant.unhandled', { value: '"new-kind"' }),
    )
  })

  test('is worded in the UI language, the value left as raw data', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      const expected = tDynamic(locale, 'errors.invariant.unhandled', { value: '"sideways"' })
      expect(expected).not.toBe(
        tDynamic(DEFAULT_LOCALE, 'errors.invariant.unhandled', { value: '"sideways"' }),
      )
      expect(() => forceUnhandled('sideways')).toThrow(expected)
    })
  })
})
