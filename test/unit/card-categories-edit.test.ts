import { describe, expect, test } from 'bun:test'
import {
  categoryRenameError,
  categorySuggestions,
  categoryUsageCount,
  openCategoriesPrompt,
  recordWithoutCardNames,
} from '../../src/editor/card-categories-edit'
import { closeCategoriesPrompt, pendingCategoriesPrompt } from '../../src/editor/categories-prompt'
import { resetDefaultCategories, setDefaultCategories } from '../../src/config/default-categories'
import { categoriesOf, categoriesRecord as record } from '../helpers/card-categories'

describe('categorySuggestions', () => {
  test("offers the list's own vocabulary first, then the configured defaults", () => {
    const rec = record(['Ramp'], { 'Sol Ring': ['Ramp', 'Artifacts'] })
    expect(categorySuggestions(rec, ['Draw', 'Ramp'])).toEqual(['Ramp', 'Artifacts', 'Draw'])
  })

  test('dedupes across the two sources by fold', () => {
    const rec = record([], { 'Sol Ring': ['Ramp'] })
    expect(categorySuggestions(rec, ['ramp'])).toEqual(['Ramp'])
  })

  test('a list with none falls back to the configured defaults alone', () => {
    expect(categorySuggestions(record([], {}), ['Ramp', 'Draw'])).toEqual(['Ramp', 'Draw'])
  })
})

describe('categoryRenameError', () => {
  test('refuses an empty name', () => {
    expect(categoryRenameError(['Ramp'], '   ')).not.toBeNull()
  })

  test('refuses a malformed name with the shared shape explanation', () => {
    expect(categoryRenameError(['Ramp'], 'Ra#mp')).toContain('#')
  })

  test('refuses a case-insensitive duplicate of another category', () => {
    expect(categoryRenameError(['Ramp', 'Draw'], 'ramp', 'Draw')).toContain('Ramp')
  })

  test('allows a pure case change of the category being renamed', () => {
    expect(categoryRenameError(['Ramp', 'Draw'], 'RAMP', 'Ramp')).toBeNull()
  })

  test('allows a free name', () => {
    expect(categoryRenameError(['Ramp'], 'Board Wipes')).toBeNull()
  })
})

describe('categoryUsageCount', () => {
  test('counts the cards holding a category, folding both sides', () => {
    const rec = record([], {
      'Sol Ring': ['Ramp', 'Artifacts'],
      'Arcane Signet': ['ramp'],
      'Rhystic Study': ['Draw'],
    })
    expect(categoryUsageCount(rec, 'Ramp')).toBe(2)
    expect(categoryUsageCount(rec, 'Combo')).toBe(0)
  })
})

describe('recordWithoutCardNames', () => {
  test("drops the pruned names' entries and leaves the vocabulary alone", () => {
    const rec = record(['Ramp', 'Draw'], { 'Sol Ring': ['Ramp'], 'Rhystic Study': ['Draw'] })
    const pruned = recordWithoutCardNames(rec, ['SOL RING'])
    expect(categoriesOf(pruned)).toEqual({ 'Rhystic Study': ['Draw'] })
    expect(pruned.order).toEqual(['Ramp', 'Draw'])
  })

  test('an empty prune list returns the record untouched', () => {
    const rec = record([], { 'Sol Ring': ['Ramp'] })
    expect(recordWithoutCardNames(rec, [])).toBe(rec)
  })
})

describe('openCategoriesPrompt', () => {
  test('seeds from the live record and offers vocabulary then configured defaults', () => {
    setDefaultCategories(['Removal'])
    const saved: string[][] = []
    openCategoriesPrompt(
      {
        categoriesRecord: () => record(['Ramp'], { 'Sol Ring': ['Ramp', 'Artifacts'] }),
        handleSetCategoriesFor: (_name, categories) => saved.push(categories),
      },
      'sol ring',
    )
    const prompt = pendingCategoriesPrompt()
    expect(prompt?.current).toEqual(['Ramp', 'Artifacts'])
    expect(prompt?.suggestions).toEqual(['Ramp', 'Artifacts', 'Removal'])
    prompt?.onSave(['Artifacts'])
    expect(saved).toEqual([['Artifacts']])
    closeCategoriesPrompt()
    resetDefaultCategories()
  })
})
