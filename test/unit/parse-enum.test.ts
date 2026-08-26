import { describe, test, expect } from 'bun:test'
import { parseEnumField } from '../../src/util/parse-enum'

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

  // The refusals carry their catalog key beside the rendered prose, so a script
  // reading `--output json` can discriminate on something that does not move
  // when the UI locale does.
  test('refuses a non-string, naming the choices', () => {
    expect(parseEnumField(7, values, 'direction')).toEqual({
      ok: false,
      message: 'direction must be one of: push, pull.',
      messageKey: 'errors.enum.type',
      messageParams: { field: 'direction', choices: 'push, pull' },
    })
  })

  test('refuses an unknown member, echoing what was sent', () => {
    expect(parseEnumField('sideways', values, 'direction')).toEqual({
      ok: false,
      message: "Invalid direction 'sideways'. Use one of: push, pull.",
      messageKey: 'errors.enum.invalid',
      // The key travels with its parameters: a client re-rendering from
      // `errors.enum.invalid` alone would print literal `{field}` tokens.
      messageParams: { field: 'direction', value: 'sideways', choices: 'push, pull' },
    })
  })

  test('matches a member that is not itself lowercase, returning its own casing', () => {
    expect(parseEnumField('mixed', ['Mixed'] as const, 'mode')).toEqual({
      ok: true,
      value: 'Mixed',
    })
  })
})
