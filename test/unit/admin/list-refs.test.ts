import { describe, expect, test } from 'bun:test'
import {
  formatListRefParam,
  parseListRefParam,
  parseListRefParams,
} from '../../../src/admin/api/list-refs'
import { isApiMessage } from '../../../src/api/result'
import type { ListIdentity } from '../../../src/list/list-info'

describe('list reference query parameters', () => {
  test('a ref round-trips through a repeated parameter, spaces and commas kept', () => {
    const refs: ListIdentity[] = [
      { listType: 'deck', slug: 'Winota, Stax' },
      { listType: 'collection', slug: 'Trade Binder' },
      { listType: 'wanted', slug: 'needs' },
    ]
    const params = new URLSearchParams()
    for (const ref of refs) params.append('list', formatListRefParam(ref))
    const reparsed = new URLSearchParams(params.toString())
    expect(parseListRefParams(reparsed.getAll('list'))).toEqual(refs)
  })

  test.each(['deck', 'box:binder', 'deck:', ':burn', 'deck:a/b', 'deck:a\\b'])(
    '%s is refused, naming the ref',
    (raw) => {
      const parsed = parseListRefParam(raw)
      if (!isApiMessage(parsed)) throw new Error(`accepted ${raw}`)
      expect(parsed.messageKey).toBe('admin.api.listRefInvalid')
      expect(parsed.messageParams?.ref).toBe(raw)
    },
  )

  test('the type is matched case-insensitively; the slug is kept as written', () => {
    expect(parseListRefParam('Deck:Burn')).toEqual({ listType: 'deck', slug: 'Burn' })
    expect(parseListRefParam('WANTED:needs')).toEqual({ listType: 'wanted', slug: 'needs' })
  })

  test('a list named twice is kept once, first mention first', () => {
    expect(parseListRefParams(['deck:burn', 'collection:binder', 'Deck:burn'])).toEqual([
      { listType: 'deck', slug: 'burn' },
      { listType: 'collection', slug: 'binder' },
    ])
  })

  test('blanks are skipped, all-blank is [], and the first refusal stops the parse', () => {
    expect(parseListRefParams(['', ' deck:burn ', '  '])).toEqual([
      { listType: 'deck', slug: 'burn' },
    ])
    expect(parseListRefParams(['', ' '])).toEqual([])
    const refused = parseListRefParams(['deck:burn', 'deck:a/b', 'nope'])
    if (!isApiMessage(refused)) throw new Error('accepted a path separator')
    expect(refused.messageParams?.ref).toBe('deck:a/b')
  })
})
