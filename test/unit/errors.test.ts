import { describe, expect, test } from 'bun:test'
import { hasErrorCode } from '../../src/util/errors'

describe('hasErrorCode', () => {
  test('matches a Node errno error carrying the code', () => {
    const error: NodeJS.ErrnoException = Object.assign(new Error('missing'), { code: 'ENOENT' })
    expect(hasErrorCode(error, 'ENOENT')).toBeTrue()
  })

  test('rejects a mismatched code', () => {
    const error: NodeJS.ErrnoException = Object.assign(new Error('exists'), { code: 'EEXIST' })
    expect(hasErrorCode(error, 'ENOENT')).toBeFalse()
  })

  test('tolerates non-object and codeless thrown values', () => {
    expect(hasErrorCode('ENOENT', 'ENOENT')).toBeFalse()
    expect(hasErrorCode(null, 'ENOENT')).toBeFalse()
    expect(hasErrorCode(undefined, 'ENOENT')).toBeFalse()
    expect(hasErrorCode(new Error('no code'), 'ENOENT')).toBeFalse()
  })
})
