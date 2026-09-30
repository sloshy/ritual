import { describe, expect, test } from 'bun:test'
import {
  localCategoriesFor,
  pullCategoryChanges,
  remoteDeckCategories,
} from '../../src/deck-sync/categories'
import { buildUploadPlan, type UploadPlan } from '../../src/deck-sync/upload-plan'
import { diffDeckCards } from '../../src/deck-sync/diff'
import type { ArchidektClient } from '../../src/clients/ArchidektClient'
import type {
  ArchidektCardSearchResult,
  ArchidektCategory,
  ArchidektRawCardEntry,
  ArchidektRawDeckResponse,
} from '../../src/importers/archidekt-types'
import { recordFromJson } from '../../src/list/card-categories-record'
import type { DeckData, DeckSection } from '../../src/list/deck'

/**
 * The categories half of a deck sync at the engine layer: what a pull turns
 * the remote's categories into, what a push reads out of the local file, and
 * the relation categories the upload plan sends. The command wiring (flags,
 * files, the no-local-categories guard) is pinned in deck-sync-run.test.ts.
 */

const DEFINITIONS: ArchidektCategory[] = [
  { id: 1, name: 'Commander', isPremier: true, includedInDeck: true },
  { id: 2, name: 'Sideboard', isPremier: false, includedInDeck: false },
]

type RelationSpec = { id: number; name: string; quantity?: number; categories: string[] }

function relation({ id, name, quantity = 1, categories }: RelationSpec): ArchidektRawCardEntry {
  return {
    id,
    quantity,
    modifier: 'Normal',
    categories,
    companion: false,
    flippedDefault: false,
    label: ',#656565',
    customCmc: null,
    card: {
      id: id * 100,
      uid: `uid-${id}`,
      collectorNumber: String(id),
      options: ['Normal'],
      oracleCard: { id: id * 10, name },
      edition: { editioncode: 'tst' },
    },
  }
}

function rawDeck(relations: RelationSpec[]): ArchidektRawDeckResponse {
  return {
    id: 1,
    name: 'Test',
    owner: { id: 1, username: 'tester' },
    categories: DEFINITIONS,
    cards: relations.map(relation),
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function deck(names: string[]): DeckData {
  return { name: 'Test', sections: [main(names)] }
}

function main(names: string[]): DeckSection {
  return { name: 'Main', cards: names.map((name) => ({ quantity: 1, name })) }
}

/** A client whose card search answers every name with Archidekt's `defaultCategory: Removal`. */
const searchClient = {
  searchCards: async (name: string): Promise<ArchidektCardSearchResult> => ({
    id: 900,
    collectorNumber: '1',
    options: ['Normal'],
    oracleCard: { name, defaultCategory: 'Removal' },
  }),
} as unknown as ArchidektClient

describe('pullCategoryChanges', () => {
  const remote = remoteDeckCategories(
    rawDeck([
      { id: 1, name: 'Sol Ring', categories: ['Ramp'] },
      { id: 2, name: 'Island', categories: [] },
    ]),
  )

  test('adopts the remote categories and clears a card the remote leaves uncategorized', () => {
    const local = recordFromJson({ order: [], cards: { Island: ['Land'] } })
    expect(
      pullCategoryChanges(local, remote, deck(['Sol Ring', 'Island'])).map((change) => [
        change.cardName,
        change.categories,
      ]),
    ).toEqual([
      ['Sol Ring', ['Ramp']],
      ['Island', []],
    ])
  })

  test('an identical list is no event, whatever the local name’s case', () => {
    const local = recordFromJson({ order: [], cards: { 'sol ring': ['Ramp'] } })
    expect(pullCategoryChanges(local, remote, deck(['Sol Ring', 'Island']))).toEqual([])
  })

  test('a local card the remote does not hold keeps its categories', () => {
    const local = recordFromJson({ order: [], cards: { 'Black Lotus': ['Ramp'] } })
    expect(pullCategoryChanges(local, remote, deck(['Black Lotus']))).toEqual([])
  })
})

describe('localCategoriesFor', () => {
  test('categories for a held card, none for an uncategorized one, undefined for one not held', () => {
    const of = localCategoriesFor(
      recordFromJson({ order: [], cards: { 'Sol Ring': ['Ramp'] } }),
      deck(['Sol Ring', 'Island']),
    )
    expect(of('Sol Ring')).toEqual(['Ramp'])
    expect(of('Island')).toEqual([])
    expect(of('Lightning Bolt')).toBeUndefined()
  })
})

describe('buildUploadPlan categories', () => {
  /** Plan a push of `local` over `remote`, with categories read from `sidecar`. */
  async function plan(
    remote: RelationSpec[],
    local: DeckSection[],
    sidecar: Record<string, string[]>,
    withPrintings = false,
  ): Promise<UploadPlan> {
    const raw = rawDeck(remote)
    const remoteSections = [
      {
        name: 'Main',
        cards: remote.map((r) => ({
          quantity: r.quantity ?? 1,
          name: r.name,
          set: 'tst',
          collectorNumber: String(r.id),
        })),
      },
    ]
    const diff = diffDeckCards(remoteSections, local, { byBoard: false, withPrintings })
    const localDeck: DeckData = { name: 'Test', sections: local }
    return buildUploadPlan(
      diff,
      local,
      raw,
      searchClient,
      'token',
      localCategoriesFor(recordFromJson({ order: [], cards: sidecar }), localDeck),
    )
  }

  test('keeps boards and refused names from the remote, and never sends a board as a role', async () => {
    const result = await plan(
      [{ id: 1, name: 'Sol Ring', categories: ['Commander', 'Draw, Cantrips', 'Ramp'] }],
      [main(['Sol Ring'])],
      { 'Sol Ring': ['Artifacts', 'Sideboard'] },
    )
    expect(result.entries).toMatchObject([
      { deckRelationId: 1, categories: ['Commander', 'Draw, Cantrips', 'Artifacts'] },
    ])
    expect(result.categoriesChanged).toEqual(['Sol Ring'])
  })

  test('a relation the push removes keeps its categories', async () => {
    const result = await plan([{ id: 1, name: 'Sol Ring', categories: ['Ramp'] }], [main([])], {})
    expect(result.entries).toMatchObject([{ action: 'remove', categories: ['Ramp'] }])
    expect(result.categoriesChanged).toEqual([])
  })

  test('a card new to Archidekt goes into its local categories, else Archidekt’s default', async () => {
    const result = await plan([], [main(['Counterspell', 'Swords to Plowshares'])], {
      Counterspell: ['Interaction'],
    })
    expect(result.entries.map((entry) => entry.categories)).toEqual([['Interaction'], ['Removal']])
  })

  test('an added printing of an uncategorized card takes only its sibling’s board', async () => {
    const result = await plan(
      [{ id: 1, name: 'Sol Ring', categories: ['Commander', 'Ramp'] }],
      [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', set: 'tst', collectorNumber: '1' },
            { quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '270' },
          ],
        },
      ],
      {},
      true,
    )
    // Every relation of the card agrees: the board stays, the roles go.
    expect(result.entries).toMatchObject([
      { action: 'modify', deckRelationId: 1, categories: ['Commander'] },
      { action: 'add', categories: ['Commander'] },
    ])
  })
})
