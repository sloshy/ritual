import { describe, expect, test } from 'bun:test'
import {
  canonicalSection,
  moveBaselineSection,
  sectionInfoFrom,
  sectionNameError,
  typedSectionHeading,
} from '../../src/editor/section-edits'
import { withSyntheticLocale } from '../helpers/sync-text'
import { DEFAULT_SECTION } from '../../src/list/deck'
import { makeContextInfo } from '../test-utils'

const ORDER = ['Commander', 'Main', 'Sideboard']

describe('canonicalSection', () => {
  test('resolves a typed name to the existing section ignoring case', () => {
    expect(canonicalSection(ORDER, 'main')).toBe('Main')
    expect(canonicalSection(ORDER, 'MAIN')).toBe('Main')
  })

  test('answers undefined for a name no section has', () => {
    expect(canonicalSection(ORDER, 'Maybeboard')).toBeUndefined()
  })
})

describe('sectionNameError', () => {
  test('a blank name is required', () => {
    expect(sectionNameError(ORDER, '   ')).toEqual({ kind: 'required' })
  })

  test('a new name clashing with an existing section case-insensitively is refused, naming the canonical spelling', () => {
    expect(sectionNameError(ORDER, ' sideboard ')).toEqual({ kind: 'exists', clash: 'Sideboard' })
  })

  test('a rename may keep its own name, including as a pure case change', () => {
    expect(sectionNameError(ORDER, 'Main', 'Main')).toBeNull()
    expect(sectionNameError(ORDER, 'MAIN', 'Main')).toBeNull()
  })

  test('a rename onto a different existing section is still a clash', () => {
    expect(sectionNameError(ORDER, 'sideboard', 'Main')).toEqual({
      kind: 'exists',
      clash: 'Sideboard',
    })
  })

  test('a fresh name is accepted', () => {
    expect(sectionNameError(ORDER, 'Maybeboard')).toBeNull()
  })
})

describe('sectionInfoFrom', () => {
  test('keeps the display order and counts an empty section as zero', () => {
    expect(sectionInfoFrom(ORDER, { Main: 60, Sideboard: 15 })).toEqual([
      { name: 'Commander', count: 0 },
      { name: 'Main', count: 60 },
      { name: 'Sideboard', count: 15 },
    ])
  })
})

describe('moveBaselineSection', () => {
  const target = makeContextInfo({ cardName: 'Sol Ring', cardIds: [1] })
  type OriginalData = { section?: string }
  const sectionOf = (data: OriginalData): string | undefined => data.section

  test('reads the section the card held in the on-disk original', () => {
    expect(moveBaselineSection({ section: 'Sideboard' }, target, sectionOf)).toBe('Sideboard')
  })

  test('a card the original does not hold baselines to the default section', () => {
    expect(moveBaselineSection({}, target, sectionOf)).toBe(DEFAULT_SECTION)
    expect(moveBaselineSection(null, target, sectionOf)).toBe(DEFAULT_SECTION)
  })

  test('a list without section lookup baselines to the default section', () => {
    expect(moveBaselineSection({ section: 'Sideboard' }, target, undefined)).toBe(DEFAULT_SECTION)
  })
})

describe('a board typed in the UI language', () => {
  const GERMAN = { 'domain.board.sideboard': 'Seitenboard' }

  test('clashes with the board the list has, and is written as its English heading', () => {
    withSyntheticLocale('de', GERMAN, () => {
      expect(canonicalSection(['Main', 'Sideboard'], 'Seitenboard')).toBe('Sideboard')
      expect(sectionNameError(['Main', 'Sideboard'], 'Seitenboard')).toEqual({
        kind: 'exists',
        clash: 'Sideboard',
      })
      expect(typedSectionHeading(['Main'], 'Seitenboard')).toBe('Sideboard')
    })
  })

  test('a pure case change of an existing heading keeps the casing typed', () => {
    expect(typedSectionHeading(['Main', 'sideboard'], 'Sideboard')).toBe('Sideboard')
    expect(sectionNameError(['Main', 'sideboard'], 'Sideboard', 'sideboard')).toBeNull()
  })
})

describe('sectionInfoFrom — prototype names', () => {
  test('a section named after an Object property counts its own cards only', () => {
    expect(sectionInfoFrom(['constructor', '__proto__'], {})).toEqual([
      { name: 'constructor', count: 0 },
      { name: '__proto__', count: 0 },
    ])
  })
})

describe('a custom heading that reads like a board, under German', () => {
  const GERMAN = { 'domain.board.sideboard': 'Seitenboard' }
  const ORDER_DE = ['Main', 'Seitenboard']

  test('Add of "Sideboard" is no duplicate, and writes the Sideboard', () => {
    withSyntheticLocale('de', GERMAN, () => {
      expect(sectionNameError(ORDER_DE, 'Sideboard')).toBeNull()
      expect(typedSectionHeading(ORDER_DE, 'Sideboard')).toBe('Sideboard')
    })
  })

  test('Rename of `Seitenboard` to "Sideboard" renames it to the board', () => {
    withSyntheticLocale('de', GERMAN, () => {
      expect(sectionNameError(ORDER_DE, 'Sideboard', 'Seitenboard')).toBeNull()
      expect(typedSectionHeading(ORDER_DE, 'Sideboard')).toBe('Sideboard')
    })
  })
})
