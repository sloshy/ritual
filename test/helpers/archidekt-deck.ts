import type { ArchidektCardQuery, ArchidektClient } from '../../src/clients/ArchidektClient'
import {
  parseArchidektDeckResponse,
  type ArchidektCardEntry,
  type ArchidektCardModifier,
  type ArchidektCardSearchResult,
  type ArchidektCategory,
  type ArchidektDeckResponse,
  type ArchidektRawCardEntry,
  type ArchidektRawDeckResponse,
} from '../../src/importers/archidekt-types'
import type { DeckSection } from '../../src/list/deck'

/**
 * Synthetic Archidekt deck payloads for the deck-sync engine's unit tests: one
 * builder for the raw relations a push plans against, read through the real
 * deck parser for the sections a diff compares, so the two halves of a push
 * never disagree the way hand-written sections could.
 */

/** One relation of a synthetic deck: edition `TST`, collector number `id` unless given. */
export type RelationSpec = {
  id: number
  name: string
  collectorNumber?: string
  quantity?: number
  categories: string[]
  modifier?: ArchidektCardModifier
  options?: ArchidektCardModifier[]
  label?: string
}

/** A raw payload that also reads as the parsed deck response, as the client's one fetch does. */
export type ArchidektDeckFixture = ArchidektRawDeckResponse & ArchidektDeckResponse

/** The edition id a relation's card carries: `id * 100`. */
export function relationCardId(id: number): number {
  return id * 100
}

function relation(spec: RelationSpec): ArchidektRawCardEntry & ArchidektCardEntry {
  return {
    id: spec.id,
    quantity: spec.quantity ?? 1,
    modifier: spec.modifier ?? 'Normal',
    categories: spec.categories,
    companion: false,
    flippedDefault: false,
    label: spec.label ?? ',#656565',
    customCmc: null,
    card: {
      id: relationCardId(spec.id),
      uid: `uid-${spec.id}`,
      name: spec.name,
      collectorNumber: spec.collectorNumber ?? String(spec.id),
      options: spec.options ?? ['Normal'],
      oracleCard: { id: spec.id * 10, name: spec.name },
      edition: { editioncode: 'tst' },
    },
  }
}

/** A synthetic deck holding `relations`, under the deck's own `categories` definitions. */
export function archidektDeck(
  relations: readonly RelationSpec[],
  categories: ArchidektCategory[],
): ArchidektDeckFixture {
  return {
    id: 1,
    name: 'Test',
    owner: { id: 1, username: 'tester' },
    categories,
    cards: relations.map(relation),
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

/** The sections the deck parser reads a synthetic deck into — a push's old side. */
export function archidektDeckSections(deck: ArchidektDeckFixture): DeckSection[] {
  return parseArchidektDeckResponse(deck, String(deck.id)).sections
}

/** A client whose card search answers every name with edition 900 and `defaultCategory`. */
export function searchingClient(defaultCategory: string): ArchidektClient {
  const client: Pick<ArchidektClient, 'searchCards'> = {
    searchCards: async (query: ArchidektCardQuery): Promise<ArchidektCardSearchResult> => ({
      id: 900,
      collectorNumber: '1',
      options: ['Normal'],
      oracleCard: { name: query.name, defaultCategory },
    }),
  }
  return client as ArchidektClient
}
