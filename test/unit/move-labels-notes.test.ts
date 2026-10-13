/**
 * A cross-list move carries the copy's payload — tags, note and CARRIED labels
 * (its labels as its source states them, `carriedLabels`) — exactly as `ritual
 * move` does: the destination lands them with `arrivalLabels` (whose rule is
 * pinned in `card-labels.test.ts`) and writes the minimal override against its
 * own default; the note lands unless a deck quantity-merge keeps the line's own.
 *
 * Engine semantics only — the payload projection and validator, the reducers
 * every surface replays a `move-to` through, and the persisted changelog form.
 * The on-disk move paths are pinned in `test/integration/move-save.test.ts`.
 */

import { A_CHANGE, MOVE_1, accepted, outcome } from '../helpers/change-problem'
import { describe, expect, test } from 'bun:test'
import {
  createMoveFromChange,
  createMoveToChange,
  mirrorMoveFrom,
  mirrorMoveTo,
  movedCopyOf,
  type ListRef,
} from '../../src/changes/change-event'
import {
  applyChangeToDeck,
  droppedMoveNote,
  findDeckAddMergeTargetId,
  type MoveToInput,
} from '../../src/changes/deck-changes'
import { applyChangeToCollection } from '../../src/changes/collection-changes'
import { applyChangeToWantedList } from '../../src/changes/wanted-changes'
import {
  decodeChangeEvent,
  encodeChangeEvent,
  validateMovedCopyFields,
} from '../../src/changes/change-event-decode'
import { parseChangelog } from '../../src/changes/changelog-parser'
import type { LabelOverride } from '../../src/card/card-labels'
import type { DeckData } from '../../src/list/deck'

const BINDER: ListRef = { type: 'collection', name: 'Binder' }
const MY_DECK: ListRef = { type: 'deck', name: 'My Deck' }

/** A copy of Sol Ring (C19:221) arriving from the binder, carrying `labels` and a note. */
function arriving(
  labels: LabelOverride | undefined,
  note?: string,
  from: ListRef = BINDER,
): MoveToInput {
  return {
    action: 'move-to',
    cardName: 'Sol Ring',
    set: 'c19',
    collectorNumber: '221',
    labels,
    note,
    cardId: 7,
    from,
  }
}

/** A deck holding one Sol Ring (C19:221) line with `note` and `labels`, plus an unrelated line. */
function deckWith(note?: string, labels?: LabelOverride): DeckData {
  return {
    name: 'My Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          {
            quantity: 1,
            name: 'Sol Ring',
            set: 'c19',
            collectorNumber: '221',
            labels,
            note,
            cardId: 1,
          },
          { quantity: 1, name: 'Island', cardId: 2 },
        ],
      },
    ],
  }
}

const EMPTY_DECK: DeckData = { name: 'My Deck', sections: [{ name: 'Main', cards: [] }] }

/** A deck with no front-matter default labels. */
const NONE = { listLabels: undefined }

describe('the reducers land a move-to through arrivalLabels', () => {
  test('a real card from a deck keeps being real in a proxy-default collection', () => {
    const [entry] = applyChangeToCollection([], arriving(undefined, undefined, MY_DECK), {
      listLabels: ['proxy'],
    })
    expect(entry?.labels).toEqual(['no-proxy'])
  })

  test('a deck measures the source’s stated labels against its own default', () => {
    // From a collection, a carried sale/trade means nothing in a deck, and
    // `proxy` (unset there) is a fact the deck keeps.
    const fromBinder = applyChangeToDeck(EMPTY_DECK, arriving(['sale', 'trade']), {
      listLabels: ['proxy'],
    })
    expect(fromBinder.sections[0]!.cards[0]!.labels).toEqual(['no-proxy'])
  })

  test('carried labels land as the minimal override, not as carried', () => {
    // `[sale,trade]` arriving in a `sale` binder needs only `[trade]`.
    const [entry] = applyChangeToCollection([], arriving(['sale', 'trade']), {
      listLabels: ['sale'],
    })
    expect(entry?.labels).toEqual(['trade'])
  })
})

describe('movedCopyOf', () => {
  test('canonicalizes the payload and folds empty values to absent', () => {
    expect(
      movedCopyOf({ tags: ['Ramp', ' Card  Draw '], labels: ['trade', 'sale'], note: 'x' }),
    ).toEqual({ tags: ['Card Draw', 'Ramp'], labels: ['sale', 'trade'], note: 'x' })
    const empty = movedCopyOf({ tags: [], labels: [], note: '' })
    expect(empty.tags).toBeUndefined()
    expect(empty.labels).toBeUndefined()
    expect(empty.note).toBeUndefined()
  })

  test('gives two orderings of one copy the same serialized event', () => {
    const a = createMoveFromChange('Sol Ring', { labels: ['trade', 'sale'], to: MY_DECK })
    const b = createMoveFromChange('Sol Ring', { labels: ['sale', 'trade'], to: MY_DECK })
    expect(encodeChangeEvent(a)).toBe(encodeChangeEvent(b))
  })
})

describe('validateMovedCopyFields', () => {
  test('returns the payload in its stored form', () => {
    expect(
      validateMovedCopyFields({ tags: ['Ramp'], labels: ['TRADE', 'sale'], note: 'mint' }, MOVE_1),
    ).toEqual({ ok: true, value: { tags: ['Ramp'], labels: ['sale', 'trade'], note: 'mint' } })
  })

  test.each<[string, Record<string, unknown>, string]>([
    [
      'an unknown label',
      { labels: ['gift'] },
      `Move #1: Invalid "labels" 'gift'. Use one of: sale, trade, keep, proxy, no-sale, no-trade, no-keep, no-proxy.`,
    ],
    [
      'a labels value that is not an array',
      { labels: 'sale' },
      'Move #1: "labels" must be an array of labels (sale, trade, keep, proxy, no-sale, no-trade, no-keep, no-proxy).',
    ],
    [
      'an exclusive label combination',
      { labels: ['keep', 'sale'] },
      "Move #1: 'keep' cannot be combined with other labels.",
    ],
    [
      'a tags value that is not an array',
      { tags: 'Ramp' },
      'Move #1: "tags" must be an array of tags.',
    ],
    ['a non-string note', { note: 3 }, 'Move #1 has an invalid "note".'],
  ])('refuses %s', (_, fields, message) => {
    expect(outcome(validateMovedCopyFields(fields, MOVE_1))).toBe(message)
  })
})

describe('a move-to landing on a deck', () => {
  test('a proxy keeps its label and note on the line it starts', () => {
    const deck = applyChangeToDeck(EMPTY_DECK, arriving(['proxy'], 'printed at home'), {
      listLabels: undefined,
    })
    expect(deck.sections[0]!.cards).toEqual([
      {
        quantity: 1,
        name: 'Sol Ring',
        set: 'c19',
        collectorNumber: '221',
        labels: ['proxy'],
        note: 'printed at home',
        cardId: 7,
      },
    ])
  })

  test('a proxy arriving in a proxy-default deck inherits it rather than restating it', () => {
    const deck = applyChangeToDeck(EMPTY_DECK, arriving(['proxy']), { listLabels: ['proxy'] })
    expect(deck.sections[0]!.cards[0]!.labels).toBeUndefined()
  })

  test('a sale/trade copy keeps no labels, so it merges onto the plain line', () => {
    const deck = applyChangeToDeck(deckWith(), arriving(['sale', 'trade']), {
      listLabels: undefined,
    })
    const solRing = deck.sections[0]!.cards[0]!
    expect(solRing).toMatchObject({ quantity: 2, cardId: 1 })
    expect(solRing.labels).toBeUndefined()
  })

  test('the merge-target probe uses the same filtered, default-measured labels', () => {
    // A proxy arriving in a proxy-default deck writes no override, so it folds
    // onto the deck's override-less line — the probe must agree with the reducer.
    expect(
      findDeckAddMergeTargetId(deckWith(), arriving(['proxy']), { listLabels: ['proxy'] }),
    ).toBe(1)
    expect(findDeckAddMergeTargetId(deckWith(), arriving(['proxy']), NONE)).toBeUndefined()
  })

  test('a quantity merge keeps the line’s own note, and droppedMoveNote reports the copy’s', () => {
    const before = deckWith('keep me')
    const change = arriving(undefined, 'incoming')
    expect(droppedMoveNote(before, change, NONE)).toBe('incoming')
    const after = applyChangeToDeck(before, change, { listLabels: undefined })
    expect(after.sections[0]!.cards[0]).toMatchObject({ quantity: 2, note: 'keep me' })
  })

  test('droppedMoveNote finds the landing line by the event’s cardId first, as the reducer does', () => {
    // &2 (Island) is named by id, so the copy lands there — not on the Sol Ring
    // line the merge rule would pick — and Island's (absent) note is what wins.
    const change: MoveToInput = { ...arriving(undefined, 'incoming'), cardId: 2 }
    expect(droppedMoveNote(deckWith('incoming'), change, NONE)).toBe('incoming')
  })

  test.each<[string, DeckData, MoveToInput]>([
    ['a fresh line', EMPTY_DECK, arriving(undefined, 'travels')],
    ['a line with the same note', deckWith('same'), arriving(undefined, 'same')],
    ['a copy with no note', deckWith('keep me'), arriving(undefined)],
    // A proxy copy does not merge onto the real line, so its note travels.
    ['a proxy copy beside a real line', deckWith('keep me'), arriving(['proxy'], 'mine')],
    // A pinning move fills a line this deck holds and applies no note at all.
    [
      'a pinning move',
      deckWith('keep me'),
      { ...arriving(undefined, 'mine'), cardId: 1, replacesCardId: 1 },
    ],
  ])('droppedMoveNote reports nothing for %s', (_, deck, change) => {
    expect(droppedMoveNote(deck, change, NONE)).toBeUndefined()
  })
})

describe('a move-to landing on a deck: default labels and merge scope', () => {
  test('a proxy arriving in a proxy-default deck merges onto its override-less line', () => {
    // What the editors must replay too: landing it as a `[proxy] &7` line of
    // its own would leave a phantom &7 in the baseline the save adopts.
    const deck = applyChangeToDeck(deckWith(), arriving(['proxy']), { listLabels: ['proxy'] })
    expect(deck.sections[0]!.cards.map((c) => [c.cardId, c.quantity, c.labels])).toEqual([
      [1, 2, undefined],
      [2, 1, undefined],
    ])
  })

  test('a line with a redundant override still absorbs a copy with the same effective labels', () => {
    // `[proxy]` on a line of a proxy-default deck says nothing the default does
    // not; the merge compares effective labels, not raw overrides.
    const deck = applyChangeToDeck(deckWith(undefined, ['proxy']), arriving(['proxy']), {
      listLabels: ['proxy'],
    })
    expect(deck.sections[0]!.cards[0]).toMatchObject({ cardId: 1, quantity: 2 })
    expect(
      findDeckAddMergeTargetId(deckWith(undefined, ['proxy']), arriving(['proxy']), {
        listLabels: ['proxy'],
      }),
    ).toBe(1)
  })

  test('a move-to naming a section merges within that section only', () => {
    const withSideboard: DeckData = {
      ...deckWith('main note'),
      sections: [...deckWith('main note').sections, { name: 'Sideboard', cards: [] }],
    }
    const change: MoveToInput = { ...arriving(undefined, 'sb note'), section: 'Sideboard' }
    // The Main line is the same copy, but the move names the Sideboard: a new
    // line there, so no note is lost and the probe names no line.
    expect(droppedMoveNote(withSideboard, change, NONE)).toBeUndefined()
    expect(findDeckAddMergeTargetId(withSideboard, change, NONE)).toBeUndefined()
    const after = applyChangeToDeck(withSideboard, change, { listLabels: undefined })
    expect(after.sections.map((section) => section.cards.map((c) => c.quantity))).toEqual([
      [1, 1],
      [1],
    ])
  })

  test('a move-to naming no section merges onto its line in any section', () => {
    const inSideboard: DeckData = {
      name: 'My Deck',
      sections: [
        { name: 'Main', cards: [] },
        {
          name: 'Sideboard',
          cards: [{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
        },
      ],
    }
    const after = applyChangeToDeck(inSideboard, arriving(undefined), { listLabels: undefined })
    expect(after.sections[1]!.cards[0]!.quantity).toBe(2)
  })
})

describe('a move-to landing on a flat list', () => {
  test('a collection keeps every label and the note', () => {
    const [entry] = applyChangeToCollection([], arriving(['trade', 'sale'], 'binder page 3'))
    expect(entry).toMatchObject({ labels: ['sale', 'trade'], note: 'binder page 3', cardId: 7 })
  })

  test('a collection whose default equals the carried labels writes no override', () => {
    const [entry] = applyChangeToCollection([], arriving(['sale']), { listLabels: ['sale'] })
    expect(entry?.labels).toBeUndefined()
  })

  test('a wanted list keeps the note but no labels', () => {
    const [entry] = applyChangeToWantedList([], arriving(['proxy'], 'for the cube'))
    expect(entry).toMatchObject({ note: 'for the cube', cardId: 7 })
    expect(entry && 'labels' in entry ? entry.labels : undefined).toBeUndefined()
  })

  test('an empty note lands as no note', () => {
    const [entry] = applyChangeToCollection([], arriving(undefined, ''))
    expect(entry?.note).toBeUndefined()
  })
})

describe('move event builders', () => {
  test('the two mirrors carry the departing line’s payload across', () => {
    const departing = mirrorMoveFrom(
      { name: 'Sol Ring', labels: ['sale'], note: 'mint', tags: ['Ramp'], cardId: 3 },
      MY_DECK,
    )
    expect(departing).toMatchObject({ action: 'move-from', labels: ['sale'], note: 'mint' })
    expect(mirrorMoveTo(departing, BINDER, 9)).toMatchObject({
      action: 'move-to',
      tags: ['Ramp'],
      labels: ['sale'],
      note: 'mint',
      cardId: 9,
      sourceCardId: 3,
    })
  })

  test('an empty override or note is stored as absent', () => {
    const event = createMoveToChange('Sol Ring', { labels: [], note: '', from: BINDER })
    expect(event.labels).toBeUndefined()
    expect(event.note).toBeUndefined()
  })
})

describe('decodeChangeEvent on a move’s payload', () => {
  const raw = (action: 'move-from' | 'move-to', fields: Record<string, unknown>): unknown => ({
    id: 'x',
    timestamp: 1,
    action,
    cardName: 'Sol Ring',
    from: BINDER,
    to: MY_DECK,
    ...fields,
  })

  test.each(['move-from', 'move-to'] as const)(
    '%s keeps a valid payload (normalized), whatever the list type',
    (action) => {
      // A `sale` copy moving into a deck is expected: the deck filters on arrival.
      expect(
        outcome(
          decodeChangeEvent(raw(action, { labels: ['TRADE', 'sale'], note: 'mint' }), A_CHANGE, {
            listType: 'deck',
          }),
        ),
      ).toMatchObject({ labels: ['sale', 'trade'], note: 'mint' })
    },
  )

  test('folds an empty override and an empty note to absent', () => {
    const decoded = accepted(decodeChangeEvent(raw('move-to', { labels: [], note: '' }), A_CHANGE))
    if (decoded.action !== 'move-to') throw new Error('expected a move-to')
    expect(decoded.labels).toBeUndefined()
    expect(decoded.note).toBeUndefined()
  })

  const refusals: [string, Record<string, unknown>, string][] = [
    [
      'an unknown label',
      { labels: ['gift'] },
      `The change: Invalid "labels" 'gift'. Use one of: sale, trade, keep, proxy, no-sale, no-trade, no-keep, no-proxy.`,
    ],
    [
      'a labels value that is not an array',
      { labels: 'sale' },
      'The change: "labels" must be an array of labels (sale, trade, keep, proxy, no-sale, no-trade, no-keep, no-proxy).',
    ],
    [
      'an exclusive label combination',
      { labels: ['keep', 'sale'] },
      "The change: 'keep' cannot be combined with other labels.",
    ],
    ['a non-string note', { note: 3 }, 'The change has an invalid "note".'],
    ['a note with a line break', { note: 'a\nb' }, 'The change has a line break in "change.note".'],
  ]
  test.each(
    (['move-from', 'move-to'] as const).flatMap((action) =>
      refusals.map(([what, fields, message]) => [action, what, fields, message] as const),
    ),
  )('%s refuses %s', (action, _, fields, message) => {
    expect(outcome(decodeChangeEvent(raw(action, fields), A_CHANGE))).toBe(message)
  })
})

describe('a persisted move line written before moves carried labels and notes', () => {
  test('still parses, as a move with neither', () => {
    const content = [
      '# Changelog for Binder',
      '',
      '## 2026-09-01T00:00:00.000Z',
      '',
      '- Moved "Sol Ring" (C19:221) to Deck \'My Deck\' &3',
      '',
      '```ritual-changes',
      '{"action":"move-from","cardName":"Sol Ring","cardId":3,"set":"c19","collectorNumber":"221","to":{"type":"deck","name":"My Deck"}}',
      '```',
      '',
    ].join('\n')
    const { pages, advisories } = parseChangelog(content)
    expect(advisories).toEqual([])
    const [event] = pages[0]!.changes
    if (event?.action !== 'move-from') throw new Error('expected a move-from')
    expect(event).toMatchObject({ cardName: 'Sol Ring', cardId: 3 })
    expect(event.labels).toBeUndefined()
    expect(event.note).toBeUndefined()
  })
})
