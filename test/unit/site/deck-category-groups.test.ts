import { describe, expect, test } from 'bun:test'
import {
  groupDeckBoardsByCategory,
  isCategoryGroupBy,
  type DeckBoardCards,
  type DeckBoardGroup,
  type DeckCategoryGroupOptions,
} from '../../../src/site/deck-category-groups'
import type { CardData, SortLayer } from '../../../src/list-view/card-sorting'
import { makeCardData as makeCard } from '../../test-utils'
import { english } from '../../helpers/sync-text'

/** A nested group's heading, rendered in English. */
function heading(group: DeckBoardGroup<CardData>): string {
  return english(group.heading)
}

const sortLayers: SortLayer[] = [{ sortBy: 'name', reverse: false }]

function options(over: Partial<DeckCategoryGroupOptions> = {}): DeckCategoryGroupOptions {
  return {
    groupBy: 'category',
    sortLayers,
    reverseGroups: false,
    categoryOrder: ['Ramp', 'Draw', 'Artifacts'],
    ...over,
  }
}

/** Commander, Main (mixed), Sideboard, and an empty Maybeboard. */
function boards(): DeckBoardCards<CardData>[] {
  return [
    {
      label: 'Commander',
      cards: [makeCard({ name: 'General' })],
      hideCount: true,
    },
    {
      label: 'Main',
      cards: [
        makeCard({ name: 'Sol Ring', categories: ['Ramp', 'Artifacts'] }),
        makeCard({ name: 'Arcane Signet', categories: ['Ramp'] }),
        // Later in the vocabulary than Ramp but earlier alphabetically, so an
        // unforwarded `categoryOrder` would sort it first.
        makeCard({ name: 'Board Draw', categories: ['Draw'] }),
        makeCard({ name: 'Plain Card' }),
      ],
      hideCount: false,
    },
    {
      label: 'Sideboard',
      cards: [makeCard({ name: 'Draw Spell', categories: ['Draw'] })],
      hideCount: false,
    },
    { label: 'Maybeboard', cards: [], hideCount: false },
  ]
}

describe('groupDeckBoardsByCategory', () => {
  test("nests each board's categories under it, boards in input order", () => {
    const groups = groupDeckBoardsByCategory(boards(), options())
    expect(groups.map(heading)).toEqual([
      'Commander › Uncategorized',
      'Main › Ramp',
      'Main › Draw',
      'Main › Uncategorized',
      'Sideboard › Draw',
    ])
  })

  test("keys nest the grouper's code inside the board's, whatever the headings say", () => {
    const groups = groupDeckBoardsByCategory(boards(), options())
    expect(groups.map((g) => g.key)).toEqual([
      'board:Commander/category:',
      'board:Main/category:ramp',
      'board:Main/category:draw',
      'board:Main/category:',
      'board:Sideboard/category:draw',
    ])
  })

  test("a nested heading holds the board and the grouper's heading unrendered", () => {
    const [commander] = groupDeckBoardsByCategory(boards(), options())
    expect(commander!.heading).toEqual({
      messageKey: 'site.cardSection.boardCategoryHeading',
      messageParams: {
        board: 'Commander',
        category: { messageKey: 'site.groupBy.uncategorized' },
      },
    })
  })

  test('a board name holding the key separator stays its own board', () => {
    const groups = groupDeckBoardsByCategory(
      [
        { label: 'A/B', cards: [makeCard({ name: 'One', categories: ['C'] })], hideCount: false },
        { label: 'A', cards: [makeCard({ name: 'Two', categories: ['B/C'] })], hideCount: false },
      ],
      options({ categoryOrder: [] }),
    )
    expect(groups.map((g) => g.key)).toEqual(['board:A%2FB/category:c', 'board:A/category:b/c'])
  })

  test('a board with no cards contributes no group', () => {
    const groups = groupDeckBoardsByCategory(boards(), options())
    expect(groups.some((g) => g.board === 'Maybeboard')).toBe(false)
  })

  test('the categories grouping repeats a card inside its own board only', () => {
    const groups = groupDeckBoardsByCategory(boards(), options({ groupBy: 'categories' }))
    const headings = groups.map(heading)
    expect(headings).toContain('Main › Artifacts')
    expect(headings).toContain('Sideboard › Draw')
    const artifacts = groups.find((g) => heading(g) === 'Main › Artifacts')!
    expect(artifacts.cards.map((c) => c.name)).toEqual(['Sol Ring'])
    // The same card again under its primary — the deliberate one-card-two-groups
    // break — and in the forwarded within-group name order.
    expect(groups.find((g) => heading(g) === 'Main › Ramp')!.cards.map((c) => c.name)).toEqual([
      'Arcane Signet',
      'Sol Ring',
    ])
    // The sideboard's Draw card never reaches the mainboard's Draw group.
    expect(groups.find((g) => heading(g) === 'Main › Draw')!.cards.map((c) => c.name)).toEqual([
      'Board Draw',
    ])
  })

  test('group.category carries the bare category, and is absent for Uncategorized', () => {
    const groups = groupDeckBoardsByCategory(boards(), options({ groupBy: 'categories' }))
    const artifacts = groups.find((g) => heading(g) === 'Main › Artifacts')!
    expect(artifacts.category).toBe('Artifacts')
    const uncategorized = groups.find((g) => heading(g) === 'Main › Uncategorized')!
    // bun's `toEqual` ignores `undefined`-valued keys, so assert presence.
    expect('category' in uncategorized).toBe(false)
  })

  test('board and hideCount ride on every group of that board', () => {
    // A second hideCount board whose label is not Commander, so the flag and the
    // label diverge: an implementation deriving it from the label would fail.
    const input: DeckBoardCards<CardData>[] = [
      ...boards(),
      { label: 'Tokens', cards: [makeCard({ name: 'Treasure' })], hideCount: true },
    ]
    const groups = groupDeckBoardsByCategory(input, options())
    for (const board of input) {
      const mine = groups.filter((g) => g.board === board.label)
      expect(mine.every((g) => g.hideCount === board.hideCount)).toBe(true)
    }
    expect(groups[0]!.board).toBe('Commander')
  })

  test('reverseGroups reverses within each board, leaving the board order alone', () => {
    const groups = groupDeckBoardsByCategory(boards(), options({ reverseGroups: true }))
    expect(groups.map(heading)).toEqual([
      'Commander › Uncategorized',
      'Main › Uncategorized',
      'Main › Draw',
      'Main › Ramp',
      'Sideboard › Draw',
    ])
  })
})

describe('isCategoryGroupBy', () => {
  test('is true for exactly the two category groupings', () => {
    expect(isCategoryGroupBy('category')).toBe(true)
    expect(isCategoryGroupBy('categories')).toBe(true)
    for (const other of ['type', 'section', 'tags', 'none']) {
      expect(isCategoryGroupBy(other)).toBe(false)
    }
  })
})
