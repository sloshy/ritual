import { describe, expect, test } from 'bun:test'
import { deckSyncCardChanges } from '../../src/deck-sync/card-changes'
import { describeDeckCardChange } from '../../src/deck-sync/describe'
import { diffDeckCards, type DeckDiff } from '../../src/deck-sync/diff'
import { buildUploadPlan } from '../../src/deck-sync/upload-plan'
import type { ArchidektClient } from '../../src/clients/ArchidektClient'
import type { DeckSection } from '../../src/list/deck'
import { archidektDeck, archidektDeckSections, searchingClient } from '../helpers/archidekt-deck'
import type { DeckSyncCardChange } from '../../src/deck-sync/types'
import '../../src/i18n/register/cli'

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
  return changes.map(describeDeckCardChange)
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
      describeDeckCardChange({
        kind: 'printing',
        name: 'Sol Ring',
        board: 'Commander',
        from: {},
        to: { set: 'c21', collectorNumber: '263' },
      }),
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
      searchCards: async (name, ...rest) =>
        name === missing
          ? `No Archidekt card found for "${name}"`
          : found.searchCards(name, ...rest),
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

    expect(plan.errors).toHaveLength(1)
    expect(deckSyncCardChanges(plan.applied, [])).toEqual([
      { kind: 'added', name: 'Brainstorm', quantity: 1, board: 'Main' },
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
