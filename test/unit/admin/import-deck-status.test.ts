import { describe, expect, test } from 'bun:test'
import { archidektFailureStatus } from '../../../src/admin/api/import-deck'
import { ArchidektRequestError } from '../../../src/auth/archidekt-reply'
import { syncMessage } from '../../../src/sync/message'

/**
 * Which status `POST /api/import-deck` answers a failed Archidekt deck fetch
 * with. One row per class of upstream answer; the wire is pinned through the
 * route in test/integration/import-deck-api.test.ts. A rate limit that outlived
 * its retries is pinned here rather than there: reaching it through the route
 * would sit out the whole backoff curve (a minute of real sleeps).
 */
describe('archidektFailureStatus', () => {
  test.each<[string, number, number]>([
    ['no such deck', 404, 404],
    ['a deck Archidekt will not show', 403, 502],
    ['a rate limit that outlived its retries', 429, 502],
    ['Archidekt failing', 503, 502],
    ['a reply that could not be read', 200, 502],
  ])('%s (upstream %d) answers %d', (_label, upstream, status) => {
    const error = new ArchidektRequestError(
      syncMessage('domain.sync.archidekt.replyNotObject'),
      upstream,
    )
    expect(archidektFailureStatus(error)).toBe(status)
  })
})
