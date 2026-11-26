import { describe, expect, test } from 'bun:test'
import { pageToEvict, type PendingPageRef } from '../../../../src/mcp/oauth/pending-eviction'

/** Pages in creation order: `[address, expiresAt]` pairs, ids `p0`, `p1`, … */
function pages(...entries: [string, number][]): PendingPageRef[] {
  return entries.map(([addressKey, expiresAt], i) => ({
    requestId: `p${i}`,
    addressKey,
    expiresAt,
  }))
}

describe('pageToEvict', () => {
  test('drops the oldest page of the address holding the most, not the oldest overall', () => {
    const table = pages(['owner', 1], ['a', 5], ['b', 2], ['a', 3], ['b', 4], ['a', 6])
    // `a` holds three; its oldest is p3 (3), though `owner` (1) and `b` (2) are older.
    expect(pageToEvict(table)).toBe('p3')
  })

  test('among addresses tied for the most, the oldest of their pages goes', () => {
    const table = pages(['a', 4], ['b', 2], ['a', 5], ['b', 3], ['lone', 1])
    expect(pageToEvict(table)).toBe('p1')
  })

  test('a lone page is never chosen while any address holds more', () => {
    const table = pages(
      ['owner', 1],
      ...Array.from({ length: 50 }, (_, i): [string, number] => [`x${i}`, 10 + i]),
      ['x0', 100],
    )
    expect(pageToEvict(table)).toBe('p1')
  })

  test('when every address holds one, the oldest overall goes; same age falls back to creation order', () => {
    expect(pageToEvict(pages(['a', 7], ['b', 3], ['c', 3]))).toBe('p1')
  })

  test('reads a one-shot iterable, as the live table passes its values()', () => {
    const table = pages(['owner', 1], ['a', 5], ['b', 2], ['a', 3])
    const live = new Map(table.map((page) => [page.requestId, page]))
    expect(pageToEvict(live.values())).toBe('p3')
  })

  test('an empty table has nothing to evict', () => {
    expect(pageToEvict([])).toBeUndefined()
  })
})
