import type { DeckLandingOptions } from '../../src/changes/deck-changes'
import { describe, expect, test } from 'bun:test'
import {
  applyDownloadDiff,
  applyPrintingUpdates,
  diffDeckCards,
  diffToChangeEvents,
  filterDeckDiff,
  isDiffEmpty,
  pullChangeEvents,
  type DeckDiff,
} from '../../src/deck-sync/diff'
import { buildUploadPlan, type UploadPlan } from '../../src/deck-sync/upload-plan'
import { assignMissingDeckCardIds } from '../../src/card/card-id'
import { applyChangeToDeck } from '../../src/changes/deck-changes'
import type { ArchidektCategory } from '../../src/importers/archidekt-types'
import type { Card } from '../../src/card/card'
import type { DeckSection } from '../../src/list/deck'
import type { SyncChangeFilter } from '../../src/sync/common'
import {
  archidektDeck,
  archidektDeckSections,
  relationCardId,
  searchingClient,
  type RelationSpec,
} from '../helpers/archidekt-deck'

/** No deck-level default labels. */
const NO_LABELS: DeckLandingOptions = { listLabels: undefined }

/**
 * Board moves at the engine layer: how the diff pairs copies one board loses
 * with copies another gains, how a pull re-homes the local lines (and records
 * them so a changelog replay reproduces the file), and how a push re-boards the
 * Archidekt relations. The command wiring is pinned in
 * `test/integration/deck-sync-run.test.ts`.
 */

function section(name: string, cards: Card[]): DeckSection {
  return { name, cards }
}

function card(quantity: number, name: string, extra: Partial<Card> = {}): Card {
  return { quantity, name, ...extra }
}

const LEA = { set: 'lea', collectorNumber: '161' }
const C21 = { set: 'c21', collectorNumber: '240' }
const LTC = { set: 'ltc', collectorNumber: '284' }

/** A diff holding only a move of `quantity` Bolts from Main to the Sideboard. */
function boltMove(quantity: number): DeckDiff {
  return {
    byPrinting: false,
    added: [],
    removed: [],
    quantityChanged: [],
    printingUpdates: [],
    unaligned: [],
    boardMoves: [{ name: 'Bolt', from: 'Main', to: 'Sideboard', quantity }],
  }
}

// ── Pairing ───────────────────────────────────────────────────────────

describe('diffDeckCards board moves', () => {
  test('a card that only changed board is a move and nothing else', () => {
    const diff = diffDeckCards(
      [section('Main', [card(1, 'Dragon')])],
      [section('Maybeboard', [card(1, 'Dragon')])],
    )
    expect(diff.boardMoves).toEqual([
      { name: 'Dragon', from: 'Main', to: 'Maybeboard', quantity: 1 },
    ])
    expect(diffToChangeEvents(diff)).toEqual([])
  })

  test('a removal partly met by a move leaves the unmoved copies as a decrease', () => {
    const diff = diffDeckCards(
      [section('Maybeboard', [card(3, 'Bolt')])],
      [section('Main', [card(1, 'Bolt')])],
    )
    expect(diff.boardMoves).toEqual([{ name: 'Bolt', from: 'Maybeboard', to: 'Main', quantity: 1 }])
    // Shrink to the one copy the move then takes.
    expect(diff.quantityChanged).toEqual([
      { name: 'Bolt', board: 'Maybeboard', oldQty: 3, newQty: 1 },
    ])
    expect(diff).toMatchObject({ added: [], removed: [] })
  })

  test('an addition partly met by a move grows from the copies the move brought', () => {
    const diff = diffDeckCards(
      [section('Maybeboard', [card(1, 'Bolt')])],
      [section('Main', [card(3, 'Bolt')])],
    )
    expect(diff.boardMoves).toEqual([{ name: 'Bolt', from: 'Maybeboard', to: 'Main', quantity: 1 }])
    expect(diff.quantityChanged).toEqual([{ name: 'Bolt', board: 'Main', oldQty: 1, newQty: 3 }])
    expect(diff).toMatchObject({ added: [], removed: [] })
  })

  test('a copy only one side holds in a second board is a removal there, not a move', () => {
    const diff = diffDeckCards(
      [section('Main', [card(1, 'Bolt')]), section('Maybeboard', [card(1, 'Bolt')])],
      [section('Main', [card(1, 'Bolt')])],
    )
    expect(diff.boardMoves).toEqual([])
    expect(diff.removed).toEqual([{ name: 'Bolt', board: 'Maybeboard', totalQuantity: 1 }])
  })

  test('copies never move onto a board the destination already holds the card on', () => {
    // A move would put a second Bolt line beside the Main one; the copies are a
    // quantity transfer instead.
    const diff = diffDeckCards(
      [section('Main', [card(1, 'Bolt')]), section('Maybeboard', [card(1, 'Bolt')])],
      [section('Main', [card(2, 'Bolt')])],
    )
    expect(diff.boardMoves).toEqual([])
    expect(diff.removed).toEqual([{ name: 'Bolt', board: 'Maybeboard', totalQuantity: 1 }])
    expect(diff.quantityChanged).toEqual([{ name: 'Bolt', board: 'Main', oldQty: 1, newQty: 2 }])
  })

  test('losing boards drain in canonical order: the Sideboard copy moves, the Maybeboard one goes', () => {
    const diff = diffDeckCards(
      [section('Maybeboard', [card(1, 'Bolt')]), section('Sideboard', [card(1, 'Bolt')])],
      [section('Main', [card(1, 'Bolt')])],
    )
    expect(diff.boardMoves).toEqual([{ name: 'Bolt', from: 'Sideboard', to: 'Main', quantity: 1 }])
    expect(diff.removed).toEqual([{ name: 'Bolt', board: 'Maybeboard', totalQuantity: 1 }])
  })

  test('a local Tokens section and a remote Maybeboard are the same board', () => {
    const diff = diffDeckCards(
      [section('Tokens', [card(1, 'Treasure')])],
      [section('Maybeboard', [card(1, 'Treasure')])],
    )
    expect(isDiffEmpty(diff)).toBe(true)
  })

  test('a printing-keyed move carries the printing it pairs at', () => {
    const diff = diffDeckCards(
      [section('Main', [card(1, 'Bolt', LEA)])],
      [section('Sideboard', [card(1, 'Bolt', LEA)])],
      { withPrintings: true },
    )
    expect(diff.boardMoves).toEqual([
      {
        name: 'Bolt',
        from: 'Main',
        to: 'Sideboard',
        quantity: 1,
        printing: { ...LEA, finish: undefined },
      },
    ])
  })

  test('a bare line elsewhere takes the copies at their own printing', () => {
    // The bare source states no printing, so the move keeps LEA — and the rest
    // of the Sideboard's copies grow from the moved line at LEA too.
    const diff = diffDeckCards(
      [section('Main', [card(1, 'Bolt', LEA)])],
      [section('Sideboard', [card(3, 'Bolt')])],
      { withPrintings: true },
    )
    expect(diff.boardMoves).toMatchObject([
      { from: 'Main', to: 'Sideboard', quantity: 1, printing: LEA },
    ])
    expect(diff.quantityChanged).toMatchObject([
      { board: 'Sideboard', oldQty: 1, newQty: 3, printing: LEA },
    ])
    expect(diff).toMatchObject({ added: [], removed: [] })
  })

  test('one landing per board and printing: a second gaining line there stays an addition', () => {
    const diff = diffDeckCards(
      [section('Sideboard', [card(3, 'Bolt', LEA)])],
      [section('Main', [card(1, 'Bolt', LEA), card(3, 'Bolt')])],
      { withPrintings: true },
    )
    expect(diff.boardMoves).toMatchObject([{ from: 'Sideboard', to: 'Main', quantity: 1 }])
    expect(diff.added).toMatchObject([{ board: 'Main', totalQuantity: 3, printing: {} }])
    expect(diff.quantityChanged).toMatchObject([
      { board: 'Sideboard', oldQty: 3, newQty: 1, printing: LEA },
    ])
  })

  test('one source per landing: a second losing board is removed, its copies re-added', () => {
    const diff = diffDeckCards(
      [section('Sideboard', [card(1, 'Bolt', LEA)]), section('Maybeboard', [card(1, 'Bolt', LEA)])],
      [section('Main', [card(2, 'Bolt', LEA)])],
      { withPrintings: true },
    )
    expect(diff.boardMoves).toMatchObject([{ from: 'Sideboard', to: 'Main', quantity: 1 }])
    expect(diff.removed).toMatchObject([{ board: 'Maybeboard', totalQuantity: 1 }])
    expect(diff.quantityChanged).toMatchObject([
      { board: 'Main', oldQty: 1, newQty: 2, printing: LEA },
    ])
  })

  test('a move pairs at the printing a printing update leaves the copies on', () => {
    // Two C21 copies in Main become one LTC in Main and one LTC in the
    // Sideboard: re-pin both, then move one.
    const diff = diffDeckCards(
      [section('Main', [card(2, 'Sol Ring', C21)])],
      [
        section('Main', [card(1, 'Sol Ring', LTC)]),
        section('Sideboard', [card(1, 'Sol Ring', LTC)]),
      ],
      { withPrintings: true },
    )
    expect(diff.printingUpdates).toMatchObject([{ board: 'Main', from: C21, to: LTC }])
    expect(diff.boardMoves).toMatchObject([
      { from: 'Main', to: 'Sideboard', quantity: 1, printing: LTC },
    ])
    expect(diff).toMatchObject({ added: [], removed: [], quantityChanged: [] })
  })

  test('a card that changes board and an unreconcilable printing is still reported unaligned', () => {
    const diff = diffDeckCards(
      [
        section('Main', [
          card(1, 'Bolt', LEA),
          card(1, 'Bolt', { set: '2xm', collectorNumber: '1' }),
        ]),
      ],
      [section('Sideboard', [card(2, 'Bolt', LEA)])],
    )
    expect(diff.boardMoves).toMatchObject([{ from: 'Main', to: 'Sideboard', quantity: 2 }])
    expect(diff.unaligned).toEqual([{ name: 'Bolt', board: 'Sideboard' }])
  })
})

describe('filterDeckDiff and isDiffEmpty with board moves', () => {
  /** A move with an unmoved remainder on each side of the filter. */
  function diffWithRemainders(): DeckDiff {
    return diffDeckCards(
      [section('Maybeboard', [card(3, 'Bolt')]), section('Main', [card(1, 'Island')])],
      [section('Main', [card(1, 'Bolt'), card(2, 'Island')])],
    )
  }

  test.each(['additions', 'removals'] as const)('--only %s keeps every move whole', (only) => {
    const { diff, skipped } = filterDeckDiff(diffWithRemainders(), only)
    expect(diff.boardMoves).toEqual([{ name: 'Bolt', from: 'Maybeboard', to: 'Main', quantity: 1 }])
    expect(skipped).toBe(1)
  })

  test('a diff holding only a move is not empty', () => {
    const diff = diffDeckCards(
      [section('Main', [card(1, 'Bolt')])],
      [section('Sideboard', [card(1, 'Bolt')])],
    )
    expect(isDiffEmpty(diff)).toBe(false)
  })
})

// ── Pull ──────────────────────────────────────────────────────────────

describe('applyDownloadDiff board moves', () => {
  test('a whole line moves with its ID, tags, labels, note, condition and language', () => {
    const line = card(1, 'Sol Ring', {
      cardId: 7,
      tags: ['Ramp'],
      labels: ['sale'],
      note: 'signed',
      condition: 'LP',
      language: 'ja',
    })
    const local = [section('Main', [line, card(1, 'Island', { cardId: 1 })])]
    const applied = applyDownloadDiff(
      local,
      diffDeckCards(local, [
        section('Commander', [card(1, 'Sol Ring')]),
        section('Main', [card(1, 'Island')]),
      ]),
      NO_LABELS,
    )

    // The Commander section is created at its canonical position, before Main.
    expect(applied.sections).toEqual([
      section('Commander', [line]),
      section('Main', [card(1, 'Island', { cardId: 1 })]),
    ])
    expect(applied.moves).toMatchObject([{ name: 'Sol Ring', split: false, section: 'Commander' }])
  })

  test('a move from the command zone drops the Commander section it emptied', () => {
    const local = [
      section('Commander', [card(1, 'Kenrith', { cardId: 1 })]),
      section('Main', [card(1, 'Island', { cardId: 2 })]),
    ]
    const applied = applyDownloadDiff(
      local,
      diffDeckCards(local, [section('Main', [card(1, 'Island'), card(1, 'Kenrith')])]),
      NO_LABELS,
    )
    expect(applied.sections).toEqual([
      section('Main', [card(1, 'Island', { cardId: 2 }), card(1, 'Kenrith', { cardId: 1 })]),
    ])
    expect(applied.moves[0]!.position).toEqual({ sectionIndex: 0, cardIndex: 1 })
  })

  test('a move lands in the first section of its board, even a Tokens one', () => {
    const local = [
      section('Main', [card(1, 'Treasure Map', { cardId: 1 })]),
      section('Tokens', [card(1, 'Clue', { cardId: 2 })]),
    ]
    const applied = applyDownloadDiff(
      local,
      diffDeckCards(local, [section('Maybeboard', [card(1, 'Clue'), card(1, 'Treasure Map')])]),
      NO_LABELS,
    )
    expect(applied.sections).toEqual([
      section('Main', []),
      section('Tokens', [card(1, 'Clue', { cardId: 2 }), card(1, 'Treasure Map', { cardId: 1 })]),
    ])
  })

  test('a partial move splits the line: the rest keeps its ID and note, the moved copies the rest', () => {
    const local = [
      section('Main', [card(3, 'Island', { cardId: 2, tags: ['Lands'], note: 'basics' })]),
    ]
    const applied = applyDownloadDiff(
      local,
      diffDeckCards(local, [
        section('Main', [card(2, 'Island')]),
        section('Sideboard', [card(1, 'Island')]),
      ]),
      NO_LABELS,
    )
    expect(applied.sections).toEqual([
      section('Main', [card(2, 'Island', { cardId: 2, tags: ['Lands'], note: 'basics' })]),
      section('Sideboard', [card(1, 'Island', { tags: ['Lands'] })]),
    ])
  })

  test('a move takes whole lines from the last one first', () => {
    const local = [
      section('Maybeboard', [
        card(1, 'Bolt', { cardId: 1, tags: ['a'] }),
        card(1, 'Bolt', { cardId: 2, tags: ['b'] }),
      ]),
    ]
    const applied = applyDownloadDiff(
      local,
      diffDeckCards(local, [
        section('Main', [card(1, 'Bolt')]),
        section('Maybeboard', [card(1, 'Bolt')]),
      ]),
      NO_LABELS,
    )
    expect(applied.sections).toEqual([
      section('Main', [card(1, 'Bolt', { cardId: 2, tags: ['b'] })]),
      section('Maybeboard', [card(1, 'Bolt', { cardId: 1, tags: ['a'] })]),
    ])
  })

  test('copies already on the target board take the moved copies as a quantity transfer', () => {
    const local = [
      section('Main', [card(1, 'Bolt', { cardId: 1 })]),
      section('Maybeboard', [card(1, 'Bolt', { cardId: 2 })]),
    ]
    const applied = applyDownloadDiff(
      local,
      diffDeckCards(local, [section('Main', [card(2, 'Bolt')])]),
      NO_LABELS,
    )
    expect(applied.sections).toEqual([section('Main', [card(2, 'Bolt', { cardId: 1 })])])
    expect(applied.moves).toEqual([])
  })

  test('--only additions still moves, taking the copies off the losing board', () => {
    const local = [section('Main', []), section('Maybeboard', [card(3, 'Bolt', { cardId: 3 })])]
    const { diff } = filterDeckDiff(
      diffDeckCards(local, [section('Main', [card(1, 'Bolt')])]),
      'additions',
    )
    expect(applyDownloadDiff(local, diff, NO_LABELS).sections).toEqual([
      section('Main', [card(1, 'Bolt')]),
      section('Maybeboard', [card(2, 'Bolt', { cardId: 3 })]),
    ])
  })

  test('a move the local lines cannot cover is reported, and creates no section', () => {
    const applied = applyDownloadDiff([section('Main', [])], boltMove(2), NO_LABELS)
    expect(applied.sections).toEqual([section('Main', [])])
    expect(applied.shortfalls).toEqual([
      { name: 'Bolt', from: 'Main', to: 'Sideboard', quantity: 2 },
    ])
  })
})

// ── Pull: changelog replay ───────────────────────────────────────────

/**
 * Pull `remote` into `before` the way the engine does — printing updates,
 * the diff, `&N` assignment, then the changelog events — and replay those
 * events through the real deck reducer over `before`. A changelog is only
 * right if the replay lands where the file did.
 */
function pullAndReplay(
  before: DeckSection[],
  remote: DeckSection[],
  withPrintings = false,
): { saved: DeckSection[]; replayed: DeckSection[] } {
  const diff = diffDeckCards(before, remote, { withPrintings })
  const applied = applyDownloadDiff(
    applyPrintingUpdates(before, diff.printingUpdates),
    diff,
    NO_LABELS,
  )
  const saved = assignMissingDeckCardIds({ name: 'Deck', sections: applied.sections }).sections
  const events = pullChangeEvents({ diff, applied, saved, before })
  let deck = { name: 'Deck', sections: before }
  for (const event of events) {
    deck = applyChangeToDeck(deck, event, {
      listLabels: undefined,
      onMiss: () => {
        throw new Error(`replay missed ${JSON.stringify(event)}`)
      },
    })
  }
  // The one thing a replay cannot reproduce is where a section the pull
  // created sits: the pull inserts it in canonical board order, the reducer
  // appends it. Everything else — which sections, which lines, in what order
  // within each — must match, so only the section order is aligned here.
  const order = saved.map((s) => s.name)
  const rank = (name: string): number => {
    const index = order.indexOf(name)
    return index === -1 ? order.length : index
  }
  return { saved, replayed: deck.sections.toSorted((a, b) => rank(a.name) - rank(b.name)) }
}

describe('pullChangeEvents replays to the file the pull wrote', () => {
  test('a new card added to another board', () => {
    const { saved, replayed } = pullAndReplay(
      [section('Main', [card(1, 'Island', { cardId: 1 })])],
      [section('Main', [card(1, 'Island')]), section('Sideboard', [card(2, 'Duress')])],
    )
    expect(saved).toEqual([
      section('Main', [card(1, 'Island', { cardId: 1 })]),
      section('Sideboard', [card(2, 'Duress', { cardId: 2 })]),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a new commander', () => {
    const { saved, replayed } = pullAndReplay(
      [section('Main', [card(1, 'Island', { cardId: 1 })])],
      [section('Commander', [card(1, 'Kenrith')]), section('Main', [card(1, 'Island')])],
    )
    expect(saved).toEqual([
      section('Commander', [card(1, 'Kenrith', { cardId: 2 })]),
      section('Main', [card(1, 'Island', { cardId: 1 })]),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a move into the command zone', () => {
    const { saved, replayed } = pullAndReplay(
      [section('Main', [card(1, 'Island', { cardId: 1 }), card(1, 'Kenrith', { cardId: 2 })])],
      [section('Commander', [card(1, 'Kenrith')]), section('Main', [card(1, 'Island')])],
    )
    expect(saved).toEqual([
      section('Commander', [card(1, 'Kenrith', { cardId: 2 })]),
      section('Main', [card(1, 'Island', { cardId: 1 })]),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a move out of the command zone drops the emptied section on replay too', () => {
    const { saved, replayed } = pullAndReplay(
      [
        section('Commander', [card(1, 'Kenrith', { cardId: 1 })]),
        section('Main', [card(1, 'Island', { cardId: 2 })]),
      ],
      [section('Main', [card(1, 'Island'), card(1, 'Kenrith')])],
    )
    expect(saved).toEqual([
      section('Main', [card(1, 'Island', { cardId: 2 }), card(1, 'Kenrith', { cardId: 1 })]),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a split whose copies land beside a line the same pull moved', () => {
    // Both Main-board sections give up Bolts to the Sideboard: the `Spells`
    // line moves whole, and the `Main` line's split copies join it there.
    const { saved, replayed } = pullAndReplay(
      [
        section('Main', [card(2, 'Bolt', { cardId: 1 })]),
        section('Spells', [card(1, 'Bolt', { cardId: 2 })]),
      ],
      [section('Main', [card(1, 'Bolt')]), section('Sideboard', [card(2, 'Bolt')])],
    )
    expect(saved).toEqual([
      section('Main', [card(1, 'Bolt', { cardId: 1 })]),
      section('Sideboard', [card(2, 'Bolt', { cardId: 2 })]),
    ])
    expect(replayed).toEqual(saved)
  })

  test('copies from two boards into one: the first moves, the second is removed', () => {
    const { saved, replayed } = pullAndReplay(
      [
        section('Main', [card(1, 'Island', { cardId: 3 })]),
        section('Sideboard', [card(1, 'Bolt', { cardId: 1 })]),
        section('Maybeboard', [card(1, 'Bolt', { cardId: 2 })]),
      ],
      [section('Main', [card(1, 'Island'), card(2, 'Bolt')])],
    )
    expect(saved).toEqual([
      section('Main', [card(1, 'Island', { cardId: 3 }), card(2, 'Bolt', { cardId: 1 })]),
      section('Sideboard', []),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a bare line beside a pinned one on the gaining board', () => {
    // Exact pairing moves the LEA copy; the bare line cannot land at LEA too
    // (one landing per printing), so it is a new line of its own.
    const { saved, replayed } = pullAndReplay(
      [section('Main', []), section('Sideboard', [card(3, 'Bolt', { ...LEA, cardId: 1 })])],
      [section('Main', [card(1, 'Bolt', LEA), card(3, 'Bolt')])],
      true,
    )
    expect(saved).toEqual([
      section('Main', [card(1, 'Bolt', { ...LEA, cardId: 1 }), card(3, 'Bolt', { cardId: 2 })]),
      section('Sideboard', []),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a finish-only line and a bare line both satisfied by one printing', () => {
    const { saved, replayed } = pullAndReplay(
      [
        section('Main', []),
        section('Sideboard', [card(1, 'Bolt', { ...LEA, finish: 'foil', cardId: 1 })]),
      ],
      [section('Main', [card(1, 'Bolt', { finish: 'foil' }), card(1, 'Bolt')])],
      true,
    )
    expect(saved).toEqual([
      section('Main', [
        card(1, 'Bolt', { ...LEA, finish: 'foil', cardId: 1 }),
        card(1, 'Bolt', { cardId: 2 }),
      ]),
      section('Sideboard', []),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a whole-line move', () => {
    const { saved, replayed } = pullAndReplay(
      [section('Main', [card(1, 'Island', { cardId: 1 }), card(1, 'Bolt', { cardId: 2 })])],
      [section('Main', [card(1, 'Island')]), section('Sideboard', [card(1, 'Bolt')])],
    )
    expect(saved).toEqual([
      section('Main', [card(1, 'Island', { cardId: 1 })]),
      section('Sideboard', [card(1, 'Bolt', { cardId: 2 })]),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a split move', () => {
    const { saved, replayed } = pullAndReplay(
      [
        section('Main', [
          card(3, 'Island', { cardId: 2, tags: ['Lands'], condition: 'LP', language: 'ja' }),
        ]),
      ],
      [section('Main', [card(2, 'Island')]), section('Sideboard', [card(1, 'Island')])],
    )
    expect(saved).toEqual([
      section('Main', [
        card(2, 'Island', { cardId: 2, tags: ['Lands'], condition: 'LP', language: 'ja' }),
      ]),
      section('Sideboard', [
        card(1, 'Island', { cardId: 1, tags: ['Lands'], condition: 'LP', language: 'ja' }),
      ]),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a move plus an increase on the board it lands on', () => {
    const { saved, replayed } = pullAndReplay(
      [
        section('Main', [card(1, 'Island', { cardId: 1 })]),
        section('Maybeboard', [card(1, 'Bolt', { cardId: 2 })]),
      ],
      [section('Main', [card(1, 'Island'), card(3, 'Bolt')])],
    )
    expect(saved).toEqual([
      section('Main', [card(1, 'Island', { cardId: 1 }), card(3, 'Bolt', { cardId: 2 })]),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a move plus a decrease on the board it leaves', () => {
    const { saved, replayed } = pullAndReplay(
      [
        section('Main', [card(1, 'Island', { cardId: 1 })]),
        section('Maybeboard', [card(3, 'Bolt', { cardId: 3 })]),
      ],
      [section('Main', [card(1, 'Island'), card(1, 'Bolt')])],
    )
    expect(saved).toEqual([
      section('Main', [card(1, 'Island', { cardId: 1 }), card(1, 'Bolt', { cardId: 3 })]),
    ])
    expect(replayed).toEqual(saved)
  })

  test('a move after a printing update', () => {
    const { saved, replayed } = pullAndReplay(
      [section('Main', [card(2, 'Sol Ring', { ...C21, cardId: 4 })])],
      [
        section('Main', [card(1, 'Sol Ring', LTC)]),
        section('Sideboard', [card(1, 'Sol Ring', LTC)]),
      ],
      true,
    )
    expect(saved).toEqual([
      section('Main', [card(1, 'Sol Ring', { ...LTC, cardId: 4 })]),
      section('Sideboard', [card(1, 'Sol Ring', { ...LTC, cardId: 1 })]),
    ])
    expect(replayed).toEqual(saved)
  })
})

// ── Push ──────────────────────────────────────────────────────────────

const DEFINITIONS: ArchidektCategory[] = [
  { id: 1, name: 'Commander', isPremier: true, includedInDeck: true },
  { id: 2, name: 'Considering', isPremier: false, includedInDeck: false },
]

type PlanOptions = { withPrintings?: boolean; only?: SyncChangeFilter }

/** Plan a push of `local` over a synthetic deck holding `remote`, diffed as the engine does. */
async function plan(
  remote: RelationSpec[],
  local: DeckSection[],
  options: PlanOptions = {},
): Promise<UploadPlan> {
  const raw = archidektDeck(remote, DEFINITIONS)
  const { diff } = filterDeckDiff(
    diffDeckCards(archidektDeckSections(raw), local, { withPrintings: options.withPrintings }),
    options.only,
  )
  return buildUploadPlan(diff, local, raw, searchingClient('Removal'), 'token')
}

/** A plan's errors as the English text the report carries. */
function messagesOf(plan: UploadPlan): string[] {
  return plan.errors.map((error) => error.message)
}

/** Plan a hand-written diff over a synthetic deck, for the planner's own error paths. */
async function planDiff(remote: RelationSpec[], diff: DeckDiff): Promise<UploadPlan> {
  const raw = archidektDeck(remote, DEFINITIONS)
  return buildUploadPlan(diff, [], raw, searchingClient('Removal'), 'token')
}

describe('buildUploadPlan board moves', () => {
  test('a move re-boards the existing relation, keeping its id, label, printing and roles', async () => {
    const result = await plan(
      [
        {
          id: 1,
          name: 'Bolt',
          categories: ['Ramp'],
          modifier: 'Foil',
          options: ['Normal', 'Foil'],
          label: 'Proxy,#ff0000',
        },
      ],
      [section('Sideboard', [card(1, 'Bolt')])],
    )
    expect(result.entries).toEqual([
      {
        action: 'modify',
        deckRelationId: 1,
        cardid: relationCardId(1),
        customCardId: null,
        categories: ['Sideboard', 'Ramp'],
        patchId: 'ritual-1',
        modifications: {
          quantity: 1,
          modifier: 'Foil',
          label: 'Proxy,#ff0000',
          customCmc: null,
          companion: false,
          flippedDefault: false,
        },
      },
    ])
  })

  test('a move to the main board strips the board category', async () => {
    const result = await plan(
      [{ id: 1, name: 'Bolt', categories: ['Commander', 'Ramp'] }],
      [section('Main', [card(1, 'Bolt')])],
    )
    expect(result.entries).toMatchObject([{ deckRelationId: 1, categories: ['Ramp'] }])
  })

  test('a move to the main board with no category left takes the card’s default', async () => {
    const raw = archidektDeck([{ id: 1, name: 'Bolt', categories: ['Considering'] }], DEFINITIONS)
    raw.cards[0]!.card.oracleCard.defaultCategory = 'Removal'
    const local = [section('Main', [card(1, 'Bolt')])]
    const result = await buildUploadPlan(
      diffDeckCards(archidektDeckSections(raw), local),
      local,
      raw,
      searchingClient('Removal'),
      'token',
    )
    expect(result.entries).toMatchObject([{ deckRelationId: 1, categories: ['Removal'] }])
  })

  test('a move to the maybeboard reuses the deck’s excluded category', async () => {
    const result = await plan(
      [{ id: 1, name: 'Bolt', categories: [] }],
      [section('Maybeboard', [card(1, 'Bolt')])],
    )
    expect(result.entries).toMatchObject([{ deckRelationId: 1, categories: ['Considering'] }])
  })

  test('a partial move splits the relation, the new one carrying its printing and roles', async () => {
    const result = await plan(
      [
        {
          id: 1,
          name: 'Island',
          quantity: 3,
          categories: ['Land'],
          modifier: 'Foil',
          options: ['Normal', 'Foil'],
          label: 'Proxy,#ff0000',
        },
      ],
      [section('Main', [card(2, 'Island')]), section('Sideboard', [card(1, 'Island')])],
    )
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, categories: ['Land'], modifications: { quantity: 2 } },
      {
        action: 'add',
        cardid: relationCardId(1),
        categories: ['Sideboard', 'Land'],
        modifications: { quantity: 1, modifier: 'Foil', label: 'Proxy,#ff0000' },
      },
    ])
    expect(result.entries[1]).not.toHaveProperty('deckRelationId')
  })

  test('a move takes whole relations from the last one first', async () => {
    const result = await plan(
      [
        { id: 1, name: 'Bolt', categories: ['Considering'] },
        { id: 2, name: 'Bolt', categories: ['Considering'] },
      ],
      [section('Main', [card(1, 'Bolt')]), section('Maybeboard', [card(1, 'Bolt')])],
    )
    expect(result.entries).toMatchObject([{ action: 'modify', deckRelationId: 2, categories: [] }])
  })

  test('copies removed beside a move go first, and the move re-boards what is left', async () => {
    const result = await plan(
      [
        { id: 1, name: 'Bolt', categories: ['Considering'] },
        { id: 2, name: 'Bolt', categories: ['Considering'] },
      ],
      [section('Main', [card(1, 'Bolt')])],
    )
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, categories: [] },
      { action: 'remove', deckRelationId: 2 },
    ])
  })

  test('copies added beside a move grow the re-boarded relation, in one entry', async () => {
    const result = await plan(
      [{ id: 1, name: 'Bolt', categories: ['Considering'] }],
      [section('Main', [card(3, 'Bolt')])],
    )
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, categories: [], modifications: { quantity: 3 } },
    ])
  })

  test('copies already on the target board are a quantity transfer, not a second relation', async () => {
    const result = await plan(
      [
        { id: 1, name: 'Bolt', categories: [] },
        { id: 2, name: 'Bolt', categories: ['Considering'] },
      ],
      [section('Main', [card(2, 'Bolt')])],
    )
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, modifications: { quantity: 2 } },
      { action: 'remove', deckRelationId: 2 },
    ])
  })

  test('a copy the local file no longer holds on one board removes only that board’s relation', async () => {
    const result = await plan(
      [
        { id: 1, name: 'Bolt', categories: [] },
        { id: 2, name: 'Bolt', categories: ['Considering'] },
      ],
      [section('Main', [card(1, 'Bolt')])],
    )
    expect(result.entries).toMatchObject([{ action: 'remove', deckRelationId: 2 }])
  })

  test('--only additions still moves, leaving the losing board’s other copies', async () => {
    const result = await plan(
      [{ id: 1, name: 'Bolt', quantity: 3, categories: ['Considering'] }],
      [section('Main', [card(1, 'Bolt')])],
      { only: 'additions' },
    )
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, modifications: { quantity: 2 } },
      { action: 'add', categories: [], modifications: { quantity: 1 } },
    ])
  })

  test('a printing-keyed move re-boards the relation holding that printing', async () => {
    const result = await plan(
      [{ id: 1, name: 'Bolt', categories: [] }],
      [section('Sideboard', [card(1, 'Bolt', { set: 'tst', collectorNumber: '1' })])],
      { withPrintings: true },
    )
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, categories: ['Sideboard'] },
    ])
  })

  test('a second gaining line at a landed printing is a new relation, not a second move', async () => {
    const result = await plan(
      [{ id: 1, name: 'Bolt', quantity: 3, categories: ['Sideboard'] }],
      [section('Main', [card(1, 'Bolt', { set: 'tst', collectorNumber: '1' }), card(3, 'Bolt')])],
      { withPrintings: true },
    )
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, categories: [], modifications: { quantity: 1 } },
      { action: 'add', cardid: 900, categories: ['Removal'], modifications: { quantity: 3 } },
    ])
  })

  test('copies from two boards into one: one relation re-boarded, the other removed', async () => {
    const result = await plan(
      [
        { id: 1, name: 'Bolt', collectorNumber: '1', categories: ['Sideboard'] },
        { id: 2, name: 'Bolt', collectorNumber: '1', categories: ['Considering'] },
      ],
      [section('Main', [card(2, 'Bolt', { set: 'tst', collectorNumber: '1' })])],
      { withPrintings: true },
    )
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, categories: [], modifications: { quantity: 2 } },
      { action: 'remove', deckRelationId: 2 },
    ])
  })

  test('a finish-only and a bare line satisfied by one printing: one moves, one is added', async () => {
    const result = await plan(
      [
        {
          id: 1,
          name: 'Bolt',
          categories: ['Sideboard'],
          modifier: 'Foil',
          options: ['Normal', 'Foil'],
        },
      ],
      [section('Main', [card(1, 'Bolt', { finish: 'foil' }), card(1, 'Bolt')])],
      { withPrintings: true },
    )
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, categories: [], modifications: { modifier: 'Foil' } },
      { action: 'add', cardid: 900, modifications: { quantity: 1, modifier: 'Normal' } },
    ])
  })

  test('a new card lands on its local board rather than Archidekt’s default category', async () => {
    const result = await plan(
      [],
      [section('Main', [card(1, 'Swords')]), section('Sideboard', [card(1, 'Counterspell')])],
    )
    expect(result.entries.map((entry) => entry.categories)).toEqual([['Removal'], ['Sideboard']])
  })

  test('a move the remote cannot cover is a plan error', async () => {
    expect(messagesOf(await planDiff([], boltMove(1)))).toEqual([
      'Cannot change the board of Bolt: the Archidekt deck does not hold it',
    ])
    expect(
      messagesOf(await planDiff([{ id: 1, name: 'Bolt', categories: [] }], boltMove(3))),
    ).toEqual([
      'Cannot change the board for 2 copies of Bolt: the Archidekt Main board does not hold them',
    ])
  })
})

describe('buildUploadPlan entries for a card the remote lacks', () => {
  /** A diff with nothing in it, the base every case below adds one entry to. */
  const EMPTY_DIFF: DeckDiff = {
    byPrinting: false,
    added: [],
    removed: [],
    quantityChanged: [],
    printingUpdates: [],
    unaligned: [],
    boardMoves: [],
  }

  /** A diff carrying only what `extra` adds. */
  function diffWith(extra: Partial<DeckDiff>): DeckDiff {
    return { ...EMPTY_DIFF, ...extra }
  }

  const cases: [action: string, diff: DeckDiff, error: string][] = [
    [
      'remove',
      diffWith({ removed: [{ name: 'Bolt', totalQuantity: 1, board: 'Main' }] }),
      'Cannot remove Bolt: the Archidekt deck does not hold it',
    ],
    [
      'printing',
      diffWith({
        printingUpdates: [
          {
            name: 'Bolt',
            board: 'Main',
            from: { set: 'lea', collectorNumber: '161' },
            to: { set: '2xm', collectorNumber: '117' },
          },
        ],
      }),
      'Cannot update the printing of Bolt (LEA:161): the Archidekt deck does not hold it',
    ],
    [
      'quantity',
      diffWith({ quantityChanged: [{ name: 'Bolt', oldQty: 3, newQty: 1, board: 'Main' }] }),
      'Cannot update the quantity of Bolt: the Archidekt deck does not hold it',
    ],
  ]

  for (const [action, diff, error] of cases) {
    test(`a ${action} is a plan error naming what it could not do`, async () => {
      expect(messagesOf(await planDiff([], diff))).toEqual([error])
    })
  }
})
