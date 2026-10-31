import { describe, expect, test } from 'bun:test'
import {
  editDistance,
  MAX_LIST_NAME_SUGGESTIONS,
  suggestListNames,
} from '../../src/list/list-name-suggest'

describe('editDistance', () => {
  test.each([
    ['binder', 'binder', 0],
    ['bindr', 'binder', 1],
    ['bidner', 'binder', 1],
    ['binderx', 'binder', 1],
    ['', 'abc', 3],
    ['kitten', 'sitting', 3],
    ['ca', 'abc', 3],
    ['🃏ab', 'ab', 1],
  ] as const)('%p → %p is %p', (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected)
    expect(editDistance(b, a)).toBe(expected)
  })
})

describe('suggestListNames', () => {
  const names = ['Trade Binder 2', 'Trade Binder', 'Pauper Elves', 'Cube']

  test('suggests the existing names a typo is close to, closest first', () => {
    expect(suggestListNames(names, 'Trade Bindr')).toEqual(['Trade Binder', 'Trade Binder 2'])
  })

  test('folds case, accents and separators the way the resolver does', () => {
    expect(suggestListNames(names, 'PÁUPER-elfs')).toEqual(['Pauper Elves'])
  })

  test('a name listed twice (a deck and a collection) is suggested once', () => {
    expect(suggestListNames(['Cube', 'Cube'], 'Cub')).toEqual(['Cube'])
  })

  test('suggests nothing when no name is close', () => {
    expect(suggestListNames(names, 'Modern Burn')).toEqual([])
  })

  test('a short name allows only a single edit', () => {
    expect(suggestListNames(names, 'Cub')).toEqual(['Cube'])
    expect(suggestListNames(names, 'Cu')).toEqual([])
  })

  test('a query that folds to nothing suggests nothing', () => {
    expect(suggestListNames(names, '???')).toEqual([])
  })

  test(`caps the suggestions at ${MAX_LIST_NAME_SUGGESTIONS}`, () => {
    const many = ['Deck QAB', 'Deck QAC', 'Deck QAD', 'Deck QA']
    expect(suggestListNames(many, 'Deck Q')).toEqual(['Deck QA', 'Deck QAB', 'Deck QAC'])
  })
})
