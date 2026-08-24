import { describe, expect, test } from 'bun:test'
import {
  deckLineQuantities,
  entryLineQuantities,
  normalizeRequestLanguages,
  readJsonObjectBody,
  removedArtCardIds,
  replayLineCopies,
  type ApiErrorResponse,
} from '../../../src/admin/api/save-helpers'
import {
  createAddChange,
  createMoveFromChange,
  createMoveToChange,
  createRemoveChange,
  createSetLabelChange,
  createSetLanguageChange,
  type ChangeEvent,
} from '../../../src/change-event'
import type { DeckData } from '../../../src/types'

/**
 * The shared JSON-body route prologue. Its two refusal messages are pinned here
 * rather than in each adopting handler's suite: they are the *shared* wording,
 * and a handler test asserting them would only re-pin what this owns.
 */

/** Build a POST request carrying `raw` verbatim as its body. */
function post(raw: string): Request {
  return new Request('http://localhost/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  })
}

/** A refusal, unpacked for assertion. */
type Refusal = { status: number; body: ApiErrorResponse }

/** The refusal body a non-ok outcome carries, failing the test if it succeeded. */
async function refuse(raw: string): Promise<Refusal> {
  const result = await readJsonObjectBody(post(raw))
  if (result.ok) throw new Error('expected a refusal, got a parsed body')
  return {
    status: result.response.status,
    body: (await result.response.json()) as ApiErrorResponse,
  }
}

describe('readJsonObjectBody', () => {
  test('parses a JSON object through', async () => {
    const result = await readJsonObjectBody(post('{"format":"csv","write":true}'))
    expect(result.ok && result.body).toEqual({ format: 'csv', write: true })
  })

  test('unparseable JSON is refused as a 400', async () => {
    const { status, body } = await refuse('{not json')
    expect(status).toBe(400)
    expect(body.message).toBe('Request body must be JSON.')
  })

  test.each([
    ['an array', '[1,2]'],
    ['a bare string', '"nope"'],
    ['null', 'null'],
  ])('%s parses but is not an object', async (_label, raw) => {
    const { status, body } = await refuse(raw)
    expect(status).toBe(400)
    expect(body.message).toBe('Request body must be a JSON object.')
  })
})

/**
 * The one language-validation boundary all three save routes share. The full
 * matrix (normalization, refusals, the entry-side en fold) lives here; each
 * save-route integration test keeps exactly one 400 case proving the route
 * wires this validator in front of its write.
 */
describe('normalizeRequestLanguages', () => {
  /** A request entry as the unvalidated wire carries it. */
  type WireEntry = { language?: unknown }

  /** A raw wire change: the request body is cast unvalidated, which is the point. */
  function wireChange(fields: Record<string, unknown>): ChangeEvent {
    return { id: 'x', timestamp: 0, cardName: 'Sol Ring', ...fields } as unknown as ChangeEvent
  }

  /** The 400 body of a refusal, failing the test on a pass-through. */
  async function refusalMessage(response: Response | null): Promise<string> {
    if (response === null) throw new Error('expected a 400 refusal, got null')
    expect(response.status).toBe(400)
    return ((await response.json()) as ApiErrorResponse).message
  }

  test('an uppercase change code normalizes to the canonical lowercase form', () => {
    const change = wireChange({ action: 'set-language', cardId: 1, language: 'JA' })
    expect(normalizeRequestLanguages([change], [])).toBeNull()
    expect((change as { language?: string }).language).toBe('ja')
  })

  test('an unknown change code is refused, naming the offender', async () => {
    const change = wireChange({ action: 'set-language', cardId: 1, language: 'xx' })
    const message = await refusalMessage(normalizeRequestLanguages([change], []))
    expect(message).toContain('"xx"')
    expect(message).toContain('set-language change for "Sol Ring"')
  })

  test('a set-language change without a language is refused', async () => {
    const change = wireChange({ action: 'set-language', cardId: 1 })
    const message = await refusalMessage(normalizeRequestLanguages([change], []))
    expect(message).toContain('requires a "language"')
  })

  test('the optional-language actions accept absence but not an unknown code', async () => {
    const bare = wireChange({ action: 'add' })
    expect(normalizeRequestLanguages([bare], [])).toBeNull()

    const bad = wireChange({ action: 'add', language: 'klingon' })
    const message = await refusalMessage(normalizeRequestLanguages([bad], []))
    expect(message).toContain('"klingon"')
    expect(message).toContain('add change for "Sol Ring"')
  })

  test('a valid change passes through untouched', () => {
    const change = createSetLanguageChange('Sol Ring', { language: 'ja', cardId: 1 })
    expect(normalizeRequestLanguages([change], [])).toBeNull()
    expect(change.language).toBe('ja')
  })

  test('entry languages normalize with en folded back to absent', () => {
    // `en` folds to undefined (a bare line means English); other codes keep
    // their canonical lowercase spelling on the entry.
    const entries: WireEntry[] = [{ language: 'EN' }, { language: 'JA' }, {}]
    expect(normalizeRequestLanguages([], entries)).toBeNull()
    expect(entries[0]!.language).toBeUndefined()
    expect(entries[1]!.language).toBe('ja')
    expect(entries[2]!.language).toBeUndefined()
  })

  test('an unknown entry language is refused', async () => {
    const message = await refusalMessage(normalizeRequestLanguages([], [{ language: 'xx' }]))
    expect(message).toContain('"xx"')
    expect(message).toContain('a card entry')
  })
})

/**
 * The art half of a save: which `&N` ids stop having custom art because the
 * save's *changes* took their line out of the list. Read from the changes, not
 * from the file that was written — a removal and a re-add of the same card
 * produce a file the diff cannot tell from an untouched one.
 */
describe('removedArtCardIds', () => {
  test('a removed line drops its art', () => {
    const changes = [createRemoveChange('Sol Ring', { cardId: 4 })]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([4])
  })

  test('a card removed and re-added under the same id does not keep it', () => {
    // The pool hands `&4` straight back, so the written file has a line at `&4`
    // either way: only the removal says the art's card is gone.
    const changes = [
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createAddChange('Sol Ring', { cardId: 4 }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([4])
  })

  test('a deck line that merely lost a copy keeps its art', () => {
    const changes = [createRemoveChange('Sol Ring', { cardId: 4 })]
    expect([...removedArtCardIds(changes, new Map([[4, 3]]))]).toEqual([])
  })

  test('a one-copy deck line incremented and decremented again keeps its art', () => {
    // Labels are part of a change's identity, so the increment and the
    // decrement around a label edit no longer cancel each other out and both
    // reach the save. Counted in order, the line never empties — netting the
    // removal against the baseline alone would delete the art of a line that is
    // still in the file, unchanged.
    const changes = [
      createAddChange('Sol Ring', { cardId: 4 }),
      createSetLabelChange('Sol Ring', { cardId: 4, labels: ['proxy'] }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([])
  })

  test('an added copy does not rescue a line whose every copy then goes', () => {
    const changes = [
      createAddChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([4])
  })

  test('removing every copy of a deck line drops it', () => {
    const changes = [
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 2]]))]).toEqual([4])
  })

  test('a card moved to another list takes its art out of this one', () => {
    const changes = [
      createMoveFromChange('Sol Ring', { cardId: 4, to: { type: 'collection', name: 'Binder' } }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([4])
  })

  test('an id the baseline never had is treated as a single line', () => {
    // A line this save created: whatever was filed under the id belonged to a
    // card that is already gone.
    expect([
      ...removedArtCardIds([createRemoveChange('Sol Ring', { cardId: 9 })], new Map()),
    ]).toEqual([9])
  })

  test('changes without a card id say nothing about the sidecar', () => {
    expect([...removedArtCardIds([createRemoveChange('Sol Ring')], new Map([[4, 1]]))]).toEqual([])
  })
})

describe('replayLineCopies', () => {
  test('replays gains and losses per line in order, reporting each step', () => {
    const changes = [
      createAddChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring'),
    ]
    const steps = replayLineCopies(changes, new Map([[4, 1]]), { unknownIdHolds: 1 })
    expect(steps.map((s) => [s.change.action, s.cardId, s.before, s.after])).toEqual([
      ['add', 4, 1, 2],
      ['remove', 4, 2, 1],
      ['remove', 4, 1, 0],
    ])
  })

  test('a move-to pinning a line in place moves no copies; a split takes one off the pinned line first', () => {
    const inPlace = createMoveToChange('Sol Ring', {
      cardId: 4,
      replacesCardId: 4,
      from: { type: 'collection', name: 'Binder' },
    })
    const split = createMoveToChange('Sol Ring', {
      cardId: 9,
      replacesCardId: 4,
      from: { type: 'collection', name: 'Binder' },
    })
    const steps = replayLineCopies([inPlace, split], new Map([[4, 1]]), { unknownIdHolds: 0 })
    expect(steps.map((s) => [s.cardId, s.before, s.after])).toEqual([
      [4, 1, 0],
      [9, 0, 1],
    ])
    // So an in-place pin keeps the line's art, and a split that drains it drops it.
    expect([...removedArtCardIds([inPlace], new Map([[4, 1]]))]).toEqual([])
    expect([...removedArtCardIds([split], new Map([[4, 1]]))]).toEqual([4])
  })

  test('an id the baseline never had starts at unknownIdHolds', () => {
    const arrival = [createAddChange('Sol Ring', { cardId: 9 })]
    expect(replayLineCopies(arrival, new Map(), { unknownIdHolds: 0 })[0]).toMatchObject({
      before: 0,
      after: 1,
    })
    expect(replayLineCopies(arrival, new Map(), { unknownIdHolds: 1 })[0]).toMatchObject({
      before: 1,
      after: 2,
    })
  })
})

describe('line quantities', () => {
  test('a deck line counts every copy under its id', () => {
    const deck: DeckData = {
      name: 'Goblins',
      sections: [
        {
          name: 'Main',
          cards: [
            { name: 'Goblin Guide', quantity: 4, cardId: 1 },
            { name: 'Sol Ring', quantity: 1, cardId: 2 },
            { name: 'Unnumbered', quantity: 2 },
          ],
        },
      ],
    }
    expect([...deckLineQuantities(deck)]).toEqual([
      [1, 4],
      [2, 1],
    ])
  })

  test('a flat list holds one copy per line', () => {
    expect([...entryLineQuantities([{ cardId: 3 }, { cardId: 5 }, {}])]).toEqual([
      [3, 1],
      [5, 1],
    ])
  })
})
