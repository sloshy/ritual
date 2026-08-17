import { describe, expect, test } from 'bun:test'
import { buildRawCardIndex } from '../../src/deck-sync/engine'
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
    expect(index.get('sol ring')?.relations[0].raw.id).toBe(11)
    expect(index.get('lightning bolt')?.relations[0].raw.id).toBe(22)
    // Each relation is seeded with what Archidekt records today; the plan moves
    // it from there.
    expect(index.get('lightning bolt')?.relations[0].quantity).toBe(4)
    expect(index.get('lightning bolt')?.relations[0].touched).toBe(false)
  })

  test('different casings of the same name are deduplicated and summed', () => {
    // Locks in the intersection of the case-insensitivity and first-seen-first
    // invariants: "Forest" and "forest" must collapse to one entry, with the
    // first relation staying `relations[0]` — the row a quantity increase is
    // written to.
    const index = buildRawCardIndex(
      makeRawDeck([
        { name: 'Forest', quantity: 3, relationId: 1 },
        { name: 'forest', quantity: 2, relationId: 2 },
      ]),
    )

    expect(index.size).toBe(1)
    const forest = index.get('forest')
    expect(forest?.relations[0].raw.card.oracleCard.name).toBe('Forest')
    // Every relation is retained, in response order: the upload plan works
    // relation by relation, so all of them must be reachable.
    expect(forest?.relations.map((relation) => relation.raw.id)).toEqual([1, 2])
    // Keys are lowercased: the original casing is not a valid lookup key.
    expect(index.get('Forest')).toBeUndefined()
  })
})
