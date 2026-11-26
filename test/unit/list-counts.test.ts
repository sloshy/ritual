import { describe, expect, test } from 'bun:test'
import { countDeck, countEntries } from '../../src/list/list-counts'

/** How a list is counted: lines, copies, and the per-section breakdown. Pure. */

describe('countDeck', () => {
  test('reports lines, copies, and the per-section breakdown', () => {
    expect(
      countDeck({
        sections: [
          {
            name: 'Main',
            cards: [
              { name: 'Lightning Bolt', quantity: 4 },
              { name: 'Lava Spike', quantity: 3 },
              { name: 'Goblin Guide', quantity: 4 },
            ],
          },
          {
            name: 'Sideboard',
            cards: [
              { name: 'Smash to Smithereens', quantity: 2 },
              { name: 'Lightning Helix', quantity: 1 },
            ],
          },
        ],
      }),
    ).toEqual({
      entryCount: 5,
      cardCount: 14,
      sections: [
        { name: 'Main', entryCount: 3, cardCount: 11 },
        { name: 'Sideboard', entryCount: 2, cardCount: 3 },
      ],
    })
  })
})

describe('countEntries', () => {
  type Entry = { name: string; section?: string; quantity?: number }

  // "Zany Artifacts" first, so first-appearance order is not also alphabetical.
  const ENTRIES: Entry[] = [
    { name: 'Sol Ring', section: 'Zany Artifacts' },
    { name: 'Arcane Signet', section: 'Zany Artifacts', quantity: 3 },
    { name: 'Lightning Bolt', section: 'Burn' },
    { name: 'Lightning Helix' },
  ]

  test('counts one copy per line by default, sections in first-appearance order', () => {
    expect(countEntries(ENTRIES, (entry) => entry.section)).toEqual({
      entryCount: 4,
      cardCount: 4,
      sections: [
        { name: 'Zany Artifacts', entryCount: 2, cardCount: 2 },
        { name: 'Burn', entryCount: 1, cardCount: 1 },
        { name: 'Main', entryCount: 1, cardCount: 1 },
      ],
    })
  })

  test('sums copies through the quantity accessor', () => {
    const counts = countEntries(
      ENTRIES,
      (entry) => entry.section,
      (entry) => entry.quantity ?? 1,
    )
    expect(counts.entryCount).toBe(4)
    expect(counts.cardCount).toBe(6)
    expect(counts.sections[0]).toEqual({ name: 'Zany Artifacts', entryCount: 2, cardCount: 4 })
  })
})
