import { describe, expect, test } from 'bun:test'
import type { ChangeEvent, ChangeInput } from '../../src/changes/change-event'
import type { DeckData } from '../../src/list/deck'
import type { WantedListCardEntry } from '../../src/list/site-data'
import { collectDeckCardIds, collectExistingIds } from '../../src/card/card-id'
import { applyChangeToDeck } from '../../src/changes/deck-changes'
import { applyChangeToWantedList } from '../../src/changes/wanted-changes'
import { deckMergeLine, replayAssigningIds, type IdReplayOps } from '../../src/changes/replay-ids'
import { parseDeckText } from '../../src/importers/text-file'

const WANTED_OPS: IdReplayOps<WantedListCardEntry[]> = {
  apply: applyChangeToWantedList,
  cardIds: collectExistingIds,
}

const DECK_OPS: IdReplayOps<DeckData> = {
  apply: (deck, change, options) =>
    applyChangeToDeck(deck, change, { ...options, listLabels: options?.listLabels }),
  cardIds: collectDeckCardIds,
  mergeLine: deckMergeLine,
}

let seq = 0
function event(change: ChangeInput): ChangeEvent {
  seq += 1
  return { id: `c${seq}`, timestamp: seq, ...change }
}

const add = (cardName: string, extra: Partial<ChangeEvent> = {}): ChangeEvent =>
  event({ action: 'add', cardName, ...extra } as ChangeInput)

const remove = (cardName: string, cardId: number): ChangeEvent =>
  event({ action: 'remove', cardName, cardId })

/** The `&N` each replayed change carries. */
const idsOf = (changes: readonly ChangeEvent[]): (number | undefined)[] =>
  changes.map((change) => ('cardId' in change ? change.cardId : undefined))

const wanted = (...ids: number[]): WantedListCardEntry[] =>
  ids.map((cardId, fileOrder) => ({
    name: `Card ${cardId}`,
    cardId,
    price: 0,
    fileOrder,
    section: 'Main',
    state: 'name-only',
  }))

const deck = (body: string): DeckData => parseDeckText(`# Test\n\n## Main\n${body}`, 'Test').deck

describe('replayAssigningIds', () => {
  test('an add after a removal in the same batch takes the id the removal released', () => {
    const result = replayAssigningIds(
      wanted(1, 2, 3),
      [remove('Card 2', 2), add('Sol Ring')],
      WANTED_OPS,
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([2, 2])
    expect(result.data.find((entry) => entry.name === 'Sol Ring')?.cardId).toBe(2)
  })

  test('several id-less adds take the free ids in ascending order', () => {
    const result = replayAssigningIds(
      wanted(1, 3),
      [add('Opt'), add('Ponder'), add('Brainstorm')],
      WANTED_OPS,
    )
    expect(idsOf(result.changes)).toEqual([2, 4, 5])
  })

  test('a client id for a free slot is kept, and an id-less add does not take it', () => {
    // An editor's pool handed out &2; the raw add that precedes it in the batch
    // must not claim the same number.
    const result = replayAssigningIds(
      wanted(1),
      [add('Opt'), add('Ponder', { cardId: 2 })],
      WANTED_OPS,
    )
    expect(idsOf(result.changes)).toEqual([3, 2])
  })

  test('a move-to without an id lands on the smallest free id', () => {
    const arrival = event({
      action: 'move-to',
      cardName: 'Sol Ring',
      from: { type: 'collection', name: 'Binder' },
    })
    const result = replayAssigningIds(wanted(1, 2), [remove('Card 1', 1), arrival], WANTED_OPS)
    expect(idsOf(result.changes)).toEqual([1, 1])
  })

  test('a deck copy that merges onto a line takes its id and draws none', () => {
    const result = replayAssigningIds(
      deck('1 Lightning Bolt &1\n2 Counterspell &2\n1 Opt &3\n'),
      [
        remove('Counterspell', 2),
        remove('Counterspell', 2),
        // Folds onto the Opt line: no new line, so no id drawn.
        add('Opt', { section: 'Main' }),
        add('Ponder', { section: 'Main' }),
      ],
      DECK_OPS,
      { listLabels: [] },
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([2, 2, 3, 2])
    expect(collectDeckCardIds(result.data).toSorted((a, b) => a - b)).toEqual([1, 2, 3])
  })

  test('a deck decrement releases its id only when the last copy goes', () => {
    const result = replayAssigningIds(
      deck('2 Sol Ring &1\n1 Opt &2\n'),
      [
        remove('Sol Ring', 1),
        add('Ponder', { section: 'Main' }),
        remove('Sol Ring', 1),
        add('Brainstorm', { section: 'Main' }),
      ],
      DECK_OPS,
      { listLabels: [] },
    )
    expect(idsOf(result.changes)).toEqual([1, 3, 1, 1])
  })

  test('a placeholder id is resolved, and later changes naming it follow', () => {
    const result = replayAssigningIds(
      wanted(1, 2),
      [
        remove('Card 1', 1),
        add('Sol Ring', { cardId: -1 }),
        event({ action: 'set-note', cardName: 'Sol Ring', cardId: -1, note: 'mine' }),
      ],
      WANTED_OPS,
      { isProvisional: (id) => id < 0 },
    )
    expect(idsOf(result.changes)).toEqual([1, 1, 1])
    expect(result.resolved.get(-1)).toBe(1)
  })
})
