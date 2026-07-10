import { describe, expect, test } from 'bun:test'
import { buildRawCardIndex } from '../../src/commands/deck-sync'
import type {
  ArchidektRawCardEntry,
  ArchidektRawDeckResponse,
} from '../../src/importers/archidekt-types'

type CardSpec = {
  name: string
  quantity: number
  relationId?: number
}

function makeEntry({ name, quantity, relationId = 1 }: CardSpec): ArchidektRawCardEntry {
  return {
    id: relationId,
    quantity,
    modifier: 'Normal',
    categories: ['Mainboard'],
    companion: false,
    flippedDefault: false,
    label: ',#656565',
    customCmc: null,
    card: {
      id: relationId * 100,
      uid: `uid-${relationId}`,
      collectorNumber: '1',
      options: ['Normal'],
      oracleCard: { id: relationId * 10, name, defaultCategory: 'Mainboard' },
      edition: { editioncode: 'tst' },
    },
  }
}

function makeRawDeck(cards: CardSpec[]): ArchidektRawDeckResponse {
  return {
    id: 1,
    name: 'Test',
    owner: { id: 1, username: 'tester' },
    categories: [],
    cards: cards.map(makeEntry),
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('buildRawCardIndex', () => {
  test('indexes unique cards by lowercased name', () => {
    const index = buildRawCardIndex(
      makeRawDeck([
        { name: 'Sol Ring', quantity: 1, relationId: 11 },
        { name: 'Lightning Bolt', quantity: 4, relationId: 22 },
      ]),
    )

    expect(index.size).toBe(2)
    expect(index.get('sol ring')?.totalQty).toBe(1)
    expect(index.get('sol ring')?.entry.id).toBe(11)
    expect(index.get('lightning bolt')?.totalQty).toBe(4)
    expect(index.get('lightning bolt')?.entry.id).toBe(22)
  })

  test('different casings of the same name are deduplicated and summed', () => {
    // Locks in the intersection of the case-insensitivity and dedup invariants:
    // "Forest" and "forest" must collapse to one entry, with quantities summed
    // and the first entry preserved. Without case-folding on the index key,
    // each variant would become its own row and uploads would target the wrong one.
    // The "keep first" invariant matters for uploads: the kept entry's deckRelationId
    // and modifier are passed back to Archidekt's modifyCards API. If the test breaks
    // because someone switched to "keep last", uploads could target the wrong row.
    const index = buildRawCardIndex(
      makeRawDeck([
        { name: 'Forest', quantity: 3, relationId: 1 },
        { name: 'forest', quantity: 2, relationId: 2 },
      ]),
    )

    expect(index.size).toBe(1)
    const forest = index.get('forest')
    expect(forest?.totalQty).toBe(5)
    expect(forest?.entry.id).toBe(1)
    expect(forest?.entry.card.oracleCard.name).toBe('Forest')
    // Keys are lowercased: the original casing is not a valid lookup key.
    expect(index.get('Forest')).toBeUndefined()
  })
})
