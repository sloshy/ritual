import { describe, expect, test } from 'bun:test'
import { filterBySelection, includesAllLists } from '../../src/config/list-selection'

type Entry = { name: string }
const entry = (name: string): Entry => ({ name })
const nameOf = (e: Entry): string => e.name

describe('includesAllLists', () => {
  test('a selection is include-all exactly when it contains the wildcard', () => {
    expect(includesAllLists(['*'])).toBe(true)
    expect(includesAllLists(['Izzet Storm', '*'])).toBe(true)
    expect(includesAllLists(['Izzet Storm', 'Black Panther'])).toBe(false)
    expect(includesAllLists([])).toBe(false)
  })
})

describe('filterBySelection — include', () => {
  const entries = [entry('Izzet Storm'), entry('Black Panther'), entry('Atraxa Superfriends')]

  test('returns every entry unchanged for a wildcard selection with no exclusions', () => {
    expect(filterBySelection(entries, ['*'], [], nameOf)).toEqual(entries)
  })

  test('keeps only entries whose display name matches', () => {
    const result = filterBySelection(entries, ['Izzet Storm', 'Atraxa Superfriends'], [], nameOf)
    expect(result).toEqual([entry('Izzet Storm'), entry('Atraxa Superfriends')])
  })

  test('matches by exact display name (case-sensitive)', () => {
    expect(filterBySelection(entries, ['izzet storm'], [], nameOf)).toEqual([])
  })

  test('ignores include names that match nothing', () => {
    expect(filterBySelection(entries, ['Nonexistent Deck'], [], nameOf)).toEqual([])
  })

  test('an empty include selection includes nothing', () => {
    expect(filterBySelection(entries, [], [], nameOf)).toEqual([])
  })
})

describe('filterBySelection — exclude', () => {
  const entries = [entry('Izzet Storm'), entry('Black Panther'), entry('Atraxa Superfriends')]

  test('drops excluded names from a wildcard include', () => {
    const result = filterBySelection(entries, ['*'], ['Black Panther'], nameOf)
    expect(result).toEqual([entry('Izzet Storm'), entry('Atraxa Superfriends')])
  })

  test('exclusion wins over an explicit include of the same name', () => {
    const result = filterBySelection(
      entries,
      ['Izzet Storm', 'Black Panther'],
      ['Black Panther'],
      nameOf,
    )
    expect(result).toEqual([entry('Izzet Storm')])
  })

  test('matches exclude by exact display name (case-sensitive)', () => {
    const result = filterBySelection(entries, ['*'], ['black panther'], nameOf)
    expect(result).toEqual(entries)
  })

  test('ignores exclude names that match nothing', () => {
    expect(filterBySelection(entries, ['*'], ['Nonexistent Deck'], nameOf)).toEqual(entries)
  })

  test('excluding every included name leaves nothing', () => {
    const result = filterBySelection(entries, ['Izzet Storm'], ['Izzet Storm'], nameOf)
    expect(result).toEqual([])
  })
})
