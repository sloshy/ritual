import { describe, expect, test } from 'bun:test'
import { deckSyncCardChanges } from '../../src/deck-sync/card-changes'
import {
  deckChangeCounts,
  deckItemLines,
  describeDeckCardChange,
  describeDeckChangesLine,
} from '../../src/deck-sync/describe'
import { diffDeckCards, type DeckDiff } from '../../src/deck-sync/diff'
import { buildUploadPlan } from '../../src/deck-sync/upload-plan'
import { ArchidektClient, type ArchidektCardQuery } from '../../src/clients/ArchidektClient'
import type { DeckSection } from '../../src/list/deck'
import { archidektDeck, archidektDeckSections, searchingClient } from '../helpers/archidekt-deck'
import type { DeckSyncCardChange } from '../../src/deck-sync/types'
import { english, englishLines } from '../helpers/sync-text'
import { syncMessage } from '../../src/sync/message'

/**
 * A deck sync's per-card change list: the structured entries every deck
 * result carries, and the lines rendered from them — what `deck-sync
 * --verbose` prints and what the admin Sync Decks page shows under each deck,
 * pinned byte for byte.
 */

const EMPTY_DIFF: DeckDiff = {
  byPrinting: false,
  added: [],
  removed: [],
  quantityChanged: [],
  printingUpdates: [],
  boardMoves: [],
  unaligned: [],
}

/** Every line a list of changes renders to. */
function lines(changes: readonly DeckSyncCardChange[]): string[] {
  return changes.map((change) => english(describeDeckCardChange(change)))
}

describe('deckSyncCardChanges', () => {
  test('lists every kind of change, in the summary’s order', () => {
    expect(
      deckSyncCardChanges(
        {
          ...EMPTY_DIFF,
          boardMoves: [{ name: 'Island', from: 'Main', to: 'Sideboard', quantity: 2 }],
          printingUpdates: [
            {
              name: 'Sol Ring',
              board: 'Main',
              from: { set: 'c21', collectorNumber: '263' },
              to: { set: 'lea', collectorNumber: '270' },
            },
          ],
          quantityChanged: [{ name: 'Counterspell', oldQty: 2, newQty: 3, board: 'Main' }],
          removed: [{ name: 'Lightning Bolt', totalQuantity: 1, board: 'Sideboard' }],
          added: [{ name: 'Brainstorm', totalQuantity: 4, board: 'Main' }],
        },
        [{ cardName: 'Sol Ring', categories: ['Ramp'] }],
      ),
    ).toEqual([
      { kind: 'added', name: 'Brainstorm', quantity: 4, board: 'Main' },
      { kind: 'removed', name: 'Lightning Bolt', quantity: 1, board: 'Sideboard' },
      { kind: 'quantity', name: 'Counterspell', board: 'Main', from: 2, to: 3 },
      { kind: 'move', name: 'Island', quantity: 2, from: 'Main', to: 'Sideboard' },
      {
        kind: 'printing',
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '263' },
        to: { set: 'lea', collectorNumber: '270' },
      },
      { kind: 'categories', name: 'Sol Ring', categories: ['Ramp'] },
    ])
  })

  test('a printing change lists the printing the copies end up holding', () => {
    // A finish-only update keeps the destination's edition.
    expect(
      deckSyncCardChanges(
        {
          ...EMPTY_DIFF,
          printingUpdates: [
            {
              name: 'Sol Ring',
              board: 'Main',
              from: { set: 'c21', collectorNumber: '263' },
              to: { finish: 'foil' },
            },
          ],
        },
        [],
      ),
    ).toEqual([
      {
        kind: 'printing',
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '263' },
        to: { set: 'c21', collectorNumber: '263', finish: 'foil' },
      },
    ])
  })

  test('an empty diff with no category changes lists nothing', () => {
    expect(deckSyncCardChanges(EMPTY_DIFF, [])).toEqual([])
  })
})

describe('describeDeckCardChange', () => {
  test('renders each kind of change', () => {
    expect(
      lines([
        { kind: 'added', name: 'Brainstorm', quantity: 4, board: 'Main' },
        { kind: 'removed', name: 'Lightning Bolt', quantity: 1, board: 'Sideboard' },
        { kind: 'quantity', name: 'Counterspell', board: 'Main', from: 2, to: 3 },
        { kind: 'move', name: 'Island', quantity: 2, from: 'Main', to: 'Sideboard' },
        {
          kind: 'printing',
          name: 'Sol Ring',
          board: 'Main',
          from: { set: 'c21', collectorNumber: '263', finish: 'foil' },
          to: { set: 'lea', collectorNumber: '270', finish: 'foil' },
        },
      ]),
    ).toEqual([
      '+ 4 Brainstorm to Main',
      '- 1 Lightning Bolt from Sideboard',
      '~ Counterspell in Main: 2 → 3',
      '> 2 Island: Main → Sideboard',
      '* Sol Ring in Main: (C21:263) [foil] → (LEA:270) [foil]',
    ])
  })

  test('names the printing a printing-keyed change carries, set code uppercased', () => {
    const bolt = { set: '2xm', collectorNumber: '117', finish: 'foil' } as const
    expect(
      lines([
        { kind: 'added', name: 'Lightning Bolt', quantity: 1, board: 'Main', printing: bolt },
        { kind: 'quantity', name: 'Lightning Bolt', board: 'Main', from: 1, to: 2, printing: bolt },
        {
          kind: 'move',
          name: 'Lightning Bolt',
          quantity: 1,
          from: 'Main',
          to: 'Sideboard',
          printing: bolt,
        },
        // The bare printing states nothing, so it reads as the name alone.
        { kind: 'removed', name: 'Sol Ring', quantity: 1, board: 'Main', printing: {} },
      ]),
    ).toEqual([
      '+ 1 Lightning Bolt (2XM:117) [foil] to Main',
      '~ Lightning Bolt (2XM:117) [foil] in Main: 1 → 2',
      '> 1 Lightning Bolt (2XM:117) [foil]: Main → Sideboard',
      '- 1 Sol Ring from Main',
    ])
  })

  test('a printing change from a bare line says so rather than printing nothing', () => {
    expect(
      english(
        describeDeckCardChange({
          kind: 'printing',
          name: 'Sol Ring',
          board: 'Commander',
          from: {},
          to: { set: 'c21', collectorNumber: '263' },
        }),
      ),
    ).toBe('* Sol Ring in Commander: no printing → (C21:263)')
  })

  test('a finish-only change spells out both finishes', () => {
    expect(
      lines([
        {
          kind: 'printing',
          name: 'Sol Ring',
          board: 'Main',
          from: { set: 'c21', collectorNumber: '263' },
          to: { set: 'c21', collectorNumber: '263', finish: 'foil' },
        },
        {
          kind: 'printing',
          name: 'Sol Ring',
          board: 'Main',
          from: { set: 'c21', collectorNumber: '263', finish: 'etched' },
          to: { set: 'c21', collectorNumber: '263' },
        },
      ]),
    ).toEqual([
      '* Sol Ring in Main: (C21:263) [nonfoil] → (C21:263) [foil]',
      '* Sol Ring in Main: (C21:263) [etched] → (C21:263) [nonfoil]',
    ])
  })

  test('lists a card’s categories primary first, and a cleared card as none', () => {
    expect(
      lines([
        { kind: 'categories', name: 'Sol Ring', categories: ['Ramp', 'Artifacts'] },
        { kind: 'categories', name: 'Island', categories: [] },
      ]),
    ).toEqual(['= Sol Ring categories: Ramp, Artifacts', '= Island categories: none'])
  })
})

describe('buildUploadPlan applied', () => {
  /** A client whose search refuses `missing` and finds every other name. */
  function searchingExcept(missing: string): ArchidektClient {
    const found = searchingClient('Removal')
    const client: Pick<ArchidektClient, 'searchCards'> = {
      searchCards: async (query, token) =>
        query.name === missing
          ? syncMessage('domain.sync.archidekt.cardNotFound', { card: query.label })
          : found.searchCards(query, token),
    }
    return client as ArchidektClient
  }

  test('an addition the search could not resolve is not in what the plan carries out', async () => {
    const raw = archidektDeck([{ id: 1, name: 'Sol Ring', categories: [] }], [])
    const local: DeckSection[] = [
      {
        name: 'Main',
        cards: ['Sol Ring', 'Brainstorm', 'Ponder'].map((name) => ({ quantity: 1, name })),
      },
    ]
    const diff = diffDeckCards(archidektDeckSections(raw), local)
    const plan = await buildUploadPlan(diff, local, raw, searchingExcept('Ponder'), 'token')

    expect(plan.errors).toEqual([
      {
        message: 'Card not found on Archidekt: Ponder',
        messageKey: 'domain.sync.archidekt.cardNotFound',
        messageParams: { card: 'Ponder' },
      },
    ])
    expect(deckSyncCardChanges(plan.applied, [])).toEqual([
      { kind: 'added', name: 'Brainstorm', quantity: 1, board: 'Main' },
    ])
  })

  test('re-adding a card Archidekt holds at zero copies patches that relation', async () => {
    // The deck parser keeps a zero-copy relation (only an import drops it), so
    // the diff reads the re-add as a quantity change and the plan modifies the
    // relation Archidekt already has rather than adding a second one.
    const raw = archidektDeck([{ id: 1, name: 'Island', quantity: 0, categories: [] }], [])
    const local: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 3, name: 'Island' }] }]
    const diff = diffDeckCards(archidektDeckSections(raw), local)
    expect(diff.added).toEqual([])
    const plan = await buildUploadPlan(diff, local, raw, searchingExcept('Island'), 'token')
    expect(plan.errors).toEqual([])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]).toMatchObject({
      action: 'modify',
      deckRelationId: 1,
      modifications: { quantity: 3 },
    })
  })

  test('a failed search is the plan’s error, from the real client', async () => {
    // One real failed search through the real client: what the plan carries is
    // the client's own message, naming the card the plan was adding.
    const raw = archidektDeck([], [])
    const local: DeckSection[] = [{ name: 'Main', cards: [{ quantity: 1, name: 'Ponder' }] }]
    const unavailable = new ArchidektClient(
      { fetch: async () => new Response('', { status: 503 }) },
      { minRequestIntervalMs: 0 },
    )

    const plan = await buildUploadPlan(
      diffDeckCards(archidektDeckSections(raw), local),
      local,
      raw,
      unavailable,
      'token',
    )

    expect(plan.errors).toEqual([
      {
        message: 'The Archidekt card search for Ponder failed (HTTP 503)',
        messageKey: 'domain.sync.archidekt.searchFailed',
        messageParams: { card: 'Ponder', status: 503 },
      },
    ])
  })

  test('a printing update the search refuses carries that refusal, labelled with its printing', async () => {
    const raw = archidektDeck([{ id: 1, name: 'Sol Ring', categories: [] }], [])
    const local: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '270' }],
      },
    ]
    const refusal = syncMessage('domain.sync.archidekt.cardNotFound', { card: 'x' })
    const asked: ArchidektCardQuery[] = []
    const client: Pick<ArchidektClient, 'searchCards'> = {
      searchCards: async (query) => {
        asked.push(query)
        return refusal
      },
    }

    const plan = await buildUploadPlan(
      diffDeckCards(archidektDeckSections(raw), local, { withPrintings: true }),
      local,
      raw,
      client as ArchidektClient,
      'token',
    )

    // The refusal itself, not a rewording of it.
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toBe(refusal)
    expect(asked).toEqual([
      { name: 'Sol Ring', set: 'lea', collectorNumber: '270', label: 'Sol Ring (LEA:270)' },
    ])
  })

  test('a failed printing update takes the quantity change riding on it along', async () => {
    const raw = archidektDeck([{ id: 1, name: 'Sol Ring', categories: [] }], [])
    const local: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 2, name: 'Sol Ring', set: 'lea', collectorNumber: '270' }],
      },
    ]
    const diff = diffDeckCards(archidektDeckSections(raw), local, { withPrintings: true })
    expect(diff.printingUpdates).toHaveLength(1)
    expect(diff.quantityChanged).toHaveLength(1)

    const plan = await buildUploadPlan(diff, local, raw, searchingExcept('Sol Ring'), 'token')

    expect(plan.applied.printingUpdates).toEqual([])
    expect(plan.applied.quantityChanged).toEqual([])
  })

  test('a printing update Archidekt already holds sends nothing and is not listed', async () => {
    const raw = archidektDeck([{ id: 1, name: 'Sol Ring', categories: [] }], [])
    const tst = { set: 'tst', collectorNumber: '1' }
    const plan = await buildUploadPlan(
      {
        ...EMPTY_DIFF,
        byPrinting: true,
        printingUpdates: [{ name: 'Sol Ring', board: 'Main', from: tst, to: tst }],
      },
      [],
      raw,
      searchingClient('Removal'),
      'token',
    )

    expect(plan.entries).toEqual([])
    expect(plan.applied.printingUpdates).toEqual([])
  })

  test('a printing update lists the finish it sent when the stated one fell back', async () => {
    // A bare line wants nonfoil; this printing is offered in foil only.
    const raw = archidektDeck(
      [{ id: 1, name: 'Sol Ring', categories: [], modifier: 'Normal', options: ['Foil'] }],
      [],
    )
    const tst = { set: 'tst', collectorNumber: '1' }
    const plan = await buildUploadPlan(
      {
        ...EMPTY_DIFF,
        byPrinting: true,
        printingUpdates: [{ name: 'Sol Ring', board: 'Main', from: tst, to: tst }],
      },
      [],
      raw,
      searchingClient('Removal'),
      'token',
    )

    expect(plan.applied.printingUpdates).toEqual([
      { name: 'Sol Ring', board: 'Main', from: tst, to: { ...tst, finish: 'foil' } },
    ])
  })

  test('a board move with no source relation is dropped entirely', async () => {
    const raw = archidektDeck([{ id: 1, name: 'Sol Ring', categories: [] }], [])
    const plan = await buildUploadPlan(
      {
        ...EMPTY_DIFF,
        boardMoves: [{ name: 'Island', from: 'Main', to: 'Sideboard', quantity: 2 }],
      },
      [],
      raw,
      searchingClient('Removal'),
      'token',
    )

    expect(plan.errors).toHaveLength(1)
    expect(plan.applied.boardMoves).toEqual([])
  })

  test('a board move that came up short lists only the copies it took', async () => {
    const raw = archidektDeck([{ id: 1, name: 'Sol Ring', categories: [] }], [])
    const plan = await buildUploadPlan(
      {
        ...EMPTY_DIFF,
        boardMoves: [{ name: 'Sol Ring', from: 'Main', to: 'Sideboard', quantity: 3 }],
        // Stated from the 3 copies the move was to bring.
        quantityChanged: [{ name: 'Sol Ring', board: 'Sideboard', oldQty: 3, newQty: 4 }],
      },
      [],
      raw,
      searchingClient('Removal'),
      'token',
    )

    expect(plan.errors).toHaveLength(1)
    expect(plan.applied.boardMoves).toEqual([
      { name: 'Sol Ring', from: 'Main', to: 'Sideboard', quantity: 1 },
    ])
    // It brought one, so the landing board grows from one.
    expect(plan.applied.quantityChanged).toEqual([
      { name: 'Sol Ring', board: 'Sideboard', oldQty: 1, newQty: 4 },
    ])
  })
})

describe('deck change count lines', () => {
  /** One of every kind, two printing changes, and a category change. */
  const CHANGES: DeckSyncCardChange[] = [
    { kind: 'added', name: 'Brainstorm', quantity: 4, board: 'Main' },
    { kind: 'removed', name: 'Lightning Bolt', quantity: 1, board: 'Sideboard' },
    { kind: 'removed', name: 'Ponder', quantity: 1, board: 'Main' },
    { kind: 'quantity', name: 'Counterspell', board: 'Main', from: 2, to: 3 },
    { kind: 'move', name: 'Island', quantity: 2, from: 'Main', to: 'Sideboard' },
    { kind: 'printing', name: 'Sol Ring', board: 'Main', from: {}, to: { finish: 'foil' } },
    { kind: 'printing', name: 'Mox', board: 'Main', from: {}, to: { finish: 'foil' } },
    { kind: 'categories', name: 'Sol Ring', categories: ['Ramp'] },
  ]

  // The exact strings the engine logged before its builders moved here.
  test('a pull and a push word every clause as the run log always has', () => {
    expect(english(describeDeckChangesLine('pull', deckChangeCounts(CHANGES, true)))).toBe(
      "Changes: +1 added, -2 removed, ~1 quantity changed, 1 board move, 2 printings changed, 1 card's categories changed",
    )
    expect(english(describeDeckChangesLine('push', deckChangeCounts(CHANGES, true)))).toBe(
      "Changes: +1 to add, -2 to remove, ~1 quantity changes, 1 board move, 2 printings to change, 1 card's categories to change",
    )
  })

  test('a run not syncing categories has no categories clause, and no moves no move clause', () => {
    expect(
      english(describeDeckChangesLine('pull', deckChangeCounts(CHANGES.slice(0, 2), false))),
    ).toBe('Changes: +1 added, -1 removed, ~0 quantity changed')
    expect(english(describeDeckChangesLine('pull', deckChangeCounts([], true)))).toBe(
      "Changes: +0 added, -0 removed, ~0 quantity changed, 0 cards' categories changed",
    )
  })

  test('a deck replays its count line, then a line per card', () => {
    expect(englishLines(deckItemLines('pull', CHANGES.slice(0, 1), false))).toEqual([
      { level: 'info', text: 'Changes: +1 added, -0 removed, ~0 quantity changed' },
      { level: 'detail', text: '+ 4 Brainstorm to Main' },
    ])
    expect(deckItemLines('pull', [], false)).toEqual([])
  })
})
