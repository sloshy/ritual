import { describe, test, expect } from 'bun:test'
import { decodeChangeEvent, pickPersistedFields } from '../../src/changes/change-event-decode'
import { A_CHANGE, accepted, outcome } from '../helpers/change-problem'

const add = (fields: Record<string, unknown>): Record<string, unknown> => ({
  id: 'x',
  timestamp: 1,
  action: 'add',
  cardName: 'Sol Ring',
  ...fields,
})

// Bundles, changelog blocks, and the history route all decode through here,
// and every string an event carries lands in a card line or changelog prose.
describe('decodeChangeEvent line breaks', () => {
  test('refuses a card name holding a line break', () => {
    expect(
      outcome(decodeChangeEvent(add({ cardName: 'Sol Ring\n- 1 Black Lotus &3' }), A_CHANGE)),
    ).toBe('The change has a line break in "change.cardName".')
  })

  test('refuses a nested list name holding a line break', () => {
    const event = {
      id: 'x',
      timestamp: 1,
      action: 'move-from',
      cardName: 'Sol Ring',
      to: { type: 'deck', name: 'Burn\r## 2020-01-01T00:00:00.000Z' },
    }
    expect(outcome(decodeChangeEvent(event, A_CHANGE))).toBe(
      'The change has a line break in "change.to.name".',
    )
  })

  test('refuses a field no validator lists, since the whole event is walked', () => {
    expect(outcome(decodeChangeEvent(add({ futureField: 'a\u2028b' }), A_CHANGE))).toBe(
      'The change has a line break in "change.futureField".',
    )
  })

  test('keeps an event whose string holds a tab: it cannot forge a line', () => {
    expect(outcome(decodeChangeEvent(add({ cardName: 'Sol\tRing' }), A_CHANGE))).toMatchObject({
      cardName: 'Sol\tRing',
    })
  })
})

/** A `move-to` arriving from a binder, with `fields` merged over it. */
const moveTo = (fields: Record<string, unknown>): Record<string, unknown> => ({
  id: 'x',
  timestamp: 1,
  action: 'move-to',
  cardName: 'Sol Ring',
  cardId: 9,
  from: { type: 'collection', name: 'Binder' },
  ...fields,
})

// The save route decodes every wire event through here, so the rules its
// request normalizers used to hold live on the decoder now.
describe('decodeChangeEvent move replacements', () => {
  test('a replacement with no replacesCardId is refused: there is no line for it to replace', () => {
    expect(
      outcome(
        decodeChangeEvent(
          moveTo({ replacement: { set: 'C19', collectorNumber: '221' } }),
          A_CHANGE,
        ),
      ),
    ).toBe('The change carries a "replacement" but pins no line ("replacesCardId").')
  })

  test('a replacement on a pinning move is kept, its set folded to lowercase', () => {
    expect(
      outcome(
        decodeChangeEvent(
          moveTo({ replacesCardId: 4, replacement: { set: 'C19', collectorNumber: '221' } }),
          A_CHANGE,
        ),
      ),
    ).toMatchObject({ replacesCardId: 4, replacement: { set: 'c19', collectorNumber: '221' } })
  })
})

describe('decodeChangeEvent languages', () => {
  test('an optional language is folded to lowercase where present and stays absent where not', () => {
    expect(outcome(decodeChangeEvent(add({ language: 'JA' }), A_CHANGE))).toMatchObject({
      language: 'ja',
    })
    expect(accepted(decodeChangeEvent(add({}), A_CHANGE))).not.toHaveProperty('language')
  })

  test('an unknown language is refused on an action where the field is optional', () => {
    expect(outcome(decodeChangeEvent(add({ language: 'klingon' }), A_CHANGE))).toBe(
      'The change has an unknown language: "klingon".',
    )
  })
})

// An `&N` is a positive integer; anything else would write a token the line
// reader cannot read back, turning the list unreadable on its next load.
describe('decodeChangeEvent card ids', () => {
  const badIds: unknown[] = [0, -1, 1.5, '3']

  test.each(badIds)('refuses %p as a cardId', (id) => {
    expect(outcome(decodeChangeEvent(add({ cardId: id }), A_CHANGE))).toBe(
      'The change has an invalid "cardId".',
    )
  })

  test.each(badIds)("refuses %p as a move-to's sourceCardId or replacesCardId", (id) => {
    expect(outcome(decodeChangeEvent(moveTo({ sourceCardId: id }), A_CHANGE))).toBe(
      'The change has an invalid "sourceCardId".',
    )
    expect(outcome(decodeChangeEvent(moveTo({ replacesCardId: id }), A_CHANGE))).toBe(
      'The change has an invalid "replacesCardId".',
    )
  })

  test('keeps positive integer ids', () => {
    expect(
      outcome(decodeChangeEvent(moveTo({ sourceCardId: 2, replacesCardId: 5 }), A_CHANGE)),
    ).toMatchObject({
      cardId: 9,
      sourceCardId: 2,
      replacesCardId: 5,
    })
  })
})

describe('pickPersistedFields', () => {
  test('keeps the persisted keys and drops the envelope and anything undeclared', () => {
    expect(
      pickPersistedFields({
        id: 'x',
        timestamp: 1,
        action: 'move-to',
        cardName: 'Sol Ring',
        cardId: 9,
        from: { type: 'collection', name: 'Binder' },
        fileOrder: ['Sol Ring'],
      }),
    ).toEqual({
      action: 'move-to',
      cardName: 'Sol Ring',
      cardId: 9,
      from: { type: 'collection', name: 'Binder' },
    })
  })
})
