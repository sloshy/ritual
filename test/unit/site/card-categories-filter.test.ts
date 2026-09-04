import { describe, expect, test } from 'bun:test'
import {
  matchesCardCategories,
  parseCardCategoryFilterInput,
  scanCardCategoryInput,
} from '../../../src/site/card-categories-filter'

describe('matchesCardCategories', () => {
  test('an empty selection leaves every card in — the filter is inactive', () => {
    expect(matchesCardCategories(undefined, [], 'include')).toBe(true)
    expect(matchesCardCategories(['Ramp'], [], 'exclude')).toBe(true)
  })

  test('both sides fold, so a Ramp selection matches a ramp card', () => {
    expect(matchesCardCategories(['ramp'], ['Ramp'], 'include')).toBe(true)
    expect(matchesCardCategories(['Ramp'], ['RAMP'], 'exact')).toBe(true)
  })

  test('include keeps a card in any selected category', () => {
    expect(matchesCardCategories(['Draw'], ['Ramp', 'Draw'], 'include')).toBe(true)
    expect(matchesCardCategories(['Removal'], ['Ramp', 'Draw'], 'include')).toBe(false)
  })

  test('exclude drops a card in any selected category', () => {
    expect(matchesCardCategories(['Draw'], ['Draw'], 'exclude')).toBe(false)
    expect(matchesCardCategories(['Removal'], ['Draw'], 'exclude')).toBe(true)
  })

  test('exact demands every selected category', () => {
    expect(matchesCardCategories(['Ramp', 'Artifacts'], ['Ramp', 'Artifacts'], 'exact')).toBe(true)
    expect(matchesCardCategories(['Ramp'], ['Ramp', 'Artifacts'], 'exact')).toBe(false)
  })

  test('a card with no categories is dropped by include and kept by exclude', () => {
    expect(matchesCardCategories(undefined, ['Ramp'], 'include')).toBe(false)
    expect(matchesCardCategories(undefined, ['Ramp'], 'exclude')).toBe(true)
  })
})

describe('scanCardCategoryInput', () => {
  test('commits on a comma only — a space inside a name never splits', () => {
    expect(scanCardCategoryInput('Board Wipes')).toEqual({ tags: [], remainder: 'Board Wipes' })
    expect(scanCardCategoryInput('Board Wipes, Ra')).toEqual({
      tags: ['Board Wipes'],
      remainder: ' Ra',
    })
  })

  test('the typed case survives', () => {
    expect(scanCardCategoryInput('Ramp,').tags).toEqual(['Ramp'])
    expect(scanCardCategoryInput('ramp,').tags).toEqual(['ramp'])
  })

  test('the tail comes back verbatim as the remainder', () => {
    expect(scanCardCategoryInput('Ramp, Arti').remainder).toBe(' Arti')
  })

  test('a refused token is dropped and the rest still commit', () => {
    expect(scanCardCategoryInput('Ra#mp, ').tags).toEqual([])
    expect(scanCardCategoryInput('Ramp, #bad, Draw,').tags).toEqual(['Ramp', 'Draw'])
  })

  test('committed names are deduped by fold', () => {
    expect(scanCardCategoryInput('Ramp, ramp,').tags).toEqual(['Ramp'])
  })
})

describe('parseCardCategoryFilterInput', () => {
  test('commits the trailing token too', () => {
    expect(parseCardCategoryFilterInput('Ramp, Artifacts')).toEqual(['Ramp', 'Artifacts'])
  })

  test('dedupes by fold, keeping the first spelling', () => {
    expect(parseCardCategoryFilterInput('Ramp, ramp')).toEqual(['Ramp'])
  })

  test('a malformed draft adds nothing rather than committing a bad name', () => {
    expect(parseCardCategoryFilterInput('Ra#mp')).toEqual([])
  })

  test('one refused entry does not discard the well-formed ones', () => {
    expect(parseCardCategoryFilterInput('Ramp, #bad, Draw')).toEqual(['Ramp', 'Draw'])
  })
})
