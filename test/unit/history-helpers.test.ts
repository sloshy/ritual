import { describe, expect, it } from 'bun:test'
import { buildDefaultChangeLines, type ListSnapshot } from '../../src/commands/history-helpers'

describe('buildDefaultChangeLines', () => {
  it('renders foil/condition annotations on add lines', () => {
    const snapshot: ListSnapshot = {
      sectionOrder: ['Main'],
      entries: [
        {
          name: 'Mana Crypt',
          set: '2xm',
          collectorNumber: '1',
          finish: 'foil',
          condition: 'LP',
          cardId: 5,
          section: 'Main',
          quantity: 1,
          isCommander: false,
        },
      ],
    }

    expect(buildDefaultChangeLines(snapshot)).toEqual([
      '- Added "Mana Crypt" (2XM:1) [foil] [LP] &5',
    ])
  })

  it('returns no lines for an empty list', () => {
    expect(buildDefaultChangeLines({ sectionOrder: ['Main'], entries: [] })).toEqual([])
  })
})
