import { describe, test, expect } from 'bun:test'
import {
  summarizeCards,
  diffByCardName,
  diffToChangeEvents,
  applyDownloadDiff,
  normalizeBoard,
  type NameDiff,
} from '../../src/commands/deck-sync-helpers'
import type { DeckSection } from '../../src/types'

// ── normalizeBoard ────────────────────────────────────────────────────

describe('normalizeBoard', () => {
  test('maps known section headers to canonical boards', () => {
    expect(normalizeBoard('Commander')).toBe('Commander')
    expect(normalizeBoard('Main')).toBe('Main')
    expect(normalizeBoard('Sideboard')).toBe('Sideboard')
    expect(normalizeBoard('Maybeboard')).toBe('Maybeboard')
  })

  test('is case-insensitive and matches substrings', () => {
    expect(normalizeBoard('maybeboard')).toBe('Maybeboard')
    expect(normalizeBoard('Custom Maybeboard Pile')).toBe('Maybeboard')
  })

  test('folds token/extra sections into Maybeboard', () => {
    // Reuses deck-format's isExtraSection, which groups tokens with the maybeboard.
    expect(normalizeBoard('Tokens')).toBe('Maybeboard')
  })

  test('treats unknown / custom headers as the main board', () => {
    expect(normalizeBoard('Ramp')).toBe('Main')
    expect(normalizeBoard('Removal')).toBe('Main')
  })
})

// ── summarizeCards ────────────────────────────────────────────────────

describe('summarizeCards', () => {
  test('keeps the same card in different boards separate', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 2, name: 'Sol Ring' }] },
      { name: 'Sideboard', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const summary = summarizeCards(sections)
    expect(summary.get('Main sol ring')?.totalQuantity).toBe(2)
    expect(summary.get('Main sol ring')?.board).toBe('Main')
    expect(summary.get('Sideboard sol ring')?.totalQuantity).toBe(1)
    expect(summary.get('Sideboard sol ring')?.board).toBe('Sideboard')
  })

  test('sums quantities across sections that share a board', () => {
    const sections: DeckSection[] = [
      { name: 'Ramp', cards: [{ quantity: 2, name: 'Sol Ring' }] },
      { name: 'Artifacts', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const summary = summarizeCards(sections)
    // Both custom headers normalize to Main and merge.
    expect(summary.get('Main sol ring')?.totalQuantity).toBe(3)
  })

  test('with byBoard: false, merges all sections by name only', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 2, name: 'Sol Ring' }] },
      { name: 'Sideboard', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const summary = summarizeCards(sections, { byBoard: false })
    expect(summary.get('sol ring')?.totalQuantity).toBe(3)
  })

  test('records the board for each card', () => {
    const sections: DeckSection[] = [
      { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const summary = summarizeCards(sections)
    expect(summary.get('Commander atraxa')?.board).toBe('Commander')
    expect(summary.get('Main sol ring')?.board).toBe('Main')
  })
})

// ── diffByCardName ───────────────────────────────────────────────────

describe('diffByCardName', () => {
  test('detects added cards', () => {
    const oldSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const newSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Sol Ring' },
          { quantity: 1, name: 'Lightning Bolt' },
        ],
      },
    ]
    const diff = diffByCardName(oldSections, newSections)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]!.name).toBe('Lightning Bolt')
    expect(diff.added[0]!.board).toBe('Main')
    expect(diff.removed).toHaveLength(0)
    expect(diff.quantityChanged).toHaveLength(0)
  })

  test('detects removed cards', () => {
    const oldSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Sol Ring' },
          { quantity: 1, name: 'Lightning Bolt' },
        ],
      },
    ]
    const newSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const diff = diffByCardName(oldSections, newSections)
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]!.name).toBe('Lightning Bolt')
    expect(diff.added).toHaveLength(0)
  })

  test('detects quantity changes', () => {
    const oldSections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 2, name: 'Island' }] }]
    const newSections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 4, name: 'Island' }] }]
    const diff = diffByCardName(oldSections, newSections)
    expect(diff.quantityChanged).toHaveLength(1)
    expect(diff.quantityChanged[0]!.oldQty).toBe(2)
    expect(diff.quantityChanged[0]!.newQty).toBe(4)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  test('no changes when decks are identical', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
      { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
    ]
    const diff = diffByCardName(sections, sections)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.quantityChanged).toHaveLength(0)
  })

  test('matches cards case-insensitively', () => {
    const oldSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'sol ring' }] },
    ]
    const newSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const diff = diffByCardName(oldSections, newSections)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.quantityChanged).toHaveLength(0)
  })

  test('handles mixed adds, removes, and quantity changes', () => {
    const oldSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 3, name: 'Island' },
          { quantity: 1, name: 'Mountain' },
        ],
      },
    ]
    const newSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Island' },
          { quantity: 1, name: 'Forest' },
        ],
      },
    ]
    const diff = diffByCardName(oldSections, newSections)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]!.name).toBe('Forest')
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]!.name).toBe('Mountain')
    expect(diff.quantityChanged).toHaveLength(1)
    expect(diff.quantityChanged[0]!.name).toBe('Island')
    expect(diff.quantityChanged[0]!.oldQty).toBe(3)
    expect(diff.quantityChanged[0]!.newQty).toBe(1)
  })

  test('ignores set and printing differences', () => {
    const oldSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167' }],
      },
    ]
    const newSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'mrd', collectorNumber: '217' }],
      },
    ]
    const diff = diffByCardName(oldSections, newSections)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.quantityChanged).toHaveLength(0)
  })

  test('treats the same card in different boards as distinct', () => {
    // Card sits in the Maybeboard remotely but nowhere locally.
    const localSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const remoteSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Cavern-Hoard Dragon' }] },
    ]
    const diff = diffByCardName(localSections, remoteSections)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]!.name).toBe('Cavern-Hoard Dragon')
    expect(diff.added[0]!.board).toBe('Maybeboard')
    expect(diff.removed).toHaveLength(0)
  })

  test('reports a board move as a removal and an addition', () => {
    const localSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Cavern-Hoard Dragon' }] },
    ]
    const remoteSections: DeckSection[] = [
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Cavern-Hoard Dragon' }] },
    ]
    const diff = diffByCardName(localSections, remoteSections)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]!.board).toBe('Maybeboard')
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]!.board).toBe('Main')
  })

  test('byBoard: false sums quantities across sections for comparison', () => {
    const oldSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 2, name: 'Island' }] },
      { name: 'Sideboard', cards: [{ quantity: 1, name: 'Island' }] },
    ]
    const newSections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 3, name: 'Island' }] }]
    const diff = diffByCardName(oldSections, newSections, { byBoard: false })
    // 3 total old vs 3 total new — no change
    expect(diff.quantityChanged).toHaveLength(0)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })
})

// ── diffToChangeEvents ───────────────────────────────────────────────

describe('diffToChangeEvents', () => {
  test('creates add events for added cards', () => {
    const diff: NameDiff = {
      added: [{ name: 'Sol Ring', totalQuantity: 2, board: 'Main' }],
      removed: [],
      quantityChanged: [],
    }
    const events = diffToChangeEvents(diff)
    expect(events).toHaveLength(2)
    expect(events[0]!.action).toBe('add')
    expect(events[0]!.cardName).toBe('Sol Ring')
    expect(events[1]!.action).toBe('add')
  })

  test('creates remove events for removed cards', () => {
    const diff: NameDiff = {
      added: [],
      removed: [{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Main' }],
      quantityChanged: [],
    }
    const events = diffToChangeEvents(diff)
    expect(events).toHaveLength(1)
    expect(events[0]!.action).toBe('remove')
    expect(events[0]!.cardName).toBe('Lightning Bolt')
  })

  test('creates add events for quantity increases', () => {
    const diff: NameDiff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 2, newQty: 4, board: 'Main' }],
    }
    const events = diffToChangeEvents(diff)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.action === 'add')).toBe(true)
  })

  test('creates remove events for quantity decreases', () => {
    const diff: NameDiff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 4, newQty: 2, board: 'Main' }],
    }
    const events = diffToChangeEvents(diff)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.action === 'remove')).toBe(true)
  })

  test('propagates the board onto change events', () => {
    const diff: NameDiff = {
      added: [{ name: 'Cavern-Hoard Dragon', totalQuantity: 1, board: 'Maybeboard' }],
      removed: [{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Sideboard' }],
      quantityChanged: [],
    }
    const events = diffToChangeEvents(diff)
    const add = events.find((e) => e.action === 'add')!
    const remove = events.find((e) => e.action === 'remove')!
    expect(add.action === 'add' && add.board).toBe('Maybeboard')
    expect(remove.action === 'remove' && remove.board).toBe('Sideboard')
  })

  test('returns empty for no changes', () => {
    const events = diffToChangeEvents({ added: [], removed: [], quantityChanged: [] })
    expect(events).toHaveLength(0)
  })
})

// ── applyDownloadDiff ────────────────────────────────────────────────

describe('applyDownloadDiff', () => {
  test('removes cards from their board', () => {
    const sections: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Sol Ring' },
          { quantity: 1, name: 'Lightning Bolt' },
        ],
      },
    ]
    const diff: NameDiff = {
      added: [],
      removed: [{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Main' }],
      quantityChanged: [],
    }
    const result = applyDownloadDiff(sections, diff)
    expect(result[0]!.cards).toHaveLength(1)
    expect(result[0]!.cards[0]!.name).toBe('Sol Ring')
  })

  test('only removes from the matching board', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const diff: NameDiff = {
      added: [],
      removed: [{ name: 'Sol Ring', totalQuantity: 1, board: 'Maybeboard' }],
      quantityChanged: [],
    }
    const result = applyDownloadDiff(sections, diff)
    expect(result.find((s) => s.name === 'Main')!.cards).toHaveLength(1)
    expect(result.find((s) => s.name === 'Maybeboard')!.cards).toHaveLength(0)
  })

  test('adjusts quantities', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 2, name: 'Island' }] }]
    const diff: NameDiff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 2, newQty: 4, board: 'Main' }],
    }
    const result = applyDownloadDiff(sections, diff)
    expect(result[0]!.cards[0]!.quantity).toBe(4)
  })

  test('adds new cards to Main section', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }]
    const diff: NameDiff = {
      added: [{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Main' }],
      removed: [],
      quantityChanged: [],
    }
    const result = applyDownloadDiff(sections, diff)
    const mainCards = result.find((s) => s.name === 'Main')!.cards
    expect(mainCards).toHaveLength(2)
    expect(mainCards[1]!.name).toBe('Lightning Bolt')
  })

  test('adds maybeboard cards to the existing Maybeboard section', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Forgotten Ancient' }] },
    ]
    const diff: NameDiff = {
      added: [{ name: 'Cavern-Hoard Dragon', totalQuantity: 1, board: 'Maybeboard' }],
      removed: [],
      quantityChanged: [],
    }
    const result = applyDownloadDiff(sections, diff)
    expect(result.find((s) => s.name === 'Main')!.cards).toHaveLength(1)
    const maybe = result.find((s) => s.name === 'Maybeboard')!.cards
    expect(maybe).toHaveLength(2)
    expect(maybe[1]!.name).toBe('Cavern-Hoard Dragon')
  })

  test('creates a Maybeboard section when adding to a board that does not exist', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }]
    const diff: NameDiff = {
      added: [{ name: 'Cavern-Hoard Dragon', totalQuantity: 1, board: 'Maybeboard' }],
      removed: [],
      quantityChanged: [],
    }
    const result = applyDownloadDiff(sections, diff)
    expect(result.find((s) => s.name === 'Main')!.cards).toHaveLength(1)
    const maybe = result.find((s) => s.name === 'Maybeboard')
    expect(maybe).toBeDefined()
    expect(maybe!.cards[0]!.name).toBe('Cavern-Hoard Dragon')
  })

  test('adds commander cards to Commander section', () => {
    const sections: DeckSection[] = [
      { name: 'Commander', cards: [] },
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const diff: NameDiff = {
      added: [{ name: 'Atraxa', totalQuantity: 1, board: 'Commander' }],
      removed: [],
      quantityChanged: [],
    }
    const result = applyDownloadDiff(sections, diff)
    const commanderCards = result.find((s) => s.name === 'Commander')!.cards
    expect(commanderCards).toHaveLength(1)
    expect(commanderCards[0]!.name).toBe('Atraxa')
  })

  test('creates Commander section if it does not exist', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }]
    const diff: NameDiff = {
      added: [{ name: 'Atraxa', totalQuantity: 1, board: 'Commander' }],
      removed: [],
      quantityChanged: [],
    }
    const result = applyDownloadDiff(sections, diff)
    const commanderSection = result.find((s) => s.name === 'Commander')
    expect(commanderSection).toBeDefined()
    expect(commanderSection!.cards[0]!.name).toBe('Atraxa')
  })

  test('does not mutate original sections', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 2, name: 'Island' }] }]
    const diff: NameDiff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 2, newQty: 4, board: 'Main' }],
    }
    applyDownloadDiff(sections, diff)
    expect(sections[0]!.cards[0]!.quantity).toBe(2)
  })

  test('decreases quantity without going below 1', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 1, name: 'Island' }] }]
    const diff: NameDiff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 1, newQty: 1, board: 'Main' }],
    }
    const result = applyDownloadDiff(sections, diff)
    expect(result[0]!.cards[0]!.quantity).toBe(1)
  })
})
