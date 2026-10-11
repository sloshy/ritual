import { describe, expect, test } from 'bun:test'
import { apiMessage, type ApiMessage } from '../../../src/api/result'
import type { MessageKey } from '../../../src/i18n/messages/en'
import { doneNotice, noticeMessage } from '../../../src/admin/site/sync-text'

/**
 * The admin sync pages' banner helpers: what they keep of an event's message,
 * and what they drop so a key this bundle does not know never prints raw.
 */

/** A key no catalog has — what a newer server's event could carry. */
const UNKNOWN_KEY = 'admin.api.fromTheFuture' as MessageKey

describe('noticeMessage', () => {
  test('keeps a known key and its params, and nothing else from the event', () => {
    const event = { ...apiMessage('admin.api.deckSync.pulled', { count: 2 }), loginRequired: false }
    expect(noticeMessage(event)).toEqual({
      message: 'Pulled 2 decks',
      messageKey: 'admin.api.deckSync.pulled',
      messageParams: { count: 2 },
    })
  })

  test('drops a key this bundle does not know, so the English shows instead', () => {
    const event: ApiMessage = {
      message: 'Something new happened.',
      messageKey: UNKNOWN_KEY,
      messageParams: { count: 1 },
    }
    expect(noticeMessage(event)).toEqual({ message: 'Something new happened.' })
  })

  test('passes message-only text through', () => {
    expect(noticeMessage({ message: 'disk is full' })).toEqual({ message: 'disk is full' })
  })
})

describe('doneNotice', () => {
  test('prefers the run summary, and falls back to the message without one', () => {
    const summary = { clauses: [apiMessage('admin.api.deckSync.pulled', { count: 1 })] }
    expect(doneNotice({ message: 'Pulled 1 deck.', summary })).toBe(summary)
    expect(doneNotice({ message: 'Pulled 1 deck.' })).toEqual({ message: 'Pulled 1 deck.' })
  })
})
