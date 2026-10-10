import { describe, expect, test } from 'bun:test'
import {
  findOrCreateSection,
  resolveDefaultAddSection,
  resolveSectionName,
} from '../../src/list/deck-format'
import type { DeckSection } from '../../src/list/deck'

function section(name: string, cardNames: string[] = []): DeckSection {
  return { name, cards: cardNames.map((n) => ({ quantity: 1, name: n })) }
}

describe('findOrCreateSection', () => {
  test('returns the existing section on an exact name match', () => {
    const sections = [section('Main', ['Sol Ring']), section('Sideboard')]
    const found = findOrCreateSection(sections, 'Sideboard')
    expect(found).toBe(sections[1]!)
    expect(sections).toHaveLength(2)
  })

  test('finds the section a requested name means, folding case but never substrings', () => {
    const sections = [section('Main')]
    expect(findOrCreateSection(sections, 'main')).toBe(sections[0]!)
    findOrCreateSection(sections, 'Mai')
    expect(sections.map((s) => s.name)).toEqual(['Main', 'Mai'])
  })

  test('creates and appends an empty section when missing', () => {
    const sections = [section('Main')]
    const created = findOrCreateSection(sections, 'Lands')
    expect(created).toEqual({ name: 'Lands', cards: [] })
    expect(sections[1]).toBe(created)
  })
})

describe('resolveDefaultAddSection', () => {
  test('returns the first section that is neither commander nor sideboard', () => {
    const sections = [section('Commander'), section('Sideboard'), section('Main'), section('Lands')]
    expect(resolveDefaultAddSection(sections)).toBe(sections[2]!)
  })

  test('skips the companion and the extras too: an unqualified add belongs in the main deck', () => {
    const sections = [
      section('Companion'),
      section('Maybeboard'),
      section('Tokens'),
      section('Ramp'),
    ]
    expect(resolveDefaultAddSection(sections)).toBe(sections[3]!)
  })

  test('skips commander/sideboard sections by exact, case-insensitive match', () => {
    const sections = [section(' COMMAND ZONE '), section('sideboard'), section('Spells')]
    expect(resolveDefaultAddSection(sections)).toBe(sections[2]!)
  })

  test('a section that merely mentions commander or sideboard is a main-deck section', () => {
    const sections = [section('THE COMMANDER ZONE'), section('My sideboard picks')]
    expect(resolveDefaultAddSection(sections)).toBe(sections[0]!)
  })

  test('creates and appends Main when no section is a main-deck one', () => {
    const sections = [section('Commander'), section('Sideboard')]
    const created = resolveDefaultAddSection(sections)
    expect(created).toEqual({ name: 'Main', cards: [] })
    expect(sections.map((s) => s.name)).toEqual(['Commander', 'Sideboard', 'Main'])
  })

  test('creates Main for an empty section list', () => {
    const sections: DeckSection[] = []
    const created = resolveDefaultAddSection(sections)
    expect(created.name).toBe('Main')
    expect(sections).toHaveLength(1)
  })
})

describe('resolveSectionName', () => {
  const names = ['Commander', 'Creatures', 'Lands', 'Sideboard']

  test('folds case and surrounding space', () => {
    expect(resolveSectionName(names, ' sideboard ')).toBe('Sideboard')
    expect(resolveSectionName(names, 'lands')).toBe('Lands')
  })

  test('a reserved name means the deck’s first section of that role', () => {
    expect(resolveSectionName(names, 'Main')).toBe('Creatures')
    expect(resolveSectionName(names, 'command zone')).toBe('Commander')
  })

  test('anything else is a section to create, under the requested name', () => {
    expect(resolveSectionName(names, 'Ramp')).toBe('Ramp')
    expect(resolveSectionName(names, 'Maybeboard')).toBe('Maybeboard')
  })
})
