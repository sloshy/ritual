import { describe, expect, test } from 'bun:test'
import { parseCollectionSyncState } from '../../../src/collection-sync/state'

/**
 * The account-level sync timestamp's parser. Nothing depends on the file enough
 * to fail a run over, so `readCollectionSyncState` maps every rejection to
 * "never synced" — which makes the messages here the only place the reasons are
 * visible, and the only place they can be pinned.
 */
describe('parseCollectionSyncState', () => {
  const valid = { lastSynced: '2026-07-26T12:00:00.000Z', userId: 424242, username: 'test-user' }

  test('accepts a complete state, returning it unchanged', () => {
    expect(parseCollectionSyncState(valid)).toEqual(valid)
  })

  test('accepts an empty username — an account that reported none still synced', () => {
    expect(parseCollectionSyncState({ ...valid, username: '' })).toEqual({ ...valid, username: '' })
  })

  test.each([
    [undefined, 'is not an object'],
    [null, 'is not an object'],
    ['nope', 'is not an object'],
    [42, 'is not an object'],
    [{}, "missing a 'lastSynced' timestamp"],
    [{ ...valid, lastSynced: '' }, "missing a 'lastSynced' timestamp"],
    [{ ...valid, lastSynced: 17 }, "missing a 'lastSynced' timestamp"],
    [{ lastSynced: valid.lastSynced }, "missing a numeric 'userId'"],
    [{ ...valid, userId: '424242' }, "missing a numeric 'userId'"],
    [{ ...valid, userId: 1.5 }, "missing a numeric 'userId'"],
    [{ lastSynced: valid.lastSynced, userId: 1 }, "missing a 'username'"],
    [{ ...valid, username: 7 }, "missing a 'username'"],
  ])('rejects %p', (raw, reason) => {
    const result = parseCollectionSyncState(raw)
    expect(typeof result).toBe('string')
    expect(result).toContain(reason)
  })
})
