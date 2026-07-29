import { describe, test, expect } from 'bun:test'
import { parseEnumField } from '../../src/parse-enum'

/**
 * The layer-neutral enum matcher. It backs the CLI's `parseEnumFlag` and every
 * handler that takes a string enum, so the acceptance rule and the refusal
 * wording are pinned here once rather than at each surface.
 */

describe('parseEnumField', () => {
  const values = ['push', 'pull'] as const

  test('matches case-insensitively and returns the canonical member', () => {
    for (const raw of ['push', 'PUSH', 'Push']) {
      expect(parseEnumField(raw, values, 'direction')).toEqual({ ok: true, value: 'push' })
    }
  })

  test('refuses a non-string, naming the choices', () => {
    expect(parseEnumField(7, values, 'direction')).toEqual({
      ok: false,
      message: 'direction must be one of: push, pull.',
    })
  })

  test('refuses an unknown member, echoing what was sent', () => {
    expect(parseEnumField('sideways', values, 'direction')).toEqual({
      ok: false,
      message: "Invalid direction 'sideways'. Use one of: push, pull.",
    })
  })

  test('matches a member that is not itself lowercase, returning its own casing', () => {
    expect(parseEnumField('mixed', ['Mixed'] as const, 'mode')).toEqual({
      ok: true,
      value: 'Mixed',
    })
  })
})
