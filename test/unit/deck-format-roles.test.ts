import { describe, expect, test } from 'bun:test'
import {
  isCommanderSection,
  isCompanionSection,
  isDroppedEmptySection,
  isExtraSection,
  isMainBoardSection,
  isMainDeckSection,
  isOathbreakerSection,
  isSideboardSection,
  SECTION_ROLES,
  sectionRole,
  type SectionRole,
} from '../../src/list/deck-format'

describe('sectionRole', () => {
  // Every alias in the table, spelled canonically.
  const aliasCases: readonly [string, SectionRole][] = (
    Object.keys(SECTION_ROLES) as SectionRole[]
  ).flatMap((role) => SECTION_ROLES[role].map((alias): [string, SectionRole] => [alias, role]))

  test.each(aliasCases)('%p is the %p role', (name, role) => {
    expect(sectionRole(name)).toBe(role)
  })

  test.each<[string, SectionRole]>([
    ['  SIDEBOARD ', 'sideboard'],
    ['Command Zone', 'commander'],
    ['\tSignature Spell\n', 'oathbreaker'],
    ['TOKEN', 'tokens'],
    ['Maybeboard', 'maybeboard'],
    ['Companion', 'companion'],
    ['DECK', 'main'],
  ])('%p matches after trimming and lowercasing', (name, role) => {
    expect(sectionRole(name)).toBe(role)
  })

  // The owner's examples: a heading that merely mentions a board word is the
  // user's own main-deck section. Matching is exact, never substring.
  test.each([
    'Token Generators',
    'Commander Damage Notes',
    'Sideboard (post-board)',
    'Creatures',
    'THE COMMANDER ZONE',
    'tokens & emblems',
    '',
  ])('%p is a main-deck section', (name) => {
    expect(sectionRole(name)).toBe('main')
  })
})

describe('section predicates are wrappers over sectionRole', () => {
  test('each predicate answers true for exactly its role', () => {
    expect(isCommanderSection('Commanders')).toBe(true)
    expect(isCommanderSection('Commander Damage Notes')).toBe(false)
    expect(isOathbreakerSection('signature spell')).toBe(true)
    expect(isOathbreakerSection('Commander')).toBe(false)
    expect(isSideboardSection(' sideboard ')).toBe(true)
    expect(isSideboardSection('Sideboard (post-board)')).toBe(false)
    expect(isCompanionSection('companion')).toBe(true)
    expect(isCompanionSection('Companion picks')).toBe(false)
  })

  test('extras are exactly the maybeboard and tokens roles', () => {
    expect(isExtraSection('Maybeboard')).toBe(true)
    expect(isExtraSection('Tokens')).toBe(true)
    expect(isExtraSection('Token')).toBe(true)
    expect(isExtraSection('Token Generators')).toBe(false)
    expect(isExtraSection('Sideboard')).toBe(false)
  })

  test('the main board is only the listed main spellings, not the main-deck catch-all', () => {
    expect(isMainBoardSection('Main')).toBe(true)
    expect(isMainBoardSection(' mainboard ')).toBe(true)
    expect(isMainBoardSection('Deck')).toBe(true)
    expect(isMainBoardSection('Creatures')).toBe(false)
    expect(isMainBoardSection('Sideboard')).toBe(false)
  })

  test('the main deck is everything but sideboard and extras', () => {
    expect(isMainDeckSection('Companion')).toBe(true)
    expect(isMainDeckSection('Sideboard (post-board)')).toBe(true)
    expect(isMainDeckSection('Sideboard')).toBe(false)
    expect(isMainDeckSection('token')).toBe(false)
  })

  test('only an empty extras section is dropped', () => {
    expect(isDroppedEmptySection({ name: 'Tokens', cards: [] })).toBe(true)
    expect(isDroppedEmptySection({ name: 'Token Generators', cards: [] })).toBe(false)
    expect(isDroppedEmptySection({ name: 'Sideboard', cards: [] })).toBe(false)
  })
})
