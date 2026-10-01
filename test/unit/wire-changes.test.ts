import { describe, expect, test } from 'bun:test'
import type { ChangeEvent } from '../../src/changes/change-event'
import {
  decodeWireChanges,
  listSavePath,
  listSaveRequest,
  type WireChange,
  type WireChangesResult,
} from '../../src/changes/wire-changes'
import { MAX_SAVE_CHANGES } from '../../src/changes/save-limits'
import { MAX_EDIT_BODY_SIZE } from '../../src/admin/validation'

const STAMPED_AT = 1_700_000_000_000

/** The stamped events of an accepted batch, failing the test on a refusal. */
function accepted(result: WireChangesResult): ChangeEvent[] {
  if (!result.ok) throw new Error(`expected the batch to decode, got: ${result.error}`)
  return result.changes
}

/** The refusal of a refused batch, failing the test if it decoded. */
function refused(result: WireChangesResult): string {
  if (result.ok) throw new Error('expected a refusal, got decoded changes')
  return result.error
}

/** The cheapest valid wire event: a name-only add. */
const cheapAdd: WireChange = { action: 'add', cardName: 'Sol Ring' }

describe('decodeWireChanges', () => {
  // The cross-list move pairing keys on id and timestamp, so a client's
  // envelope — duplicated ids, timestamps out of order — must never survive.
  test('replaces a client-sent envelope with unique ids and increasing timestamps', () => {
    const changes = accepted(
      decodeWireChanges(
        [
          { ...cheapAdd, id: 'dup', timestamp: 9 },
          { ...cheapAdd, cardName: 'Arcane Signet', id: 'dup', timestamp: 3 },
        ],
        'deck',
        STAMPED_AT,
      ),
    )
    expect(changes).toMatchObject([
      { id: `${STAMPED_AT}-0`, timestamp: STAMPED_AT, cardName: 'Sol Ring' },
      { id: `${STAMPED_AT}-1`, timestamp: STAMPED_AT + 1, cardName: 'Arcane Signet' },
    ])
  })

  test('refuses a changes field that is not an array', () => {
    expect(refused(decodeWireChanges({ 0: cheapAdd }, 'deck', STAMPED_AT))).toBe(
      '"changes" must be an array.',
    )
  })

  test('accepts exactly MAX_SAVE_CHANGES events and refuses one more', () => {
    const atLimit: WireChange[] = Array.from({ length: MAX_SAVE_CHANGES }, () => cheapAdd)
    expect(accepted(decodeWireChanges(atLimit, 'collection', STAMPED_AT))).toHaveLength(
      MAX_SAVE_CHANGES,
    )

    const error = refused(decodeWireChanges([...atLimit, cheapAdd], 'collection', STAMPED_AT))
    expect(error).toContain(`at most ${MAX_SAVE_CHANGES} changes`)
    expect(error).toContain(`got ${MAX_SAVE_CHANGES + 1}`)
  })

  test('refuses a non-object item, naming its index', () => {
    expect(refused(decodeWireChanges([cheapAdd, 'add Sol Ring'], 'deck', STAMPED_AT))).toBe(
      'changes[1] is not an object.',
    )
  })

  // The decoder keeps undeclared keys (a bundle's payload is open); a save must
  // not, or a stray key would reach the reducers.
  test('drops a key the event format does not persist', () => {
    const [change] = accepted(
      decodeWireChanges([{ ...cheapAdd, fileOrder: ['Sol Ring'] }], 'deck', STAMPED_AT),
    )
    expect(change).not.toHaveProperty('fileOrder')
    expect(change).toMatchObject(cheapAdd)
  })

  test('judges a label set against the list type it lands in', () => {
    const relabel: WireChange = {
      action: 'set-label',
      cardName: 'Sol Ring',
      cardId: 4,
      labels: ['sale'],
    }
    expect(accepted(decodeWireChanges([relabel], 'collection', STAMPED_AT))).toHaveLength(1)
    expect(refused(decodeWireChanges([relabel], 'deck', STAMPED_AT))).toBe(
      'changes[0] labels [sale] are not supported on a deck; supported: proxy.',
    )
  })
})

describe('the save byte budget', () => {
  // MAX_EDIT_BODY_SIZE is derived from MAX_SAVE_CHANGES at a per-event budget;
  // a full batch of ordinary edits must fit it, envelope and all.
  test('a full batch of typical wire events encodes under MAX_EDIT_BODY_SIZE', () => {
    const events: ChangeEvent[] = Array.from({ length: MAX_SAVE_CHANGES }, (_, i) =>
      i % 2 === 0
        ? {
            id: `e${i}`,
            timestamp: i,
            action: 'set-label',
            cardName: 'Kozilek, the Great Distortion',
            cardId: 40_000 + i,
            set: 'ogw',
            collectorNumber: '4',
            labels: ['sale', 'trade'],
          }
        : {
            id: `e${i}`,
            timestamp: i,
            action: 'add',
            cardName: 'Kozilek, the Great Distortion',
            cardId: 40_000 + i,
            set: 'ogw',
            collectorNumber: '4',
            finish: 'foil',
            condition: 'NM',
          },
    )
    const body = JSON.stringify(listSaveRequest(events, 'a'.repeat(64), { continueSession: true }))
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(MAX_EDIT_BODY_SIZE)
  })
})

describe('listSavePath', () => {
  test('encodes the slug as one path segment', () => {
    expect(listSavePath('deck', 'My Deck')).toBe('/api/deck/My%20Deck/save')
    expect(listSavePath('wanted', 'a/b?c')).toBe('/api/wanted/a%2Fb%3Fc/save')
  })
})

describe('listSaveRequest', () => {
  test('sends each event without its envelope and keeps the options', () => {
    const event: ChangeEvent = {
      id: 'session-7',
      timestamp: 42,
      action: 'add',
      cardName: 'Sol Ring',
      cardId: 3,
    }
    expect(
      listSaveRequest([event], 'hash', { continueSession: true, validateCardNames: true }),
    ).toEqual({
      changes: [{ action: 'add', cardName: 'Sol Ring', cardId: 3 }],
      contentHash: 'hash',
      continueSession: true,
      validateCardNames: true,
    })
  })
})
