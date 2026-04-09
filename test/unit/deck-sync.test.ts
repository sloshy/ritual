import { describe, test, expect } from 'bun:test'
import {
  summarizeCards,
  diffByCardName,
  diffToChangeEvents,
  applyDownloadDiff,
} from '../../src/commands/deck-sync-helpers'
import type { DeckSection } from '../../src/types'

// ── summarizeCards ────────────────────────────────────────────────────

describe('summarizeCards', () => {
  test('sums quantities across sections', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 2, name: 'Sol Ring' }] },
      { name: 'Sideboard', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const summary = summarizeCards(sections)
    expect(summary.get('sol ring')?.totalQuantity).toBe(3)
    expect(summary.get('sol ring')?.isCommander).toBe(false)
  })

  test('marks commander cards', () => {
    const sections: DeckSection[] = [
      { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const summary = summarizeCards(sections)
    expect(summary.get('atraxa')?.isCommander).toBe(true)
    expect(summary.get('sol ring')?.isCommander).toBe(false)
  })

  test('case-insensitive name keys', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Lightning Bolt' }] },
    ]
    const summary = summarizeCards(sections)
    expect(summary.has('lightning bolt')).toBe(true)
    expect(summary.has('Lightning Bolt')).toBe(false)
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

  test('sums quantities across sections for comparison', () => {
    const oldSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 2, name: 'Island' }] },
      { name: 'Sideboard', cards: [{ quantity: 1, name: 'Island' }] },
    ]
    const newSections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 3, name: 'Island' }] }]
    const diff = diffByCardName(oldSections, newSections)
    // 3 total old vs 3 total new — no change
    expect(diff.quantityChanged).toHaveLength(0)
  })
})

// ── diffToChangeEvents ───────────────────────────────────────────────

describe('diffToChangeEvents', () => {
  test('creates add events for added cards', () => {
    const diff = {
      added: [{ name: 'Sol Ring', totalQuantity: 2, isCommander: false }],
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
    const diff = {
      added: [],
      removed: [{ name: 'Lightning Bolt', totalQuantity: 1, isCommander: false }],
      quantityChanged: [],
    }
    const events = diffToChangeEvents(diff)
    expect(events).toHaveLength(1)
    expect(events[0]!.action).toBe('remove')
    expect(events[0]!.cardName).toBe('Lightning Bolt')
  })

  test('creates add events for quantity increases', () => {
    const diff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 2, newQty: 4, isCommander: false }],
    }
    const events = diffToChangeEvents(diff)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.action === 'add')).toBe(true)
  })

  test('creates remove events for quantity decreases', () => {
    const diff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 4, newQty: 2, isCommander: false }],
    }
    const events = diffToChangeEvents(diff)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.action === 'remove')).toBe(true)
  })

  test('returns empty for no changes', () => {
    const events = diffToChangeEvents({ added: [], removed: [], quantityChanged: [] })
    expect(events).toHaveLength(0)
  })
})

// ── applyDownloadDiff ────────────────────────────────────────────────

describe('applyDownloadDiff', () => {
  test('removes cards from sections', () => {
    const sections: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Sol Ring' },
          { quantity: 1, name: 'Lightning Bolt' },
        ],
      },
    ]
    const diff = {
      added: [],
      removed: [{ name: 'Lightning Bolt', totalQuantity: 1, isCommander: false }],
      quantityChanged: [],
    }
    const result = applyDownloadDiff(sections, diff)
    expect(result[0]!.cards).toHaveLength(1)
    expect(result[0]!.cards[0]!.name).toBe('Sol Ring')
  })

  test('adjusts quantities', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 2, name: 'Island' }] }]
    const diff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 2, newQty: 4, isCommander: false }],
    }
    const result = applyDownloadDiff(sections, diff)
    expect(result[0]!.cards[0]!.quantity).toBe(4)
  })

  test('adds new cards to Main section', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }]
    const diff = {
      added: [{ name: 'Lightning Bolt', totalQuantity: 1, isCommander: false }],
      removed: [],
      quantityChanged: [],
    }
    const result = applyDownloadDiff(sections, diff)
    const mainCards = result.find((s) => s.name === 'Main')!.cards
    expect(mainCards).toHaveLength(2)
    expect(mainCards[1]!.name).toBe('Lightning Bolt')
  })

  test('adds commander cards to Commander section', () => {
    const sections: DeckSection[] = [
      { name: 'Commander', cards: [] },
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const diff = {
      added: [{ name: 'Atraxa', totalQuantity: 1, isCommander: true }],
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
    const diff = {
      added: [{ name: 'Atraxa', totalQuantity: 1, isCommander: true }],
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
    const diff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 2, newQty: 4, isCommander: false }],
    }
    applyDownloadDiff(sections, diff)
    expect(sections[0]!.cards[0]!.quantity).toBe(2)
  })

  test('decreases quantity without going below 1', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 1, name: 'Island' }] }]
    const diff = {
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 1, newQty: 1, isCommander: false }],
    }
    const result = applyDownloadDiff(sections, diff)
    expect(result[0]!.cards[0]!.quantity).toBe(1)
  })
})
