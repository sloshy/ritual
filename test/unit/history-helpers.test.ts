import { describe, expect, it } from 'bun:test'
import { buildDefaultChangeLines, type ListSnapshot } from '../../src/commands/history-helpers'

describe('buildDefaultChangeLines', () => {
  it('emits sections, per-copy adds, commander, note, and set-section lines', () => {
    const snapshot: ListSnapshot = {
      sectionOrder: ['Main', 'Ramp', 'Commander'],
      entries: [
        {
          name: 'Sol Ring',
          set: 'c21',
          collectorNumber: '240',
          cardId: 1,
          section: 'Ramp',
          quantity: 2,
          isCommander: false,
        },
        { name: 'Atraxa', cardId: 2, section: 'Commander', quantity: 1, isCommander: true },
        { name: 'Forest', section: 'Main', quantity: 1, isCommander: false, note: 'basic' },
      ],
    }

    expect(buildDefaultChangeLines(snapshot)).toEqual([
      '- Added section "Ramp"',
      '- Added section "Commander"',
      '- Added "Sol Ring" (C21:240) &1',
      '- Added "Sol Ring" (C21:240) &1',
      '- Moved "Sol Ring" to section "Ramp" &1',
      '- Added "Atraxa" &2',
      '- Set "Atraxa" as commander &2',
      '- Moved "Atraxa" to section "Commander" &2',
      '- Added "Forest"',
      '- Set note on "Forest" to "basic"',
    ])
  })

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
