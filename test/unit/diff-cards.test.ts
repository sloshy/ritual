import { describe, test, expect } from 'bun:test'
import { diffDeckCards, diffCollectionEntries, diffWantedEntries } from '../../src/diff-cards'
import type { DeckSection } from '../../src/types'
import type { CollectionEntry } from '../../src/collection-file'
import type { WantedListEntry } from '../../src/commands/wanted-helpers'

// ── Deck diffing ─────────────────────────────────────────────────────

describe('diffDeckCards', () => {
  test('detects added cards', () => {
    const oldSections: DeckSection[] = []
    const newSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167', cardId: 1 }],
      },
    ]

    const changes = diffDeckCards(oldSections, newSections)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('add')
    expect(changes[0]!.cardName).toBe('Sol Ring')
  })

  test('detects removed cards', () => {
    const oldSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
        ],
      },
    ]
    const newSections: DeckSection[] = []

    const changes = diffDeckCards(oldSections, newSections)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('remove')
    expect(changes[0]!.cardName).toBe('Lightning Bolt')
  })

  test('detects quantity increases', () => {
    const oldSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 2, name: 'Island', cardId: 1 }] },
    ]
    const newSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 4, name: 'Island', cardId: 1 }] },
    ]

    const changes = diffDeckCards(oldSections, newSections)
    const adds = changes.filter((c) => c.action === 'add')
    expect(adds).toHaveLength(2)
    expect(adds[0]!.cardName).toBe('Island')
  })

  test('detects quantity decreases', () => {
    const oldSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 4, name: 'Mountain', cardId: 3 }] },
    ]
    const newSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Mountain', cardId: 3 }] },
    ]

    const changes = diffDeckCards(oldSections, newSections)
    const removes = changes.filter((c) => c.action === 'remove')
    expect(removes).toHaveLength(3)
  })

  test('detects commander promotion', () => {
    const oldSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Atraxa', cardId: 5 }] },
    ]
    const newSections: DeckSection[] = [
      { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa', cardId: 5 }] },
    ]

    const changes = diffDeckCards(oldSections, newSections)
    const setCmd = changes.filter((c) => c.action === 'set-commander')
    expect(setCmd).toHaveLength(1)
    expect(setCmd[0]!.cardName).toBe('Atraxa')
  })

  test('detects commander demotion', () => {
    const oldSections: DeckSection[] = [
      { name: 'Commander', cards: [{ quantity: 1, name: 'Kenrith', cardId: 7 }] },
    ]
    const newSections: DeckSection[] = [
      { name: 'Main', cards: [{ quantity: 1, name: 'Kenrith', cardId: 7 }] },
    ]

    const changes = diffDeckCards(oldSections, newSections)
    const unsetCmd = changes.filter((c) => c.action === 'unset-commander')
    expect(unsetCmd).toHaveLength(1)
    expect(unsetCmd[0]!.cardName).toBe('Kenrith')
  })

  test('detects finish changes', () => {
    const oldSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', finish: 'nonfoil', cardId: 1 }],
      },
    ]
    const newSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', finish: 'foil', cardId: 1 }],
      },
    ]

    const changes = diffDeckCards(oldSections, newSections)
    const finishChanges = changes.filter((c) => c.action === 'set-finish')
    expect(finishChanges).toHaveLength(1)
    expect(finishChanges[0]!.cardName).toBe('Sol Ring')
  })

  test('matches cards by cardId when available', () => {
    const oldSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167', cardId: 1 }],
      },
    ]
    // Same cardId, different set — treated as same card
    const newSections: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'cmr', collectorNumber: '472', cardId: 1 }],
      },
    ]

    const changes = diffDeckCards(oldSections, newSections)
    // No add/remove since cardId matches — only quantity is same
    const addRemove = changes.filter((c) => c.action === 'add' || c.action === 'remove')
    expect(addRemove).toHaveLength(0)
  })

  test('returns empty array for identical decks', () => {
    const sections: DeckSection[] = [
      {
        name: 'Main',
        cards: [
          { quantity: 4, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
          { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167', cardId: 2 },
        ],
      },
    ]

    const changes = diffDeckCards(sections, sections)
    expect(changes).toHaveLength(0)
  })

  test('new commander card generates both add and set-commander', () => {
    const oldSections: DeckSection[] = []
    const newSections: DeckSection[] = [
      {
        name: 'Commander',
        cards: [{ quantity: 1, name: 'Atraxa', cardId: 10 }],
      },
    ]

    const changes = diffDeckCards(oldSections, newSections)
    expect(changes).toHaveLength(2)
    expect(changes[0]!.action).toBe('add')
    expect(changes[1]!.action).toBe('set-commander')
  })
})

// ── Collection diffing ───────────────────────────────────────────────

describe('diffCollectionEntries', () => {
  test('detects added entries', () => {
    const oldEntries: CollectionEntry[] = []
    const newEntries: CollectionEntry[] = [
      {
        name: 'Black Lotus',
        quantity: 1,
        set: 'lea',
        collectorNumber: '233',
        cardId: 1,
        section: 'Main',
      },
    ]

    const changes = diffCollectionEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('add')
    expect(changes[0]!.cardName).toBe('Black Lotus')
  })

  test('detects removed entries', () => {
    const oldEntries: CollectionEntry[] = [
      {
        name: 'Mox Pearl',
        quantity: 1,
        set: 'lea',
        collectorNumber: '263',
        cardId: 2,
        section: 'Main',
      },
    ]
    const newEntries: CollectionEntry[] = []

    const changes = diffCollectionEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('remove')
    expect(changes[0]!.cardName).toBe('Mox Pearl')
  })

  test('matches by cardId', () => {
    const oldEntries: CollectionEntry[] = [
      {
        name: 'Sol Ring',
        quantity: 1,
        set: 'c21',
        collectorNumber: '167',
        cardId: 5,
        section: 'Main',
      },
    ]
    const newEntries: CollectionEntry[] = [
      {
        name: 'Sol Ring',
        quantity: 1,
        set: 'cmr',
        collectorNumber: '472',
        cardId: 5,
        section: 'Main',
      },
    ]

    const changes = diffCollectionEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(0)
  })

  test('falls back to composite key without cardId', () => {
    const oldEntries: CollectionEntry[] = [
      { name: 'Sol Ring', quantity: 1, set: 'c21', collectorNumber: '167', section: 'Main' },
    ]
    const newEntries: CollectionEntry[] = [
      { name: 'Sol Ring', quantity: 1, set: 'c21', collectorNumber: '167', section: 'Main' },
    ]

    const changes = diffCollectionEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(0)
  })

  test('treats different finishes as different entries', () => {
    const oldEntries: CollectionEntry[] = [
      {
        section: 'Main',
        name: 'Sol Ring',
        quantity: 1,
        set: 'c21',
        collectorNumber: '167',
        finish: 'nonfoil',
      },
    ]
    const newEntries: CollectionEntry[] = [
      {
        name: 'Sol Ring',
        quantity: 1,
        set: 'c21',
        collectorNumber: '167',
        finish: 'foil',
        section: 'Main',
      },
    ]

    const changes = diffCollectionEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(2)
    const remove = changes.find((c) => c.action === 'remove')
    const add = changes.find((c) => c.action === 'add')
    expect(remove!.cardName).toBe('Sol Ring')
    expect(add!.cardName).toBe('Sol Ring')
  })

  test('detects finish changes by cardId', () => {
    const oldEntries: CollectionEntry[] = [
      {
        section: 'Main',
        name: 'Sol Ring',
        quantity: 1,
        set: 'c21',
        collectorNumber: '167',
        finish: 'nonfoil',
        cardId: 5,
      },
    ]
    const newEntries: CollectionEntry[] = [
      {
        section: 'Main',
        name: 'Sol Ring',
        quantity: 1,
        set: 'c21',
        collectorNumber: '167',
        finish: 'foil',
        cardId: 5,
      },
    ]

    const changes = diffCollectionEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('set-finish')
    expect(changes[0]!.cardName).toBe('Sol Ring')
  })

  test('does not track quantity changes', () => {
    const oldEntries: CollectionEntry[] = [
      {
        name: 'Island',
        quantity: 2,
        set: 'lea',
        collectorNumber: '288',
        cardId: 6,
        section: 'Main',
      },
    ]
    const newEntries: CollectionEntry[] = [
      {
        name: 'Island',
        quantity: 5,
        set: 'lea',
        collectorNumber: '288',
        cardId: 6,
        section: 'Main',
      },
    ]

    const changes = diffCollectionEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(0)
  })

  test('returns empty for identical collections', () => {
    const entries: CollectionEntry[] = [
      {
        name: 'Black Lotus',
        quantity: 1,
        set: 'lea',
        collectorNumber: '233',
        cardId: 1,
        section: 'Main',
      },
      {
        name: 'Mox Pearl',
        quantity: 1,
        set: 'lea',
        collectorNumber: '263',
        cardId: 2,
        section: 'Main',
      },
    ]

    const changes = diffCollectionEntries(entries, entries)
    expect(changes).toHaveLength(0)
  })
})

// ── Wanted list diffing ──────────────────────────────────────────────

describe('diffWantedEntries', () => {
  test('detects added entries', () => {
    const oldEntries: WantedListEntry[] = []
    const newEntries: WantedListEntry[] = [
      { name: 'Queen Marchesa', quantity: 1, cardId: 1, section: 'Main' },
    ]

    const changes = diffWantedEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('add')
    expect(changes[0]!.cardName).toBe('Queen Marchesa')
  })

  test('detects removed entries', () => {
    const oldEntries: WantedListEntry[] = [
      {
        name: 'Demonic Tutor',
        quantity: 1,
        set: 'uma',
        collectorNumber: '93',
        cardId: 3,
        section: 'Main',
      },
    ]
    const newEntries: WantedListEntry[] = []

    const changes = diffWantedEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('remove')
    expect(changes[0]!.cardName).toBe('Demonic Tutor')
  })

  test('matches by cardId', () => {
    const oldEntries: WantedListEntry[] = [
      { name: 'Force of Will', quantity: 1, cardId: 10, section: 'Main' },
    ]
    const newEntries: WantedListEntry[] = [
      {
        name: 'Force of Will',
        quantity: 1,
        set: 'all',
        collectorNumber: '28',
        cardId: 10,
        section: 'Main',
      },
    ]

    const changes = diffWantedEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(0)
  })

  test('returns empty for identical lists', () => {
    const entries: WantedListEntry[] = [
      { name: 'Queen Marchesa', quantity: 1, cardId: 1, section: 'Main' },
      {
        name: 'Demonic Tutor',
        quantity: 1,
        set: 'uma',
        collectorNumber: '93',
        cardId: 2,
        section: 'Main',
      },
    ]

    const changes = diffWantedEntries(entries, entries)
    expect(changes).toHaveLength(0)
  })

  test('detects multiple adds and removes together', () => {
    const oldEntries: WantedListEntry[] = [
      { name: 'Force of Will', quantity: 1, cardId: 1, section: 'Main' },
      { name: 'Mana Drain', quantity: 1, cardId: 2, section: 'Main' },
    ]
    const newEntries: WantedListEntry[] = [
      { name: 'Force of Will', quantity: 1, cardId: 1, section: 'Main' },
      { name: 'Cyclonic Rift', quantity: 1, cardId: 3, section: 'Main' },
    ]

    const changes = diffWantedEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(2)
    const remove = changes.find((c) => c.action === 'remove')
    const add = changes.find((c) => c.action === 'add')
    expect(remove!.cardName).toBe('Mana Drain')
    expect(add!.cardName).toBe('Cyclonic Rift')
  })

  test('detects quantity increases', () => {
    const oldEntries: WantedListEntry[] = [
      {
        name: 'Lightning Bolt',
        quantity: 1,
        set: 'lea',
        collectorNumber: '161',
        cardId: 5,
        section: 'Main',
      },
    ]
    const newEntries: WantedListEntry[] = [
      {
        name: 'Lightning Bolt',
        quantity: 3,
        set: 'lea',
        collectorNumber: '161',
        cardId: 5,
        section: 'Main',
      },
    ]

    const changes = diffWantedEntries(oldEntries, newEntries)
    const adds = changes.filter((c) => c.action === 'add')
    expect(adds).toHaveLength(2)
    expect(adds[0]!.cardName).toBe('Lightning Bolt')
  })

  test('detects quantity decreases', () => {
    const oldEntries: WantedListEntry[] = [
      { name: 'Island', quantity: 4, cardId: 6, section: 'Main' },
    ]
    const newEntries: WantedListEntry[] = [
      { name: 'Island', quantity: 2, cardId: 6, section: 'Main' },
    ]

    const changes = diffWantedEntries(oldEntries, newEntries)
    const removes = changes.filter((c) => c.action === 'remove')
    expect(removes).toHaveLength(2)
    expect(removes[0]!.cardName).toBe('Island')
  })

  test('detects finish changes by cardId', () => {
    const oldEntries: WantedListEntry[] = [
      {
        section: 'Main',
        name: 'Mox Ruby',
        quantity: 1,
        set: 'lea',
        collectorNumber: '265',
        finish: 'nonfoil',
        cardId: 7,
      },
    ]
    const newEntries: WantedListEntry[] = [
      {
        section: 'Main',
        name: 'Mox Ruby',
        quantity: 1,
        set: 'lea',
        collectorNumber: '265',
        finish: 'foil',
        cardId: 7,
      },
    ]

    const changes = diffWantedEntries(oldEntries, newEntries)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('set-finish')
    expect(changes[0]!.cardName).toBe('Mox Ruby')
  })
})
