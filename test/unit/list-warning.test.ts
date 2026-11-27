import { describe, expect, test } from 'bun:test'
import { listIdentityOf, listWarning } from '../../src/list/list-info'
import { syncMessage } from '../../src/sync/message'

describe('listIdentityOf', () => {
  test("a located list's identity is its type and its file's basename", () => {
    expect(listIdentityOf({ type: 'deck', filePath: '/workspace/decks/Winota, Stax.md' })).toEqual({
      listType: 'deck',
      slug: 'Winota, Stax',
    })
  })
})

describe('listWarning', () => {
  test('nests the cause under the list name, the identity beside the message', () => {
    const cause = syncMessage('domain.list.summary.cacheEmpty')
    const warning = listWarning(
      'domain.price.inList',
      { listType: 'collection', slug: 'binder', name: 'Trade Binder' },
      cause,
    )
    expect(warning).toEqual({
      message: `Trade Binder: ${cause.message}`,
      messageKey: 'domain.price.inList',
      messageParams: {
        list: 'Trade Binder',
        cause: { messageKey: 'domain.list.summary.cacheEmpty' },
      },
      list: { listType: 'collection', slug: 'binder' },
    })
  })
})
