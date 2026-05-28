import { describe, test, expect } from 'bun:test'
import type { ChangeEvent, AddChange } from '../../src/change-event'
import { trackAdd, trackEdit, trackAnotherCopy } from '../../src/session-changelog'

function makeEvent(overrides: Partial<AddChange> = {}): AddChange {
  return {
    id: 'test-id',
    timestamp: 1000,
    action: 'add',
    cardName: 'Sol Ring',
    ...overrides,
  }
}

describe('trackAdd', () => {
  test('pushes the event and returns index 0 into an empty array', () => {
    const changes: ChangeEvent[] = []
    const event = makeEvent()
    const idx = trackAdd(changes, event)

    expect(idx).toBe(0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toBe(event)
  })

  test('appends to existing events and returns the new last index', () => {
    const changes: ChangeEvent[] = [makeEvent({ cardName: 'First' })]
    const event = makeEvent({ cardName: 'Second' })
    const idx = trackAdd(changes, event)

    expect(idx).toBe(1)
    expect(changes).toHaveLength(2)
    expect(changes[1]).toBe(event)
  })

  test('does not mutate the event object', () => {
    const changes: ChangeEvent[] = []
    const event = makeEvent({ cardName: 'Lightning Bolt', set: 'lea', collectorNumber: '161' })
    trackAdd(changes, event)

    expect((changes[0] as AddChange).cardName).toBe('Lightning Bolt')
    expect((changes[0] as AddChange).set).toBe('lea')
    expect((changes[0] as AddChange).collectorNumber).toBe('161')
  })
})

describe('trackEdit', () => {
  test('replaced=true with valid lastChangeIndex — updates in place, length unchanged', () => {
    const original = makeEvent({ cardName: 'Old Card' })
    const changes = [original]
    const edited = makeEvent({ cardName: 'New Card' })

    const idx = trackEdit(changes, 0, edited, true)

    expect(idx).toBe(0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toBe(edited)
  })

  test('replaced=true preserves all fields of the new event', () => {
    const changes = [makeEvent()]
    const edited = makeEvent({
      cardName: 'Tarmogoyf',
      set: 'fut',
      collectorNumber: '153',
      finish: 'foil',
      condition: 'LP',
    })

    trackEdit(changes, 0, edited, true)

    expect(changes[0]!.cardName).toBe('Tarmogoyf')
    expect((changes[0] as AddChange).set).toBe('fut')
    expect((changes[0] as AddChange).finish).toBe('foil')
    expect((changes[0] as AddChange).condition).toBe('LP')
  })

  test('replaced=true with lastChangeIndex=null — pushes as new event', () => {
    const changes: ChangeEvent[] = []
    const event = makeEvent()

    const idx = trackEdit(changes, null, event, true)

    expect(idx).toBe(0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toBe(event)
  })

  test('replaced=false — always pushes a new event even when lastChangeIndex is valid', () => {
    const original = makeEvent({ cardName: 'Old' })
    const changes = [original]
    const event = makeEvent({ cardName: 'New' })

    const idx = trackEdit(changes, 0, event, false)

    expect(idx).toBe(1)
    expect(changes).toHaveLength(2)
    expect(changes[0]).toBe(original)
    expect(changes[1]).toBe(event)
  })

  test('replaced=false with lastChangeIndex=null — pushes a new event', () => {
    const changes: ChangeEvent[] = []
    const event = makeEvent()

    const idx = trackEdit(changes, null, event, false)

    expect(idx).toBe(0)
    expect(changes).toHaveLength(1)
  })

  test('mid-array edit — only the targeted index is updated', () => {
    const a = makeEvent({ cardName: 'A' })
    const b = makeEvent({ cardName: 'B' })
    const c = makeEvent({ cardName: 'C' })
    const changes = [a, b, c]
    const edited = makeEvent({ cardName: 'B-edited' })

    const idx = trackEdit(changes, 1, edited, true)

    expect(idx).toBe(1)
    expect(changes[0]).toBe(a)
    expect(changes[1]).toBe(edited)
    expect(changes[2]).toBe(c)
    expect(changes).toHaveLength(3)
  })
})

describe('trackAnotherCopy', () => {
  test('returns null and does not modify array when lastChangeIndex is null', () => {
    const changes: ChangeEvent[] = []

    const result = trackAnotherCopy(changes, null)

    expect(result).toBeNull()
    expect(changes).toHaveLength(0)
  })

  test('pushes a copy with a different id', () => {
    const original = makeEvent({ id: 'orig-id', cardName: 'Sol Ring' })
    const changes = [original]

    const idx = trackAnotherCopy(changes, 0)

    expect(idx).toBe(1)
    expect(changes).toHaveLength(2)
    expect(changes[1]!.id).not.toBe('orig-id')
  })

  test('copy preserves all card data from the original event', () => {
    const original = makeEvent({
      cardName: 'Black Lotus',
      set: 'lea',
      collectorNumber: '1',
      finish: 'foil',
      condition: 'LP',
    })
    const changes = [original]

    trackAnotherCopy(changes, 0)

    const copy = changes[1]!
    expect(copy.cardName).toBe('Black Lotus')
    expect(copy.set).toBe('lea')
    expect(copy.collectorNumber).toBe('1')
    expect(copy.finish).toBe('foil')
    expect(copy.condition).toBe('LP')
    expect(copy.action).toBe('add')
  })

  test('copy timestamp is >= original timestamp', () => {
    const original = makeEvent({ timestamp: 1000 })
    const changes = [original]

    trackAnotherCopy(changes, 0)

    expect(changes[1]!.timestamp).toBeGreaterThanOrEqual(1000)
  })

  test('does not mutate the original event', () => {
    const original = makeEvent({ id: 'orig-id', timestamp: 1000 })
    const changes = [original]

    trackAnotherCopy(changes, 0)

    expect(changes[0]!.id).toBe('orig-id')
    expect(changes[0]!.timestamp).toBe(1000)
  })

  test('copies from the correct index when multiple events exist', () => {
    const changes = [
      makeEvent({ cardName: 'First', set: 'lea' }),
      makeEvent({ cardName: 'Second', set: 'grn' }),
    ]

    const idx = trackAnotherCopy(changes, 1)

    expect(idx).toBe(2)
    expect(changes[2]!.cardName).toBe('Second')
    expect((changes[2] as AddChange).set).toBe('grn')
  })

  test('multiple consecutive copies all preserve card identity', () => {
    const original = makeEvent({ cardName: 'Mox Ruby', set: 'lea', collectorNumber: '265' })
    const changes = [original]

    let idx: number | null = 0
    idx = trackAnotherCopy(changes, idx)
    idx = trackAnotherCopy(changes, idx)
    trackAnotherCopy(changes, idx)

    expect(changes).toHaveLength(4)
    for (const event of changes) {
      expect(event.cardName).toBe('Mox Ruby')
      expect(event.set).toBe('lea')
    }
    // All IDs should be unique
    const ids = changes.map((e) => e.id)
    expect(new Set(ids).size).toBe(4)
  })

  test('assigns provided cardId to the copy, overriding the original', () => {
    const original = makeEvent({ cardId: 3 })
    const changes = [original]

    const idx = trackAnotherCopy(changes, 0, 7)

    expect(idx).toBe(1)
    expect(changes[1]!.cardId).toBe(7)
    // Original is unchanged
    expect(changes[0]!.cardId).toBe(3)
  })

  test('preserves original cardId on copy when no cardId argument is given', () => {
    const original = makeEvent({ cardId: 5 })
    const changes = [original]

    trackAnotherCopy(changes, 0)

    expect(changes[1]!.cardId).toBe(5)
  })

  test('consecutive copies each use the assigned cardId when provided', () => {
    const original = makeEvent({ cardName: 'Sol Ring', cardId: 1 })
    const changes = [original]

    let idx: number | null = 0
    idx = trackAnotherCopy(changes, idx, 2)
    trackAnotherCopy(changes, idx, 3)

    expect(changes[1]!.cardId).toBe(2)
    expect(changes[2]!.cardId).toBe(3)
    // All event IDs still unique
    const ids = changes.map((e) => e.id)
    expect(new Set(ids).size).toBe(3)
  })
})
