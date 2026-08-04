import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import { createDeckStrategy } from '../../src/commands/deck-strategy'
import { deckFormatChoices, type DeckSessionConfig } from '../../src/commands/deck-helpers'
import { DECK_FORMAT_KEYS } from '../../src/deck-format'
import type { DeckFrontMatter } from '../../src/deck-file'
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

function makeStrategy(frontMatter: DeckFrontMatter, deck: DeckData = makeDeck()) {
  return createDeckStrategy({
    deckFile: '/decks/test-deck.md',
    deckName: 'Test Deck',
    initialDeck: deck,
    frontMatter,
    sessionConfig: makeSessionConfig(),
    excludeDigitalOnly: true,
  })
}

function menuTitles(frontMatter: DeckFrontMatter, deck: DeckData = makeDeck()): string[] {
  return (makeStrategy(frontMatter, deck).extraMenuItems?.() ?? []).map((c) => c.title)
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

describe('deck strategy — Edit Tags', () => {
  test('the deck session offers exactly the extras the tallest-menu guard assumes', () => {
    // card-session.test.ts's SESSION_MENU_LIMIT test hand-writes a deck's
    // extras; this pin keeps that list honest when an item is added here.
    expect(menuTitles({})).toHaveLength(3)
  })

  test('the menu item shows the current tags (or none)', () => {
    const editTagsTitle = (frontMatter: DeckFrontMatter): string | undefined =>
      menuTitles(frontMatter).find((title) => title.includes('Edit Tags'))
    expect(editTagsTitle({})).toContain('Edit Tags (none)')
    expect(editTagsTitle({ tags: ['aggro', 'budget'] })).toContain('Edit Tags (aggro, budget)')
  })

  test('a comma-separated answer rewrites the tags and dirties the session', async () => {
    const frontMatter: DeckFrontMatter = { tags: ['aggro'] }
    const strategy = makeStrategy(frontMatter)
    prompts.inject(['budget, spicy, budget'])
    await strategy.handleSentinel?.({} as never, '__TAGS__')
    expect(frontMatter.tags).toEqual(['budget', 'spicy'])
    expect(strategy.hasUnsavedChanges()).toBeTrue()
  })

  test('an empty answer clears the key; cancel and no-op answers change nothing', async () => {
    const cleared: DeckFrontMatter = { tags: ['aggro'] }
    const clearing = makeStrategy(cleared)
    prompts.inject([''])
    await clearing.handleSentinel?.({} as never, '__TAGS__')
    expect('tags' in cleared).toBeFalse()
    expect(clearing.hasUnsavedChanges()).toBeTrue()

    const untouched: DeckFrontMatter = { tags: ['aggro'] }
    const cancelling = makeStrategy(untouched)
    prompts.inject([new Error('cancelled')])
    await cancelling.handleSentinel?.({} as never, '__TAGS__')
    prompts.inject(['aggro'])
    await cancelling.handleSentinel?.({} as never, '__TAGS__')
    expect(untouched.tags).toEqual(['aggro'])
    expect(cancelling.hasUnsavedChanges()).toBeFalse()
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
