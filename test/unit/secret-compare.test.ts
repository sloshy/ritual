import { describe, expect, test } from 'bun:test'
import { secretsEqual } from '../../src/util/secret-compare'

describe('secretsEqual', () => {
  test('matches only the identical secret', () => {
    expect(secretsEqual('Bearer s3cret-token', 'Bearer s3cret-token')).toBe(true)
    expect(secretsEqual('Bearer s3cret-tokeN', 'Bearer s3cret-token')).toBe(false)
  })

  test('refuses a different-length secret instead of throwing', () => {
    expect(secretsEqual('', 'Bearer s3cret-token')).toBe(false)
    expect(secretsEqual('Bearer s3cret-token-and-more', 'Bearer s3cret-token')).toBe(false)
  })
})
