import { describe, expect, test } from 'bun:test'
import { createDeckStrategy } from '../../src/commands/deck-strategy'
import { deckFormatChoices, type DeckSessionConfig } from '../../src/commands/deck-helpers'
import { DECK_FORMAT_KEYS } from '../../src/deck-format'
import type { DeckData } from '../../src/types'

function makeSessionConfig(): DeckSessionConfig {
  return {
    entryMode: 'name',
    collectorSets: [],
    activeSetIndex: 0,
    setCardMaps: new Map(),
    targetSection: null,
  }
}

function makeDeck(sections: DeckData['sections'] = []): DeckData {
  return { name: 'Test Deck', sections }
}

function menuTitles(frontMatter: Record<string, unknown>, deck: DeckData = makeDeck()): string[] {
  const strategy = createDeckStrategy({
    deckFile: '/decks/test-deck.md',
    deckName: 'Test Deck',
    initialDeck: deck,
    frontMatter,
    sessionConfig: makeSessionConfig(),
    excludeDigitalOnly: true,
  })
  return (strategy.extraMenuItems?.() ?? []).map((c) => c.title)
}

function changeFormatTitle(
  frontMatter: Record<string, unknown>,
  deck?: DeckData,
): string | undefined {
  return menuTitles(frontMatter, deck).find((t) => t.includes('Change Format'))
}

describe('deck strategy extra menu items', () => {
  test('shows Change Format with the current format label', () => {
    expect(changeFormatTitle({ format: 'commander' })).toContain('Change Format (Commander)')
  })

  test('infers the format from the sections when the front matter declares none', () => {
    // The public site infers "Commander" from the section; the editor menu must
    // agree rather than reporting "not set".
    const deck = makeDeck([{ name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] }])
    expect(changeFormatTitle({}, deck)).toContain('Change Format (Commander)')
  })

  test('shows "not set" when nothing declares or implies a format', () => {
    expect(changeFormatTitle({})).toContain('Change Format (not set)')
    expect(changeFormatTitle({ format: 'kitchen-table' })).toContain('Change Format (not set)')
  })
})

describe('deckFormatChoices', () => {
  test('lists every format in declaration order with display labels', () => {
    const choices = deckFormatChoices(null)
    expect(choices.map((c) => c.value)).toEqual([...DECK_FORMAT_KEYS])
    expect(choices[0]!.title).toBe('Commander')
  })

  test('marks the current format', () => {
    const choices = deckFormatChoices('modern')
    expect(choices.find((c) => c.value === 'modern')?.title).toBe('Modern (current)')
    expect(choices.find((c) => c.value === 'commander')?.title).toBe('Commander')
  })
})
