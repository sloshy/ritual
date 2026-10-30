import { describe, expect, test } from 'bun:test'
import type { ChangeEvent, ChangeInput } from '../../src/changes/change-event'
import type { DeckData } from '../../src/list/deck'
import type { CollectionCardEntry, WantedListCardEntry } from '../../src/list/site-data'
import { collectDeckCardIds, collectExistingIds } from '../../src/card/card-id'
import {
  COLLECTION_ID_OPS,
  DECK_ID_OPS,
  ID_LANDING,
  WANTED_ID_OPS,
  replayAssigningIds,
} from '../../src/changes/replay-ids'
import { parseDeckText } from '../../src/importers/text-file'

let seq = 0
function event(change: ChangeInput): ChangeEvent {
  seq += 1
  return { id: `c${seq}`, timestamp: seq, ...change }
}

type AddFields = Partial<Extract<ChangeInput, { action: 'add' }>>

const add = (cardName: string, extra: AddFields = {}): ChangeEvent =>
  event({ ...extra, action: 'add', cardName })

const remove = (cardName: string, cardId: number): ChangeEvent =>
  event({ action: 'remove', cardName, cardId })

const FROM_BINDER = { type: 'collection', name: 'Binder' } as const

/** A copy of Lightning Bolt (LEA:161) arriving to pin a line, as the swap wizard sends it. */
const pin = (cardName: string, ids: { cardId?: number; replacesCardId: number }): ChangeEvent =>
  event({
    action: 'move-to',
    cardName,
    from: FROM_BINDER,
    set: 'lea',
    collectorNumber: '161',
    finish: 'nonfoil',
    ...ids,
  })

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

const deckIds = (data: DeckData): number[] => collectDeckCardIds(data).toSorted((a, b) => a - b)

const isPlaceholder = (id: number): boolean => id < 0

describe('per-list-type id ops', () => {
  test('each list type carries the landing rules of its reducer', () => {
    expect(DECK_ID_OPS).toMatchObject(ID_LANDING.deck)
    expect(DECK_ID_OPS.mergeLine).toBeDefined()
    expect(COLLECTION_ID_OPS).toMatchObject({
      ...ID_LANDING.collection,
      cardIds: collectExistingIds,
    })
    expect(WANTED_ID_OPS).toMatchObject({ ...ID_LANDING.wanted, cardIds: collectExistingIds })
    expect(COLLECTION_ID_OPS.mergeLine).toBeUndefined()
  })
})

describe('replayAssigningIds', () => {
  test('an add after a removal in the same batch takes the id the removal released', () => {
    const result = replayAssigningIds(
      wanted(1, 2, 3),
      [remove('Card 2', 2), add('Sol Ring')],
      WANTED_ID_OPS,
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([2, 2])
    expect(result.data.find((entry) => entry.name === 'Sol Ring')?.cardId).toBe(2)
  })

  test('several id-less adds take the free ids in ascending order', () => {
    const result = replayAssigningIds(
      wanted(1, 3),
      [add('Opt'), add('Ponder'), add('Brainstorm')],
      WANTED_ID_OPS,
    )
    expect(idsOf(result.changes)).toEqual([2, 4, 5])
  })

  test('a client id for a free slot is kept, and an id-less add does not take it', () => {
    // An editor's pool handed out &2; the raw add that precedes it in the batch
    // must not claim the same number.
    const result = replayAssigningIds(
      wanted(1),
      [add('Opt'), add('Ponder', { cardId: 2 })],
      WANTED_ID_OPS,
    )
    expect(idsOf(result.changes)).toEqual([3, 2])
  })

  test('an id a later add names is held back even when a removal earlier in the batch freed it', () => {
    const result = replayAssigningIds(
      wanted(1, 2, 3),
      [remove('Card 3', 3), add('Lightning Bolt'), add('Sol Ring', { cardId: 3 })],
      WANTED_ID_OPS,
    )
    expect(idsOf(result.changes)).toEqual([3, 4, 3])
    expect(collectExistingIds(result.data).toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })

  test('a held-back id is free again once the change naming it has applied', () => {
    const result = replayAssigningIds(
      wanted(1),
      [add('Opt', { cardId: 2 }), remove('Opt', 2), add('Ponder')],
      WANTED_ID_OPS,
    )
    expect(idsOf(result.changes)).toEqual([2, 2, 2])
  })

  test('a move-to without an id lands on the smallest free id', () => {
    const arrival = event({ action: 'move-to', cardName: 'Sol Ring', from: FROM_BINDER })
    const result = replayAssigningIds(wanted(1, 2), [remove('Card 1', 1), arrival], WANTED_ID_OPS)
    expect(idsOf(result.changes)).toEqual([1, 1])
  })

  test('on a flat list, an id naming a line it holds is a collision and gets a free id', () => {
    const result = replayAssigningIds(wanted(1, 2), [add('Sol Ring', { cardId: 1 })], WANTED_ID_OPS)
    expect(idsOf(result.changes)).toEqual([3])
    expect(collectExistingIds(result.data)).toEqual([1, 2, 3])
  })

  test('on a deck, a client id naming a live line is kept and draws nothing', () => {
    const result = replayAssigningIds(
      deck('1 Opt &3\n'),
      [add('Opt', { cardId: 3, section: 'Main' }), add('Ponder', { section: 'Main' })],
      DECK_ID_OPS,
      { listLabels: [] },
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([3, 1])
  })

  test('a client’s free id on a copy that merges is replaced by the line’s id', () => {
    const result = replayAssigningIds(
      deck('1 Opt &3\n'),
      [add('Opt', { cardId: 9, section: 'Main' }), add('Ponder', { section: 'Main' })],
      DECK_ID_OPS,
      { listLabels: [] },
    )
    expect(idsOf(result.changes)).toEqual([3, 1])
    expect(deckIds(result.data)).toEqual([1, 3])
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
      DECK_ID_OPS,
      { listLabels: [] },
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([2, 2, 3, 2])
    expect(deckIds(result.data)).toEqual([1, 2, 3])
  })

  test('a copy merging onto a deck line with no id is stamped with none', () => {
    const base = deck('1 Opt\n')
    expect(collectDeckCardIds(base)).toEqual([])
    const result = replayAssigningIds(
      base,
      [add('Opt', { cardId: -1, section: 'Main' })],
      DECK_ID_OPS,
      { listLabels: [], isProvisional: isPlaceholder },
    )
    expect(idsOf(result.changes)).toEqual([undefined])
    expect(result.resolved.has(-1)).toBe(true)
    expect(result.resolved.get(-1)).toBeUndefined()
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
      DECK_ID_OPS,
      { listLabels: [] },
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([1, 3, 1, 1])
    expect(deckIds(result.data)).toEqual([1, 2, 3])
  })

  test('a placeholder id is resolved, and later changes naming it follow', () => {
    const result = replayAssigningIds(
      wanted(1, 2),
      [
        remove('Card 1', 1),
        add('Sol Ring', { cardId: -1 }),
        event({ action: 'set-note', cardName: 'Sol Ring', cardId: -1, note: 'mine' }),
      ],
      WANTED_ID_OPS,
      { isProvisional: isPlaceholder },
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([1, 1, 1])
    expect(result.resolved.get(-1)).toBe(1)
    expect(result.data.find((entry) => entry.name === 'Sol Ring')?.note).toBe('mine')
  })

  test('a placeholder referenced before its line exists is dropped, so the change falls back to the name', () => {
    const result = replayAssigningIds(
      wanted(1),
      [
        event({ action: 'set-note', cardName: 'Card 1', cardId: -1, note: 'early' }),
        add('Sol Ring', { cardId: -1 }),
      ],
      WANTED_ID_OPS,
      { isProvisional: isPlaceholder },
    )
    expect(result.changes[0]).not.toHaveProperty('cardId')
    expect(result.data[0]?.note).toBe('early')
    expect(idsOf(result.changes.slice(1))).toEqual([2])
  })

  test('a line-creating change that misses resolves nothing, and its id is not spent', () => {
    // The split pin names a line the deck does not hold, so it lands nowhere.
    const result = replayAssigningIds(
      deck('1 Opt &1\n'),
      [
        pin('Lightning Bolt', { cardId: -1, replacesCardId: 99 }),
        event({ action: 'set-note', cardName: 'Opt', cardId: -1, note: 'x' }),
        add('Ponder', { section: 'Main' }),
      ],
      DECK_ID_OPS,
      { listLabels: [], isProvisional: isPlaceholder },
    )
    expect(result.unmatched.map((item) => item.change.action)).toEqual(['move-to'])
    expect(result.resolved.has(-1)).toBe(false)
    expect(result.changes[1]).not.toHaveProperty('cardId')
    expect(idsOf(result.changes.slice(2))).toEqual([2])
  })

  test('a pin whose replacesCardId is a placeholder is re-aimed at the line the batch created', () => {
    const result = replayAssigningIds(
      deck('1 Opt &1\n'),
      [
        add('Lightning Bolt', { cardId: -1, section: 'Main' }),
        pin('Lightning Bolt', { cardId: -1, replacesCardId: -1 }),
      ],
      DECK_ID_OPS,
      { listLabels: [], isProvisional: isPlaceholder },
    )
    expect(result.unmatched).toEqual([])
    expect(result.changes[1]).toMatchObject({ cardId: 2, replacesCardId: 2 })
    expect(deckIds(result.data)).toEqual([1, 2])
  })

  test('a deck pin converting its line in place draws no id', () => {
    const result = replayAssigningIds(
      deck('1 Lightning Bolt &1\n1 Opt &3\n'),
      [pin('Lightning Bolt', { cardId: 1, replacesCardId: 1 }), add('Ponder', { section: 'Main' })],
      DECK_ID_OPS,
      { listLabels: [] },
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([1, 2])
  })

  test('an id-less deck split pin is left id-less, and the reducer refuses it', () => {
    const result = replayAssigningIds(
      deck('2 Lightning Bolt &1\n'),
      [pin('Lightning Bolt', { replacesCardId: 1 })],
      DECK_ID_OPS,
      { listLabels: [] },
    )
    expect(result.changes[0]).not.toHaveProperty('cardId')
    expect(result.unmatched).toHaveLength(1)
  })

  test('a split pin that takes a line’s last copy frees its id for a later add', () => {
    const result = replayAssigningIds(
      deck('1 Lightning Bolt &1\n1 Opt &2\n'),
      [pin('Lightning Bolt', { cardId: 5, replacesCardId: 1 }), add('Ponder', { section: 'Main' })],
      DECK_ID_OPS,
      { listLabels: [] },
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([5, 1])
    expect(deckIds(result.data)).toEqual([1, 2, 5])
  })

  test('a collection pin converts its entry in place and is logged with that entry’s id', () => {
    const entry: CollectionCardEntry = {
      name: 'Lightning Bolt',
      set: '',
      collectorNumber: '',
      finish: 'nonfoil',
      condition: 'NM',
      price: 0,
      fileOrder: 0,
      section: 'Main',
      cardId: 1,
    }
    const result = replayAssigningIds(
      [entry],
      [pin('Lightning Bolt', { cardId: 7, replacesCardId: 1 }), add('Opt')],
      COLLECTION_ID_OPS,
    )
    expect(result.unmatched).toEqual([])
    expect(idsOf(result.changes)).toEqual([1, 2])
    expect(result.data[0]).toMatchObject({ cardId: 1, set: 'lea', collectorNumber: '161' })
  })
})
