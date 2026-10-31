import { describe, expect, test } from 'bun:test'
import {
  DECK_FORMAT_KEYS,
  findOrCreateSection,
  formatHasCommandZone,
  newDeckSections,
  resolveDefaultAddSection,
  resolveSectionName,
  resolveTypedSectionName,
  sectionDisplayName,
  sectionDisplayNames,
  sectionNameParam,
} from '../../src/list/deck-format'
import type { DeckSection } from '../../src/list/deck'
import {
  newDeckFrontMatter,
  newDeckMarkdown,
  serializeDeckToMarkdown,
} from '../../src/list/deck-file'
import { parseDeckText } from '../../src/importers/text-file'
import { pseudoCatalog, pseudoString, withSyntheticLocale } from '../helpers/sync-text'

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

describe('sectionDisplayName / sectionNameParam', () => {
  test('a standard board reads in the UI language, matched trimmed and case-folded', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), () => {
      expect(sectionDisplayName('Sideboard')).toBe(pseudoString('domain.board.sideboard'))
      expect(sectionDisplayName(' maybeboard ')).toBe(pseudoString('domain.board.maybeboard'))
      expect(sectionDisplayName('MAIN')).toBe(pseudoString('domain.board.main'))
      expect(sectionDisplayName('Commander')).toBe(pseudoString('domain.board.commander'))
    })
  })

  test("any other section is the owner's own text, exactly as written", () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), () => {
      // Role aliases are not the four boards: only those translate.
      for (const name of ['Creatures', 'Mainboard', 'Tokens', 'Commanders', 'Side board ']) {
        expect(sectionDisplayName(name)).toBe(name)
        expect(sectionNameParam(name)).toBe(name)
      }
    })
  })

  test('the heading holds a board unrendered, so it renders in its reader’s locale', () => {
    expect(sectionNameParam('Sideboard')).toEqual({ messageKey: 'domain.board.sideboard' })
  })

  test('a case-folded heading is the board: it displays as the board in English too', () => {
    expect(sectionDisplayName('sideboard')).toBe('Sideboard')
    expect(sectionNameParam('MAIN')).toEqual({ messageKey: 'domain.board.main' })
  })

  test('names on Object.prototype are not boards', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(sectionDisplayName(name)).toBe(name)
      expect(sectionNameParam(name)).toBe(name)
    }
  })

  test('English names each board as the deck file spells it', () => {
    expect(['Commander', 'Main', 'Sideboard', 'Maybeboard'].map(sectionDisplayName)).toEqual([
      'Commander',
      'Main',
      'Sideboard',
      'Maybeboard',
    ])
  })
})

describe('sectionDisplayNames', () => {
  test('shows the raw headings where two are the same board, and translates the rest', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), () => {
      expect(sectionDisplayNames(['Main', 'Sideboard', 'sideboard', 'Ramp'])).toEqual([
        pseudoString('domain.board.main'),
        'Sideboard',
        'sideboard',
        'Ramp',
      ])
    })
  })
})

describe('resolveTypedSectionName', () => {
  const GERMAN = { 'domain.board.sideboard': 'Seitenboard', 'domain.board.main': 'Hauptdeck' }

  test('a board typed in the UI language is that board, folding onto the deck’s heading', () => {
    withSyntheticLocale('de', GERMAN, () => {
      expect(resolveTypedSectionName(['Main', 'Sideboard'], 'seitenboard')).toEqual({
        name: 'Sideboard',
        existing: 'Sideboard',
      })
      // A deck without the board yet gets its English token, never `## Seitenboard`.
      expect(resolveTypedSectionName(['Main'], 'Seitenboard ')).toEqual({
        name: 'Sideboard',
        existing: undefined,
      })
    })
  })

  test('a custom heading that merely reads like a board is never the board', () => {
    // German: a hand-written main-board `## Seitenboard` displays like the
    // Sideboard, but typing "Sideboard" names the Sideboard, not it.
    withSyntheticLocale('de', GERMAN, () => {
      expect(resolveTypedSectionName(['Main', 'Seitenboard'], 'Sideboard')).toEqual({
        name: 'Sideboard',
        existing: undefined,
      })
      // Typing the custom heading itself still finds it.
      expect(resolveTypedSectionName(['Main', 'Seitenboard'], 'seitenboard')).toEqual({
        name: 'Seitenboard',
        existing: 'Seitenboard',
      })
    })
  })

  test('a case-folded heading is the existing section', () => {
    expect(resolveTypedSectionName(['Main', 'sideboard'], 'SIDEBOARD')).toEqual({
      name: 'sideboard',
      existing: 'sideboard',
    })
    expect(resolveTypedSectionName(['Creatures'], ' Lands ')).toEqual({
      name: 'Lands',
      existing: undefined,
    })
  })
})

describe('resolveSectionName — board tokens', () => {
  test('a case variant of a board token creates the board under its own heading', () => {
    expect(resolveSectionName(['Main'], 'sideboard')).toBe('Sideboard')
    expect(resolveSectionName(['Main'], ' MAYBEBOARD ')).toBe('Maybeboard')
    // Never a translated name: a flag takes the token only.
    expect(resolveSectionName(['Main'], 'Seitenboard')).toBe('Seitenboard')
    expect(resolveSectionName(['Main'], 'Lands')).toBe('Lands')
  })
})

describe('sectionDisplayNames — rendered collisions', () => {
  test('a custom heading that reads like a board shows both raw', () => {
    withSyntheticLocale('de', { 'domain.board.sideboard': 'Seitenboard' }, () => {
      expect(sectionDisplayNames(['Main', 'Sideboard', 'Seitenboard'])).toEqual([
        'Main',
        'Sideboard',
        'Seitenboard',
      ])
    })
  })
})

describe('newDeckSections', () => {
  test('a command-zone format starts with an empty Commander section before Main; any other with Main alone', () => {
    for (const format of DECK_FORMAT_KEYS) {
      expect(newDeckSections(format)).toEqual(
        formatHasCommandZone(format)
          ? [
              { name: 'Commander', cards: [] },
              { name: 'Main', cards: [] },
            ]
          : [{ name: 'Main', cards: [] }],
      )
    }
  })
})

describe('a new deck round-trips through parse and serialize', () => {
  test('its empty Commander and Main sections survive a whole-file rewrite', () => {
    const written = newDeckMarkdown('Fresh', 'commander')
    const parsed = parseDeckText(written, 'Fresh')
    expect(parsed.deck.sections.map((s) => s.name)).toEqual(['Commander', 'Main'])
    expect(serializeDeckToMarkdown(parsed.deck, newDeckFrontMatter('commander'))).toBe(written)
  })
})
