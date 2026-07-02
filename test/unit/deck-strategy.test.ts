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

function makeDeck(): DeckData {
  return { name: 'Test Deck', sections: [] }
}

function menuTitles(frontMatter: Record<string, unknown>): string[] {
  const strategy = createDeckStrategy({
    deckFile: '/decks/test-deck.md',
    deckName: 'Test Deck',
    initialDeck: makeDeck(),
    frontMatter,
    sessionConfig: makeSessionConfig(),
    excludeDigitalOnly: true,
  })
  return (strategy.extraMenuItems?.() ?? []).map((c) => c.title)
}

describe('deck strategy extra menu items', () => {
  test('shows Change Format with the current format label', () => {
    const titles = menuTitles({ format: 'commander' })
    expect(titles).toContain('🏷️  Change Format (Commander)')
  })

  test('shows a raw unknown format string as-is', () => {
    expect(menuTitles({ format: 'kitchen-table' })).toContain('🏷️  Change Format (kitchen-table)')
  })

  test('shows "not set" when the front matter has no format', () => {
    expect(menuTitles({})).toContain('🏷️  Change Format (not set)')
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
