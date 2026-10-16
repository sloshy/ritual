import { describe, expect, test } from 'bun:test'
import { parseSetCode } from '../../src/card/set-codes'
import { keyedMessage } from '../helpers/api-message'

describe('parseSetCode', () => {
  test('lowercases a code of letters, digits and underscores', () => {
    expect(parseSetCode(' MKM ')).toEqual({ ok: true, code: 'mkm' })
    expect(parseSetCode('PLST_X')).toEqual({ ok: true, code: 'plst_x' })
  })

  test('refuses anything else in English plus its key, the code as typed', () => {
    const result = parseSetCode('../etc')
    if (result.ok) throw new Error('expected a refusal')
    expect(result.error.messageKey).toBe('domain.card.setCode.invalid')
    expect(keyedMessage(result.error)).toBe("Invalid set code '../etc'.")
  })
})
