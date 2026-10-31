import { describe, expect, test } from 'bun:test'
import {
  isLookupDue,
  lookupLatestVersion,
  recordLookup,
  recordNotice,
  UPDATE_CHECK_ABANDON_RETRY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_RETRY_MS,
  UPDATE_NOTICE_INTERVAL_MS,
  updateCheckEligibility,
  versionToAnnounce,
  type UpdateCheckEligibility,
  type UpdateCheckGate,
} from '../../../src/update/notice'
import type { UpdateCheckState } from '../../../src/util/user-state'
import { FAKE_API, fakeRelease, fakeReleaseApiEnv, hangingFetch } from '../../helpers/fake-release'

const NOW = 1_000_000_000_000
const HOUR = 60 * 60 * 1000

describe('isLookupDue', () => {
  test.each<[string, UpdateCheckState | undefined, boolean]>([
    ['no cache yet', undefined, true],
    [
      'a success within the day',
      { channel: 'stable', checkedAt: NOW - 23 * HOUR, latest: '1.0.0' },
      false,
    ],
    [
      'a success a day old',
      { channel: 'stable', checkedAt: NOW - UPDATE_CHECK_INTERVAL_MS, latest: '1.0.0' },
      true,
    ],
    ['a failure within the hour', { channel: 'stable', failedAt: NOW - HOUR / 2 }, false],
    ['a failure an hour old', { channel: 'stable', failedAt: NOW - UPDATE_CHECK_RETRY_MS }, true],
    [
      'a stale success but a recent failure',
      { channel: 'stable', checkedAt: NOW - 30 * HOUR, latest: '1.0.0', failedAt: NOW - 1000 },
      false,
    ],
    [
      'a fresh success for the other channel',
      { channel: 'prerelease', checkedAt: NOW, latest: '1.0.0' },
      true,
    ],
    ['a recent failure on the other channel', { channel: 'prerelease', failedAt: NOW }, true],
    [
      'an abandoned attempt within ten minutes',
      { channel: 'stable', abandonedAt: NOW - UPDATE_CHECK_ABANDON_RETRY_MS + 1 },
      false,
    ],
    [
      'an abandoned attempt ten minutes old',
      { channel: 'stable', abandonedAt: NOW - UPDATE_CHECK_ABANDON_RETRY_MS },
      true,
    ],
    // A clock that moved backwards must not silence the check for good.
    [
      'a success in the future',
      { channel: 'stable', checkedAt: NOW + HOUR, latest: '1.0.0' },
      true,
    ],
  ])('%s', (_label, state, due) => {
    expect(isLookupDue(state, 'stable', NOW)).toBe(due)
  })
})

describe('recordLookup', () => {
  const notified = { notifiedAt: NOW - HOUR, notifiedVersion: '1.1.0' }

  test('a success replaces the lookup fields and keeps when the notice spoke', () => {
    const before: UpdateCheckState = { channel: 'stable', failedAt: NOW - 2 * HOUR, ...notified }
    expect(recordLookup(before, 'stable', { kind: 'found', version: '1.2.0' }, NOW)).toEqual({
      channel: 'stable',
      checkedAt: NOW,
      latest: '1.2.0',
      ...notified,
    })
  })

  test('a failure on the same channel keeps the last answer and records the attempt', () => {
    const before: UpdateCheckState = {
      channel: 'stable',
      checkedAt: NOW - 30 * HOUR,
      latest: '1.1.0',
    }
    const after = recordLookup(before, 'stable', { kind: 'failed' }, NOW)
    expect(after).toEqual({ ...before, failedAt: NOW })
    expect(isLookupDue(after, 'stable', NOW + HOUR - 1)).toBeFalse()
    expect(isLookupDue(after, 'stable', NOW + HOUR)).toBeTrue()
  })

  test('an abandoned attempt is recorded apart from a failure, for its shorter retry', () => {
    const before: UpdateCheckState = {
      channel: 'stable',
      checkedAt: NOW - 30 * HOUR,
      latest: '1.1.0',
    }
    expect(recordLookup(before, 'stable', { kind: 'abandoned' }, NOW)).toEqual({
      ...before,
      abandonedAt: NOW,
    })
  })

  test('a failure after a channel switch drops the other channel’s answer', () => {
    const before: UpdateCheckState = {
      channel: 'prerelease',
      checkedAt: NOW,
      latest: '2.0.0-beta1',
      ...notified,
    }
    expect(recordLookup(before, 'stable', { kind: 'failed' }, NOW)).toEqual({
      channel: 'stable',
      failedAt: NOW,
      ...notified,
    })
  })
})

describe('versionToAnnounce', () => {
  const cached = (fields: Partial<UpdateCheckState> = {}): UpdateCheckState => ({
    channel: 'stable',
    checkedAt: NOW - HOUR,
    latest: '1.2.0',
    ...fields,
  })

  test.each<[string, UpdateCheckState | undefined, string, string | undefined]>([
    ['a newer release', cached(), '1.1.0', '1.2.0'],
    ['the running release', cached(), '1.2.0', undefined],
    ['an older release', cached(), '1.3.0', undefined],
    ['no cache', undefined, '1.1.0', undefined],
    ['nothing found yet', { channel: 'stable', failedAt: NOW }, '1.1.0', undefined],
    ['an answer for the other channel', cached({ channel: 'prerelease' }), '1.1.0', undefined],
    [
      'an announcement within the day',
      cached({ notifiedAt: NOW - 23 * HOUR, notifiedVersion: '1.2.0' }),
      '1.1.0',
      undefined,
    ],
    [
      'an announcement a day old',
      cached({ notifiedAt: NOW - UPDATE_NOTICE_INTERVAL_MS, notifiedVersion: '1.2.0' }),
      '1.1.0',
      '1.2.0',
    ],
    // Once a day per *version*: a release newer than the one announced speaks at once.
    [
      'a newer release than the one announced',
      cached({ notifiedAt: NOW - HOUR, notifiedVersion: '1.1.5' }),
      '1.1.0',
      '1.2.0',
    ],
    [
      'an announcement in the future',
      cached({ notifiedAt: NOW + HOUR, notifiedVersion: '1.2.0' }),
      '1.1.0',
      '1.2.0',
    ],
    [
      'a stable release to a prerelease of it (an explicit stable channel)',
      cached(),
      '1.2.0-beta3',
      '1.2.0',
    ],
  ])('%s', (_label, state, current, expected) => {
    expect(versionToAnnounce(state, 'stable', current, NOW)).toBe(expected)
  })

  test('recordNotice silences the version it announced for a day', () => {
    const state = recordNotice(cached(), '1.2.0', NOW)
    expect(versionToAnnounce(state, 'stable', '1.1.0', NOW + 1)).toBeUndefined()
    expect(versionToAnnounce(state, 'stable', '1.1.0', NOW + UPDATE_NOTICE_INTERVAL_MS)).toBe(
      '1.2.0',
    )
  })
})

describe('lookupLatestVersion', () => {
  test('answers with the channel’s newest release', async () => {
    const urls: string[] = []
    const env = fakeReleaseApiEnv(async (url) => {
      urls.push(String(url))
      return Response.json(fakeRelease('v1.4.0').json)
    })
    expect(await lookupLatestVersion(env, 'stable')).toEqual({ kind: 'found', version: '1.4.0' })
    expect(urls).toEqual([`${FAKE_API}/releases/latest`])
  })

  test.each<[string, () => Promise<Response>]>([
    ['an HTTP error', async () => new Response('nope', { status: 500 })],
    ['a network error', () => Promise.reject(new Error('offline'))],
    ['a body that is not a release', async () => Response.json({ tag_name: 'nightly' })],
  ])('%s is a failed lookup, never a rejection', async (_label, answer) => {
    expect(await lookupLatestVersion(fakeReleaseApiEnv(answer), 'stable')).toEqual({
      kind: 'failed',
    })
  })

  test('cancelling abandons a request that would never answer', async () => {
    let seen: AbortSignal | undefined
    const env = fakeReleaseApiEnv(
      hangingFetch((signal) => {
        seen = signal
      }),
    )
    const cancel = new AbortController()
    const pending = lookupLatestVersion(env, 'stable', cancel.signal)
    cancel.abort()
    expect(await pending).toEqual({ kind: 'failed' })
    expect(seen?.aborted).toBeTrue()
  })
})

describe('updateCheckEligibility', () => {
  // The rule the notice gates on and `ritual doctor` reports: the Docker image
  // is updated by pulling it, so it wins over everything; then the build.
  test.each<[string, UpdateCheckGate, UpdateCheckEligibility]>([
    ['a release build', { release: true, installKind: undefined, optedOut: false }, 'on'],
    ['an opted-out release', { release: true, installKind: undefined, optedOut: true }, 'off'],
    [
      'a development build',
      { release: false, installKind: undefined, optedOut: false },
      'development',
    ],
    ['the Docker image', { release: true, installKind: 'docker', optedOut: true }, 'docker'],
  ])('%s → %s', (_label, gate, expected) => {
    expect(updateCheckEligibility(gate)).toBe(expected)
  })
})
