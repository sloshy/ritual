import { describe, expect, test } from 'bun:test'
import { findListNameProblems } from '../../src/list/list-name-check'
import type { ListInfo } from '../../src/list/list-identity'

const list = (listType: ListInfo['listType'], slug: string, name: string): ListInfo => ({
  listType,
  slug,
  name,
})

describe('findListNameProblems', () => {
  test('a title that names its file is fine, characters the file name strips included', () => {
    expect(
      findListNameProblems([
        list('deck', 'Burn', 'Burn?'),
        list('collection', "Atraxa Praetors' Voice", "Atraxa: Praetors' Voice"),
        list('wanted', 'wishlist', 'wishlist'),
      ]),
    ).toEqual({ drifted: [], shared: [] })
  })

  test('a title naming another file drifted; one naming none has no slug', () => {
    expect(
      findListNameProblems([list('deck', 'old', 'Burn'), list('wanted', 'odd', '???')]).drifted,
    ).toEqual([
      { listType: 'deck', slug: 'old', name: 'Burn', titleSlug: 'Burn' },
      { listType: 'wanted', slug: 'odd', name: '???', titleSlug: null },
    ])
  })

  test('titles folding together are shared within a type, never across types', () => {
    // Fed out of order: the result is in type order, then by slug.
    const problems = findListNameProblems([
      list('collection', 'trade-binder', 'trade-binder'),
      list('deck', 'Trade Binder', 'Trade Binder'),
      list('collection', 'Trade Binder', 'Trade Binder'),
    ])
    expect(problems.shared).toEqual([
      {
        listType: 'collection',
        lists: [
          list('collection', 'Trade Binder', 'Trade Binder'),
          list('collection', 'trade-binder', 'trade-binder'),
        ],
      },
    ])
    expect(problems.drifted).toEqual([])
  })

  test('one clash per type, in type order; two drifted lists titled alike are both drift and a clash', () => {
    const problems = findListNameProblems([
      list('wanted', 'b', 'Burn'),
      list('deck', 'Red', 'Red'),
      list('wanted', 'a', 'Burn'),
      list('deck', 'red-', 'red-'),
    ])
    expect(
      problems.shared.map((clash) => [clash.listType, clash.lists.map((l) => l.slug)]),
    ).toEqual([
      ['deck', ['Red', 'red-']],
      ['wanted', ['a', 'b']],
    ])
    expect(problems.drifted.map((drift) => [drift.slug, drift.titleSlug])).toEqual([
      ['a', 'Burn'],
      ['b', 'Burn'],
    ])
  })

  test('two titles that fold to nothing share nothing', () => {
    expect(
      findListNameProblems([list('deck', 'a', '???'), list('deck', 'b', '***')]).shared,
    ).toEqual([])
  })
})
