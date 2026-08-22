import { describe, expect, test } from 'bun:test'
import { resolveKnownListSlug, setKnownLists } from '../../src/site/editor/list-slug-resolver'

describe('resolveKnownListSlug', () => {
  test('an exact name wins over a folded match; a folded name still resolves', () => {
    setKnownLists([
      { type: 'deck', slug: 'cafe', name: 'Cafe' },
      { type: 'deck', slug: 'cafe-2', name: 'Café' },
      { type: 'collection', slug: 'binder', name: 'Binder' },
    ])
    expect(resolveKnownListSlug({ type: 'deck', name: 'Café' })).toBe('cafe-2')
    expect(resolveKnownListSlug({ type: 'deck', name: 'CAFE' })).toBe('cafe')
    expect(resolveKnownListSlug({ type: 'collection', name: 'binder' })).toBe('binder')
    expect(resolveKnownListSlug({ type: 'deck', name: 'Binder' })).toBeUndefined()
    setKnownLists([])
  })
})
