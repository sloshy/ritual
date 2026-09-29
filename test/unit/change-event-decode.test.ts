import { describe, test, expect } from 'bun:test'
import { decodeChangeEvent } from '../../src/changes/change-event-decode'

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
    expect(decodeChangeEvent(add({ cardName: 'Sol Ring\n- 1 Black Lotus &3' }), 'Change #1 ')).toBe(
      'Change #1 has a line break in "change.cardName".',
    )
  })

  test('refuses a nested list name holding a line break', () => {
    const event = {
      id: 'x',
      timestamp: 1,
      action: 'move-from',
      cardName: 'Sol Ring',
      to: { type: 'deck', name: 'Burn\r## 2020-01-01T00:00:00.000Z' },
    }
    expect(decodeChangeEvent(event, '')).toBe('has a line break in "change.to.name".')
  })

  test('refuses a field no validator lists, since the whole event is walked', () => {
    expect(decodeChangeEvent(add({ futureField: 'a\u2028b' }), '')).toBe(
      'has a line break in "change.futureField".',
    )
  })

  test('keeps an event whose string holds a tab: it cannot forge a line', () => {
    expect(decodeChangeEvent(add({ cardName: 'Sol\tRing' }), '')).toMatchObject({
      cardName: 'Sol\tRing',
    })
  })
})
