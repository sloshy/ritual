import { describe, expect, test } from 'bun:test'
import { filterByIncludeList, includesAllLists } from '../../src/site/list-selection'

type Entry = { name: string }
const entry = (name: string): Entry => ({ name })

describe('includesAllLists', () => {
  test('treats the default ["*"] as include-all', () => {
    expect(includesAllLists(['*'])).toBe(true)
  })

  test('treats a wildcard mixed with names as include-all', () => {
    expect(includesAllLists(['Izzet Storm', '*'])).toBe(true)
  })

  test('an explicit list of names is not include-all', () => {
    expect(includesAllLists(['Izzet Storm', 'Black Panther'])).toBe(false)
  })

  test('an empty list is not include-all', () => {
    expect(includesAllLists([])).toBe(false)
  })
})

describe('filterByIncludeList', () => {
  const entries = [entry('Izzet Storm'), entry('Black Panther'), entry('Atraxa Superfriends')]

  test('returns every entry unchanged for a wildcard selection', () => {
    expect(filterByIncludeList(entries, ['*'], (e) => e.name)).toEqual(entries)
  })

  test('keeps only entries whose display name matches', () => {
    const result = filterByIncludeList(
      entries,
      ['Izzet Storm', 'Atraxa Superfriends'],
      (e) => e.name,
    )
    expect(result).toEqual([entry('Izzet Storm'), entry('Atraxa Superfriends')])
  })

  test('matches by exact display name (case-sensitive)', () => {
    expect(filterByIncludeList(entries, ['izzet storm'], (e) => e.name)).toEqual([])
  })

  test('ignores include names that match nothing', () => {
    expect(filterByIncludeList(entries, ['Nonexistent Deck'], (e) => e.name)).toEqual([])
  })

  test('an empty selection includes nothing', () => {
    expect(filterByIncludeList(entries, [], (e) => e.name)).toEqual([])
  })
})
