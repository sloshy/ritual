import { describe, expect, test } from 'bun:test'
import {
  archidektCategoryBoard,
  archidektEntrySection,
  archidektRoleCategories,
  collectArchidektCategories,
  composeArchidektCategories,
  indexArchidektCategories,
} from '../../src/importers/archidekt-categories'
import {
  parseArchidektDeckCategories,
  parseArchidektDeckResponse,
  type ArchidektCategory,
} from '../../src/importers/archidekt-types'

/**
 * A deck's category definitions as Archidekt serves them — the flags are what
 * tell a board from a role. Modelled on a real Commander deck.
 */
const DEFINITIONS: ArchidektCategory[] = [
  { id: 1, name: 'Commander', isPremier: true, includedInDeck: true },
  { id: 2, name: 'Tokens & Extras', isPremier: false, includedInDeck: false },
  { id: 3, name: 'Sideboard', isPremier: false, includedInDeck: false },
  { id: 4, name: 'Tokens', isPremier: false, includedInDeck: true },
  { id: 5, name: 'Ramp', isPremier: false, includedInDeck: true },
  { id: 6, name: 'Partners', isPremier: true, includedInDeck: true },
]
const INDEX = indexArchidektCategories(DEFINITIONS)

describe('archidektCategoryBoard', () => {
  test('a section alias is a board, whatever its flags', () => {
    expect(archidektCategoryBoard('Commander', INDEX)).toBe('commander')
    expect(archidektCategoryBoard('Sideboard', INDEX)).toBe('sideboard')
    expect(archidektCategoryBoard('maybeboard', indexArchidektCategories([]))).toBe('maybeboard')
    expect(archidektCategoryBoard('Mainboard', INDEX)).toBe('main')
  })

  test('the flags decide a name that is not an alias', () => {
    expect(archidektCategoryBoard('Partners', INDEX)).toBe('commander')
    expect(archidektCategoryBoard('Tokens & Extras', INDEX)).toBe('maybeboard')
  })

  test('Tokens counted in the deck is a role (token makers), not the tokens board', () => {
    expect(archidektCategoryBoard('Tokens', INDEX)).toBeUndefined()
    const excluded = indexArchidektCategories([{ id: 9, name: 'Tokens', includedInDeck: false }])
    expect(archidektCategoryBoard('Tokens', excluded)).toBe('tokens')
  })

  test('a name the table does not know is a role, not a substring match', () => {
    expect(archidektCategoryBoard('Ramp', INDEX)).toBeUndefined()
    // The old parser read any name *containing* "commander" as the command zone.
    expect(archidektCategoryBoard('Commander Staples', INDEX)).toBeUndefined()
  })
})

describe('archidektEntrySection', () => {
  test('the command zone outranks every other board, and no board is Main', () => {
    expect(archidektEntrySection(['Ramp', 'Sideboard', 'Commander'], INDEX)).toBe('Commander')
    expect(archidektEntrySection(['Ramp', 'Tokens'], INDEX)).toBe('Main')
    expect(archidektEntrySection(null, INDEX)).toBe('Main')
    expect(archidektEntrySection(['Tokens & Extras'], INDEX)).toBe('Maybeboard')
  })
})

describe('archidektRoleCategories', () => {
  test('keeps the role categories in relation order and drops the boards', () => {
    expect(archidektRoleCategories(['Commander', 'Ramp', 'Tokens', 'ramp'], INDEX)).toEqual({
      categories: ['Ramp', 'Tokens'],
      refused: [],
    })
  })

  test('a name Ritual cannot store is reported, not kept', () => {
    expect(archidektRoleCategories(['Ramp', 'Bad\u0001Name'], INDEX)).toEqual({
      categories: ['Ramp'],
      refused: ['Bad\u0001Name'],
    })
  })
})

describe('collectArchidektCategories', () => {
  test('unions a card’s relations in order, so the first relation’s primary stays primary', () => {
    const collected = collectArchidektCategories(
      [
        { cardName: 'Sol Ring', categories: ['Ramp', 'Artifacts'] },
        { cardName: 'Island', categories: ['Land'] },
        { cardName: 'sol ring', categories: ['Artifacts', 'Staples'] },
        { cardName: 'Winota, Joiner of Forces', categories: ['Commander'] },
      ],
      INDEX,
    )
    expect(collected.cards).toEqual([
      { name: 'Sol Ring', categories: ['Ramp', 'Artifacts', 'Staples'] },
      { name: 'Island', categories: ['Land'] },
    ])
  })
})

describe('composeArchidektCategories', () => {
  test('keeps the relation’s boards and replaces its roles with the local ones', () => {
    expect(composeArchidektCategories(['Commander', 'Ramp'], INDEX, ['Draw', 'Ramp'])).toEqual([
      'Commander',
      'Draw',
      'Ramp',
    ])
  })

  test('an uncategorized local card clears the roles; a null relation reads as none', () => {
    expect(composeArchidektCategories(['Sideboard', 'Ramp'], INDEX, [])).toEqual(['Sideboard'])
    expect(composeArchidektCategories(null, INDEX, ['Ramp'])).toEqual(['Ramp'])
  })
})

describe('parseArchidektDeckResponse / parseArchidektDeckCategories', () => {
  const deck = {
    name: 'Winota Stax',
    categories: DEFINITIONS,
    cards: [
      {
        card: { name: 'Winota', oracleCard: { name: 'Winota' } },
        quantity: 1,
        categories: ['Commander'],
      },
      {
        card: { name: 'Sol Ring', oracleCard: { name: 'Sol Ring' } },
        quantity: 1,
        categories: ['Ramp'],
      },
      // An old payload names categories by id.
      { card: { name: 'Goblin', oracleCard: { name: 'Goblin' } }, quantity: 1, categories: [2] },
      {
        card: { name: 'Mountain', oracleCard: { name: 'Mountain' } },
        quantity: 5,
        categories: null,
      },
    ],
  }

  test('sections come from the board rule, including an extras category by id', () => {
    const parsed = parseArchidektDeckResponse(deck, '1')
    expect(
      parsed.sections.map((section) => [section.name, section.cards.map((c) => c.name)]),
    ).toEqual([
      ['Commander', ['Winota']],
      ['Main', ['Sol Ring', 'Mountain']],
      ['Maybeboard', ['Goblin']],
    ])
  })

  test('categories hold only the roles', () => {
    expect(parseArchidektDeckCategories(deck)).toEqual({
      cards: [{ name: 'Sol Ring', categories: ['Ramp'] }],
      refused: [],
    })
  })
})
