import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import { createDeckStrategy } from '../../src/commands/session/deck-strategy'
import { buildInitialSessionConfig } from '../../src/commands/session/config'
import { createCardSessionContext } from '../../src/commands/session/strategy'
import { deckFormatChoices } from '../../src/commands/session/deck-prompts'
import type { SessionConfig } from '../../src/commands/session/config'
import { DECK_FORMAT_KEYS } from '../../src/list/deck-format'
import type { DeckFrontMatter } from '../../src/list/deck-file'
import type { DeckData } from '../../src/list/deck'
import { scratchListPath, stubTty } from '../test-utils'

// The Set Custom Art prompts go through `ask`, which refuses to open without a
// terminal; these tests answer them with prompts.inject instead.
stubTty({ stdin: true })

function makeSessionConfig(): SessionConfig {
  return buildInitialSessionConfig({}, undefined)
}

function makeDeck(sections: DeckData['sections'] = []): DeckData {
  return { name: 'Test Deck', sections }
}

function makeStrategy(frontMatter: DeckFrontMatter, deck: DeckData = makeDeck()) {
  return createDeckStrategy({
    deckFile: scratchListPath('test-deck.md'),
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
    expect(menuTitles({})).toHaveLength(4)
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

describe('deck strategy — Edit List Labels', () => {
  const labelsTitle = (frontMatter: DeckFrontMatter): string | undefined =>
    menuTitles(frontMatter).find((title) => title.includes('Edit List Labels'))

  test('the menu item shows the deck default (or none)', () => {
    expect(labelsTitle({})).toContain('Edit List Labels (default: none)')
    expect(labelsTitle({ labels: ['proxy'] })).toContain('Edit List Labels (default: proxy)')
  })

  test('picking a default writes the front matter and dirties the session', async () => {
    const frontMatter: DeckFrontMatter = {}
    const strategy = makeStrategy(frontMatter)
    // Rows for a deck: "No default", then "Proxy" — the only label a deck carries.
    prompts.inject(['proxy'])
    await strategy.handleSentinel?.({} as never, '__LIST_LABELS__')
    expect(frontMatter.labels).toEqual(['proxy'])
    expect(strategy.hasUnsavedChanges()).toBeTrue()
  })

  test('picking "No default" clears the key; cancelling changes nothing', async () => {
    const cleared: DeckFrontMatter = { labels: ['proxy'] }
    const clearing = makeStrategy(cleared)
    prompts.inject([''])
    await clearing.handleSentinel?.({} as never, '__LIST_LABELS__')
    expect('labels' in cleared).toBeFalse()
    expect(clearing.hasUnsavedChanges()).toBeTrue()

    const untouched: DeckFrontMatter = { labels: ['proxy'] }
    const cancelling = makeStrategy(untouched)
    prompts.inject([new Error('cancelled')])
    await cancelling.handleSentinel?.({} as never, '__LIST_LABELS__')
    expect(untouched.labels).toEqual(['proxy'])
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

describe('deck strategy — Set Custom Art', () => {
  /** A deck holding one identified line, with no `.art.json` beside it. */
  function deckWithLine(): DeckData {
    return makeDeck([{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] }])
  }

  test('a URL is staged for the save and undone by the edit stack', async () => {
    const strategy = makeStrategy({}, deckWithLine())
    const ctx = createCardSessionContext()

    prompts.inject(['art', 'url', 'https://example.com/sol.png'])
    await strategy.editEntry(ctx, 1)

    // Custom art is metadata: the deck line is untouched and nothing reaches
    // the changelog — only the dirty flag tells the save there is work.
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(strategy.hasUnsavedChanges()).toBeTrue()
    expect(strategy.lastEditUndoLabel()).toBe('custom art on Sol Ring')

    await strategy.undoLastEdit(ctx)
    expect(strategy.lastEditUndoLabel()).toBeNull()
  })

  test('cancelling the action leaves the session clean', async () => {
    const strategy = makeStrategy({}, deckWithLine())
    const ctx = createCardSessionContext()

    prompts.inject(['art', new Error('cancelled')])
    await strategy.editEntry(ctx, 1)

    expect(strategy.hasUnsavedChanges()).toBeFalse()
    expect(strategy.lastEditUndoLabel()).toBeNull()
  })
})
