import { describe, test, expect } from 'bun:test'
import {
  diffDeckCards,
  diffToChangeEvents,
  buildCardIdResolver,
  applyDownloadDiff,
  filterDeckDiff,
  normalizeBoard,
  syncDeckFormat,
  type DeckDiff,
  type CardIdResolver,
  type CardSummary,
  type QuantityChange,
} from '../../src/deck-sync/diff'
import { assignMissingDeckCardIds } from '../../src/card-id'
import { serializeDeckToMarkdown } from '../../src/deck-file'
import type { AddChange, RemoveChange } from '../../src/change-event'
import type { Card, DeckData, DeckSection } from '../../src/types'

/**
 * A name-keyed diff (the shape a sync without `--sync-printings` produces),
 * carrying only the entries a test cares about. The printing-keyed half is
 * covered in `deck-sync-printings.test.ts`.
 */
function deckDiff(partial: Partial<DeckDiff> = {}): DeckDiff {
  return {
    byPrinting: false,
    added: [],
    removed: [],
    quantityChanged: [],
    printingUpdates: [],
    unaligned: [],
    ...partial,
  }
}

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

// ── diffDeckCards ───────────────────────────────────────────────────

describe('diffDeckCards', () => {
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
    const diff = diffDeckCards(oldSections, newSections)
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
    const diff = diffDeckCards(oldSections, newSections)
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]!.name).toBe('Lightning Bolt')
    expect(diff.added).toHaveLength(0)
  })

  test('detects quantity changes', () => {
    const oldSections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 2, name: 'Island' }] }]
    const newSections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 4, name: 'Island' }] }]
    const diff = diffDeckCards(oldSections, newSections)
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
    const diff = diffDeckCards(sections, sections)
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
    const diff = diffDeckCards(oldSections, newSections)
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
    const diff = diffDeckCards(oldSections, newSections)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]!.name).toBe('Forest')
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]!.name).toBe('Mountain')
    expect(diff.quantityChanged).toHaveLength(1)
    expect(diff.quantityChanged[0]!.name).toBe('Island')
    expect(diff.quantityChanged[0]!.oldQty).toBe(3)
    expect(diff.quantityChanged[0]!.newQty).toBe(1)
  })

  test('leaves a card whose printings differ alone, reporting the mismatch instead', () => {
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
    const diff = diffDeckCards(oldSections, newSections)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.quantityChanged).toHaveLength(0)
    // One holding each side: re-pinning is `--sync-printings`' business, and
    // nothing has to be added or removed, so this is not a mismatch either.
    expect(diff.unaligned).toEqual([])
  })

  test('reports a card the two sides hold at printings that cannot be squared up', () => {
    const oldSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '167' }],
      },
    ]
    const newSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167' },
          { quantity: 1, name: 'Sol Ring', set: 'mrd', collectorNumber: '217' },
        ],
      },
    ]
    const diff = diffDeckCards(oldSections, newSections)
    expect(diff.unaligned).toEqual([{ name: 'Sol Ring', board: 'Main' }])
    // Reported, not acted on: reconciling it would mean adding a copy.
    expect(diff.added).toHaveLength(0)
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
    const diff = diffDeckCards(localSections, remoteSections)
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
    const diff = diffDeckCards(localSections, remoteSections)
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
    const diff = diffDeckCards(oldSections, newSections, { byBoard: false })
    // 3 total old vs 3 total new — no change
    expect(diff.quantityChanged).toHaveLength(0)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })
})

// ── diffToChangeEvents ───────────────────────────────────────────────

describe('diffToChangeEvents', () => {
  test('creates add events for added cards', () => {
    const diff: DeckDiff = {
      byPrinting: false,
      printingUpdates: [],
      unaligned: [],
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
    const diff: DeckDiff = {
      byPrinting: false,
      printingUpdates: [],
      unaligned: [],
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
    const diff: DeckDiff = {
      byPrinting: false,
      printingUpdates: [],
      unaligned: [],
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 2, newQty: 4, board: 'Main' }],
    }
    const events = diffToChangeEvents(diff)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.action === 'add')).toBe(true)
  })

  test('creates remove events for quantity decreases', () => {
    const diff: DeckDiff = {
      byPrinting: false,
      printingUpdates: [],
      unaligned: [],
      added: [],
      removed: [],
      quantityChanged: [{ name: 'Island', oldQty: 4, newQty: 2, board: 'Main' }],
    }
    const events = diffToChangeEvents(diff)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.action === 'remove')).toBe(true)
  })

  test('propagates the board onto change events', () => {
    const diff: DeckDiff = {
      byPrinting: false,
      printingUpdates: [],
      unaligned: [],
      added: [{ name: 'Cavern-Hoard Dragon', totalQuantity: 1, board: 'Maybeboard' }],
      removed: [{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Sideboard' }],
      quantityChanged: [],
    }
    const events = diffToChangeEvents(diff)
    const add = events.find((e): e is AddChange => e.action === 'add')!
    const remove = events.find((e): e is RemoveChange => e.action === 'remove')!
    expect(add.board).toBe('Maybeboard')
    expect(remove.board).toBe('Sideboard')
  })

  test('propagates the board onto quantity-change events', () => {
    const diff: DeckDiff = {
      byPrinting: false,
      printingUpdates: [],
      unaligned: [],
      added: [],
      removed: [],
      quantityChanged: [
        { name: 'Island', oldQty: 1, newQty: 2, board: 'Sideboard' },
        { name: 'Forest', oldQty: 3, newQty: 1, board: 'Maybeboard' },
      ],
    }
    // quantityChanged entries always emit add or remove events, both of which carry `board`.
    const events = diffToChangeEvents(diff) as Array<AddChange | RemoveChange>
    const islandEvent = events.find((e) => e.cardName === 'Island')!
    const forestEvents = events.filter((e) => e.cardName === 'Forest')
    expect(islandEvent.board).toBe('Sideboard')
    expect(forestEvents).toHaveLength(2)
    expect(forestEvents.every((e) => e.board === 'Maybeboard')).toBe(true)
  })

  test('returns empty for no changes', () => {
    const events = diffToChangeEvents(deckDiff())
    expect(events).toHaveLength(0)
  })

  test('leaves cardId undefined when no resolver is supplied', () => {
    const diff: DeckDiff = {
      byPrinting: false,
      printingUpdates: [],
      unaligned: [],
      added: [{ name: 'Sol Ring', totalQuantity: 1, board: 'Main' }],
      removed: [],
      quantityChanged: [],
    }
    expect(diffToChangeEvents(diff)[0]!.cardId).toBeUndefined()
  })

  test('stamps each event with the resolved card ID', () => {
    const diff: DeckDiff = {
      byPrinting: false,
      printingUpdates: [],
      unaligned: [],
      added: [{ name: 'Sol Ring', totalQuantity: 1, board: 'Main' }],
      removed: [{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Sideboard' }],
      quantityChanged: [{ name: 'Island', oldQty: 1, newQty: 2, board: 'Main' }],
    }
    const ids: Record<string, number> = {
      'Main sol ring': 5,
      'Sideboard lightning bolt': 6,
      'Main island': 7,
    }
    const resolve: CardIdResolver = (board, name) => ids[`${board} ${name.toLowerCase()}`]
    const events = diffToChangeEvents(diff, resolve)
    expect(events.find((e) => e.cardName === 'Sol Ring')!.cardId).toBe(5)
    expect(events.find((e) => e.cardName === 'Lightning Bolt')!.cardId).toBe(6)
    expect(events.find((e) => e.cardName === 'Island')!.cardId).toBe(7)
  })
})

// ── buildCardIdResolver ──────────────────────────────────────────────

describe('buildCardIdResolver', () => {
  test('resolves by board + name, case-insensitively', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 7 }] },
    ]
    const resolve = buildCardIdResolver(sections)
    expect(resolve('Main', 'sol ring')).toBe(7)
    expect(resolve('Main', 'Sol Ring')).toBe(7)
  })

  test('earlier section sets take precedence over later ones', () => {
    const post: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 2 }] },
    ]
    const pre: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 9 }] },
    ]
    expect(buildCardIdResolver(post, pre)('Main', 'Sol Ring')).toBe(2)
  })

  test('skips cards without an id and returns undefined for unknown cards', () => {
    const sections: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 1, name: 'No Id' }] }]
    const resolve = buildCardIdResolver(sections)
    expect(resolve('Main', 'No Id')).toBeUndefined()
    expect(resolve('Main', 'Missing')).toBeUndefined()
  })

  test('distinguishes the same card name across boards', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] },
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 2 }] },
    ]
    const resolve = buildCardIdResolver(sections)
    expect(resolve('Main', 'Sol Ring')).toBe(1)
    expect(resolve('Maybeboard', 'Sol Ring')).toBe(2)
  })

  test('resolves cards under custom section names by their normalized board', () => {
    // 'Ramp' is a custom header that normalizes to Main; the resolver should index
    // its cards under 'Main' so changelog stamping finds them by canonical board.
    const sections: DeckSection[] = [
      { name: 'Ramp', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 4 }] },
      { name: 'Tokens', cards: [{ quantity: 1, name: 'Treasure', cardId: 7 }] },
    ]
    const resolve = buildCardIdResolver(sections)
    expect(resolve('Main', 'Sol Ring')).toBe(4)
    expect(resolve('Maybeboard', 'Treasure')).toBe(7)
  })
})

// ── download sync ID assignment (regression) ─────────────────────────

describe('download sync assigns IDs to new cards', () => {
  test('new cards get an &N in the serialized deck and a cardId in the changelog', () => {
    // Mirrors the composition in downloadChanges without hitting the network.
    const local: DeckData = {
      name: 'Sync Deck',
      sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] }],
    }
    const remote: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Sol Ring' },
          { quantity: 1, name: 'Lightning Bolt' },
        ],
      },
    ]

    const diff = diffDeckCards(local.sections, remote)
    const updatedSections = applyDownloadDiff(local.sections, diff)
    const updatedDeck = assignMissingDeckCardIds({ ...local, sections: updatedSections })

    // Every card line in the written deck carries an &N.
    const markdown = serializeDeckToMarkdown(updatedDeck, { name: local.name })
    expect(markdown).toContain('1 Sol Ring &1')
    expect(markdown).toContain('1 Lightning Bolt &2')

    // The changelog records the newly added card's ID.
    const resolve = buildCardIdResolver(updatedDeck.sections, local.sections)
    const added = diffToChangeEvents(diff, resolve).find((c) => c.cardName === 'Lightning Bolt')!
    expect(added.action).toBe('add')
    expect(added.cardId).toBe(2)
  })

  test('a board move stamps the remove with the old ID and the add with the new ID', () => {
    // Card lives in Main locally (id 5) and moves to the Maybeboard remotely.
    const local: DeckData = {
      name: 'Move Deck',
      sections: [
        { name: 'Main', cards: [{ quantity: 1, name: 'Cavern-Hoard Dragon', cardId: 5 }] },
      ],
    }
    const remote: DeckSection[] = [
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Cavern-Hoard Dragon' }] },
    ]

    const diff = diffDeckCards(local.sections, remote)
    const updatedSections = applyDownloadDiff(local.sections, diff)
    const updatedDeck = assignMissingDeckCardIds({ ...local, sections: updatedSections })
    const resolve = buildCardIdResolver(updatedDeck.sections, local.sections)
    const events = diffToChangeEvents(diff, resolve)

    const remove = events.find((e) => e.action === 'remove')!
    const add = events.find((e) => e.action === 'add')!
    // Removal resolves against the pre-sync deck (still on Main with its old ID).
    expect(remove.cardId).toBe(5)
    // Addition resolves against the post-sync deck. The moved card got a fresh ID:
    // after removal the deck has no IDs left, so the pool restarts at 1.
    expect(add.cardId).toBe(1)
  })
})

// ── applyDownloadDiff ────────────────────────────────────────────────

describe('applyDownloadDiff', () => {
  // Most applyDownloadDiff tests build a DeckDiff with a single populated field;
  // these factories isolate that field so each test reads as just its inputs.
  const addDiff = (items: CardSummary[]): DeckDiff => deckDiff({ added: items })
  const removeDiff = (items: CardSummary[]): DeckDiff => deckDiff({ removed: items })
  const qtyDiff = (items: QuantityChange[]): DeckDiff => deckDiff({ quantityChanged: items })
  const mainSections = (cards: Card[]): DeckSection[] => [{ name: 'Main', cards }]

  test('removes cards from their board', () => {
    const sections = mainSections([
      { quantity: 1, name: 'Sol Ring' },
      { quantity: 1, name: 'Lightning Bolt' },
    ])
    const diff = removeDiff([{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Main' }])
    const result = applyDownloadDiff(sections, diff)
    expect(result[0]!.cards).toHaveLength(1)
    expect(result[0]!.cards[0]!.name).toBe('Sol Ring')
  })

  test('only removes from the matching board', () => {
    const sections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ]
    const diff = removeDiff([{ name: 'Sol Ring', totalQuantity: 1, board: 'Maybeboard' }])
    const result = applyDownloadDiff(sections, diff)
    expect(result.find((s) => s.name === 'Main')!.cards).toHaveLength(1)
    expect(result.find((s) => s.name === 'Maybeboard')!.cards).toHaveLength(0)
  })

  test('removes a card from every section in its board when it spans multiple', () => {
    // Both custom headers normalize to Main; a full removal should clear all of
    // them, not just the first matching line.
    const sections: DeckSection[] = [
      { name: 'Lands', cards: [{ quantity: 1, name: 'Island' }] },
      { name: 'Ramp', cards: [{ quantity: 1, name: 'Island' }] },
    ]
    const diff = removeDiff([{ name: 'Island', totalQuantity: 2, board: 'Main' }])
    const result = applyDownloadDiff(sections, diff)
    expect(result.find((s) => s.name === 'Lands')!.cards).toHaveLength(0)
    expect(result.find((s) => s.name === 'Ramp')!.cards).toHaveLength(0)
  })

  test('adjusts quantities', () => {
    const sections = mainSections([{ quantity: 2, name: 'Island' }])
    const diff = qtyDiff([{ name: 'Island', oldQty: 2, newQty: 4, board: 'Main' }])
    const result = applyDownloadDiff(sections, diff)
    expect(result[0]!.cards[0]!.quantity).toBe(4)
  })

  test('adds new cards to Main section', () => {
    const sections = mainSections([{ quantity: 1, name: 'Sol Ring' }])
    const diff = addDiff([{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Main' }])
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
    const diff = addDiff([{ name: 'Cavern-Hoard Dragon', totalQuantity: 1, board: 'Maybeboard' }])
    const result = applyDownloadDiff(sections, diff)
    expect(result.find((s) => s.name === 'Main')!.cards).toHaveLength(1)
    const maybe = result.find((s) => s.name === 'Maybeboard')!.cards
    expect(maybe).toHaveLength(2)
    expect(maybe[1]!.name).toBe('Cavern-Hoard Dragon')
  })

  test('creates a Maybeboard section when adding to a board that does not exist', () => {
    const sections = mainSections([{ quantity: 1, name: 'Sol Ring' }])
    const diff = addDiff([{ name: 'Cavern-Hoard Dragon', totalQuantity: 1, board: 'Maybeboard' }])
    const result = applyDownloadDiff(sections, diff)
    expect(result.find((s) => s.name === 'Main')!.cards).toHaveLength(1)
    const maybe = result.find((s) => s.name === 'Maybeboard')
    expect(maybe).toBeDefined()
    expect(maybe!.cards[0]!.name).toBe('Cavern-Hoard Dragon')
  })

  // Section-ordering cases share the same shape: take some starting sections,
  // add cards to one or more boards, and assert the resulting section order.
  const mainAndMaybe: DeckSection[] = [
    { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Forgotten Ancient' }] },
  ]
  const commanderAndMain: DeckSection[] = [
    { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
    { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
  ]
  const customMainSections: DeckSection[] = [
    { name: 'Lands', cards: [{ quantity: 1, name: 'Island' }] },
    { name: 'Ramp', cards: [{ quantity: 1, name: 'Sol Ring' }] },
  ]

  type OrderingCase = {
    label: string
    starting: DeckSection[]
    added: CardSummary[]
    expected: string[]
  }
  const orderingCases: OrderingCase[] = [
    {
      label: 'inserts a created Commander section before lower-ranked boards',
      starting: mainAndMaybe,
      added: [{ name: 'Atraxa', totalQuantity: 1, board: 'Commander' }],
      expected: ['Commander', 'Main', 'Maybeboard'],
    },
    {
      label: 'inserts a created Sideboard section between Main and Maybeboard',
      starting: mainAndMaybe,
      added: [{ name: 'Pyroblast', totalQuantity: 1, board: 'Sideboard' }],
      expected: ['Main', 'Sideboard', 'Maybeboard'],
    },
    {
      label: 'appends a created Maybeboard section after existing boards',
      starting: commanderAndMain,
      added: [{ name: 'Cavern-Hoard Dragon', totalQuantity: 1, board: 'Maybeboard' }],
      expected: ['Commander', 'Main', 'Maybeboard'],
    },
    {
      label: 'places multiple created boards in canonical order regardless of diff order',
      starting: mainSections([{ quantity: 1, name: 'Sol Ring' }]),
      // Listed Maybeboard-first, Commander-last: the result must still be canonical.
      added: [
        { name: 'Cavern-Hoard Dragon', totalQuantity: 1, board: 'Maybeboard' },
        { name: 'Pyroblast', totalQuantity: 1, board: 'Sideboard' },
        { name: 'Atraxa', totalQuantity: 1, board: 'Commander' },
      ],
      expected: ['Commander', 'Main', 'Sideboard', 'Maybeboard'],
    },
    {
      // Both custom headers normalize to Main; a newly created Commander section must
      // land first without reordering the user's custom Main sections.
      label: 'preserves the existing order of custom same-board sections',
      starting: customMainSections,
      added: [{ name: 'Atraxa', totalQuantity: 1, board: 'Commander' }],
      expected: ['Commander', 'Lands', 'Ramp'],
    },
  ]
  test.each(orderingCases)('$label', ({ starting, added, expected }) => {
    const result = applyDownloadDiff(starting, addDiff(added))
    expect(result.map((s) => s.name)).toEqual(expected)
  })

  test('does not mutate original sections', () => {
    const sections = mainSections([{ quantity: 2, name: 'Island' }])
    const diff = qtyDiff([{ name: 'Island', oldQty: 2, newQty: 4, board: 'Main' }])
    applyDownloadDiff(sections, diff)
    expect(sections[0]!.cards[0]!.quantity).toBe(2)
  })

  test('a quantity change down to zero empties the line rather than clamping it', () => {
    // Not reachable from a real diff — a card the source no longer holds is a
    // removal, not a quantity change — but the applier must not leave a line
    // claiming a copy the source says is gone.
    const sections = mainSections([{ quantity: 3, name: 'Island' }])
    const diff = qtyDiff([{ name: 'Island', oldQty: 3, newQty: 0, board: 'Main' }])
    const result = applyDownloadDiff(sections, diff)
    expect(result[0]!.cards).toEqual([])
  })

  test('sets the board total to the remote quantity when a card spans multiple sections', () => {
    // Both custom headers normalize to Main, so the diff sees a single board total
    // of 3. The remote wants 1, a decrease that exceeds the first line's quantity.
    const sections: DeckSection[] = [
      { name: 'Lands', cards: [{ quantity: 2, name: 'Island' }] },
      { name: 'Ramp', cards: [{ quantity: 1, name: 'Island' }] },
    ]
    const diff = qtyDiff([{ name: 'Island', oldQty: 3, newQty: 1, board: 'Main' }])
    const result = applyDownloadDiff(sections, diff)
    // First matching line is set to the remote total; the duplicate line is dropped.
    const total = result.flatMap((s) => s.cards).reduce((sum, c) => sum + c.quantity, 0)
    expect(total).toBe(1)
    expect(result.find((s) => s.name === 'Lands')!.cards[0]!.quantity).toBe(1)
    expect(result.find((s) => s.name === 'Ramp')!.cards).toHaveLength(0)
  })

  test('keeps the board total correct for a multi-section increase', () => {
    const sections: DeckSection[] = [
      { name: 'Lands', cards: [{ quantity: 2, name: 'Island' }] },
      { name: 'Ramp', cards: [{ quantity: 1, name: 'Island' }] },
    ]
    const diff = qtyDiff([{ name: 'Island', oldQty: 3, newQty: 5, board: 'Main' }])
    const result = applyDownloadDiff(sections, diff)
    const total = result.flatMap((s) => s.cards).reduce((sum, c) => sum + c.quantity, 0)
    expect(total).toBe(5)
  })
})

// ── syncDeckFormat ────────────────────────────────────────────────────

describe('syncDeckFormat', () => {
  const commanderSections: DeckSection[] = [
    { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
    { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
  ]

  function deck(partial: Partial<DeckData> = {}): DeckData {
    return { name: 'Test Deck', sections: [], ...partial }
  }

  test('adopts the remote format when it differs from the local one', () => {
    const result = syncDeckFormat(
      deck({ format: 'commander' }),
      'commander',
      deck({ format: 'modern' }),
    )
    expect(result).toEqual({ format: 'modern', localFormat: 'commander', changed: true })
  })

  test('reports no change when the remote format matches', () => {
    const result = syncDeckFormat(deck({ format: 'modern' }), 'modern', deck({ format: 'modern' }))
    expect(result.changed).toBe(false)
    expect(result.format).toBe('modern')
  })

  test('is a change when the local deck only ever inferred a different format', () => {
    // No `format:` locally — the sections imply Commander, and Archidekt says
    // Duel Commander. The deck must be re-saved to record the remote's answer.
    const local = deck({ sections: commanderSections })
    const result = syncDeckFormat(local, undefined, deck({ format: 'duel-commander' }))
    expect(result).toEqual({
      format: 'duel-commander',
      localFormat: 'commander',
      changed: true,
    })
  })

  test('is not a change when the inferred local format already matches the remote', () => {
    const local = deck({ sections: commanderSections })
    const result = syncDeckFormat(local, undefined, deck({ format: 'commander' }))
    expect(result.changed).toBe(false)
  })

  test('keeps the local format when the remote reports one Ritual does not model', () => {
    // Archidekt's Custom/Frontier/Future Standard arrive with no format at all.
    const local = deck({ format: 'legacy' })
    const result = syncDeckFormat(local, 'legacy', deck())
    expect(result).toEqual({ format: 'legacy', localFormat: 'legacy', changed: false })
  })

  test('leaves the format unset when neither side has one', () => {
    const local = deck({ sections: [{ name: 'Main', cards: [{ quantity: 4, name: 'Bolt' }] }] })
    const result = syncDeckFormat(local, undefined, deck())
    expect(result).toEqual({ format: null, localFormat: null, changed: false })
  })
})

// ── filterDeckDiff ────────────────────────────────────────────────────

/** A diff with one of each change kind, so a filter's every branch is exercised. */
function filterableDiff(): DeckDiff {
  return deckDiff({
    printingUpdates: [
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '240' },
        to: { set: 'ltc', collectorNumber: '284' },
      },
    ],
    added: [{ name: 'Sol Ring', totalQuantity: 1, board: 'Main' }],
    removed: [{ name: 'Lightning Bolt', totalQuantity: 2, board: 'Sideboard' }],
    quantityChanged: [
      { name: 'Brainstorm', oldQty: 1, newQty: 3, board: 'Main' },
      { name: 'Ponder', oldQty: 4, newQty: 2, board: 'Main' },
    ],
  })
}

describe('filterDeckDiff', () => {
  test('passes the diff through untouched when no filter is given', () => {
    const original = filterableDiff()
    const filtered = filterDeckDiff(original, undefined)
    expect(filtered.diff).toBe(original)
    expect(filtered.skipped).toBe(0)
  })

  test('additions keeps added cards and quantity increases', () => {
    const { diff: kept, skipped } = filterDeckDiff(filterableDiff(), 'additions')
    expect(kept.added.map((card) => card.name)).toEqual(['Sol Ring'])
    expect(kept.removed).toEqual([])
    expect(kept.quantityChanged.map((entry) => entry.name)).toEqual(['Brainstorm'])
    // Printing updates neither add nor remove copies, so the filter has nothing
    // to say about them: they pass through and are not counted as skipped.
    expect(kept.printingUpdates).toHaveLength(1)
    // One removal plus one decrease were left out.
    expect(skipped).toBe(2)
  })

  test('removals keeps removed cards and quantity decreases', () => {
    const { diff: kept, skipped } = filterDeckDiff(filterableDiff(), 'removals')
    expect(kept.added).toEqual([])
    expect(kept.removed.map((card) => card.name)).toEqual(['Lightning Bolt'])
    expect(kept.quantityChanged.map((entry) => entry.name)).toEqual(['Ponder'])
    expect(kept.printingUpdates).toHaveLength(1)
    expect(skipped).toBe(2)
  })

  test('leaves the input diff alone', () => {
    const original = filterableDiff()
    filterDeckDiff(original, 'additions')
    expect(original.removed).toHaveLength(1)
    expect(original.quantityChanged).toHaveLength(2)
  })

  test('reports nothing skipped when the whole diff is on the kept side', () => {
    const additionsOnly: DeckDiff = {
      byPrinting: false,
      printingUpdates: [],
      unaligned: [],
      added: [{ name: 'Sol Ring', totalQuantity: 1, board: 'Main' }],
      removed: [],
      quantityChanged: [{ name: 'Brainstorm', oldQty: 1, newQty: 2, board: 'Main' }],
    }
    const { diff: kept, skipped } = filterDeckDiff(additionsOnly, 'additions')
    expect(kept).toEqual(additionsOnly)
    expect(skipped).toBe(0)
  })

  test('can empty the diff entirely, which the engine reads as "no changes"', () => {
    const { diff: kept, skipped } = filterDeckDiff(
      deckDiff({ removed: [{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Main' }] }),
      'additions',
    )
    expect(kept).toEqual(deckDiff())
    expect(skipped).toBe(1)
  })
})
