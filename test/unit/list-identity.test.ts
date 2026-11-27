import { describe, expect, test } from 'bun:test'
import {
  entriesOfList,
  entryListKey,
  findByListIdentity,
  isListIdentityKey,
  listIdentityKey,
  type ListEntryOrigin,
  type ListInfo,
} from '../../src/list/list-identity'

describe('listIdentityKey', () => {
  test('spells a list and an entry’s list as the same type:slug', () => {
    // The admin SPA persists this string (move-source selections), so its
    // spelling is a stored format, not an implementation detail.
    expect(listIdentityKey({ listType: 'collection', slug: 'binder' })).toBe('collection:binder')
    expect(entryListKey({ listType: 'collection', listSlug: 'binder' })).toBe('collection:binder')
  })

  test('a stored key is recognized only when it names a list type and a slug', () => {
    expect(isListIdentityKey('deck:a:b')).toBe(true)
    expect(isListIdentityKey('binder:a')).toBe(false)
    expect(isListIdentityKey('deck:')).toBe(false)
    expect(isListIdentityKey('deck')).toBe(false)
  })
})

describe('finding by identity', () => {
  // A deck and a collection sharing a slug, and two lists sharing a title.
  const rows: ListInfo[] = [
    { listType: 'deck', slug: 'burn', name: 'Burn' },
    { listType: 'collection', slug: 'burn', name: 'Burn' },
    { listType: 'collection', slug: 'burn-2', name: 'Burn' },
  ]

  test('a row is found by type and slug, never by name', () => {
    expect(findByListIdentity(rows, { listType: 'collection', slug: 'burn' })).toBe(rows[1])
    expect(findByListIdentity(rows, { listType: 'wanted', slug: 'burn' })).toBeUndefined()
  })

  test('entries are those of exactly one list, in order', () => {
    type Entry = ListEntryOrigin & { id: number }
    const entries: Entry[] = [
      { listType: 'deck', listSlug: 'burn', id: 1 },
      { listType: 'collection', listSlug: 'burn', id: 2 },
      { listType: 'collection', listSlug: 'burn', id: 3 },
    ]
    const found = entriesOfList(entries, { listType: 'collection', slug: 'burn' })
    expect(found.map((entry) => entry.id)).toEqual([2, 3])
  })
})
