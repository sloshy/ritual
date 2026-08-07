/**
 * Synthetic data for the collection-sync unit tests: local card lines, remote
 * Archidekt records, and cached printings. Nothing here touches the network,
 * the Scryfall cache, or the filesystem — every seam the engine exposes is fed
 * from these builders.
 */

import {
  ARCHIDEKT_LANGUAGE_ENGLISH,
  type ArchidektCollectionPage,
  type ArchidektCollectionRecord,
  type ArchidektCollectionTag,
} from '../../../src/importers/archidekt-collection'
import type { CollectionEntry } from '../../../src/collection-file'
import type { CardLanguage } from '../../../src/card-language'
import type { CardPrintingsLookup } from '../../../src/card-printing'
import { DEFAULT_SECTION, type Condition, type Finish, type ScryfallCard } from '../../../src/types'

/** Optional fields of a synthetic collection line. */
export type EntryOptions = {
  finish?: Finish
  condition?: Condition
  /** The line's `[ja]`-style token; absent means a bare (English) line. */
  language?: CardLanguage
  cardId?: number
  note?: string
  section?: string
}

/** One card line, as `parseCollectionFile` would have produced it (one copy per line). */
export function entry(
  name: string,
  set: string,
  collectorNumber: string,
  options: EntryOptions = {},
): CollectionEntry {
  return {
    name,
    quantity: 1,
    set: set.toLowerCase(),
    collectorNumber,
    section: options.section ?? DEFAULT_SECTION,
    finish: options.finish,
    condition: options.condition,
    language: options.language,
    cardId: options.cardId,
    note: options.note,
  }
}

export type RecordOptions = {
  id: number
  name: string
  set: string
  collectorNumber: string
  quantity?: number
  /** Wire value, so tests can feed an unparseable one. */
  modifier?: string
  /** Archidekt condition id (1–5). */
  condition?: number
  language?: number
  /** Archidekt printing id, sent as `card` on an upsert. */
  archidektCardId?: number
  /** Scryfall uid; defaults to a stable id derived from the set and number. */
  uid?: string
  tags?: ArchidektCollectionTag[]
  purchasePrice?: number | null
}

/** One Archidekt collection record. */
export function record(options: RecordOptions): ArchidektCollectionRecord {
  return {
    id: options.id,
    quantity: options.quantity ?? 1,
    modifier: options.modifier ?? 'Normal',
    language: options.language ?? ARCHIDEKT_LANGUAGE_ENGLISH,
    condition: options.condition ?? 1,
    purchasePrice: options.purchasePrice ?? null,
    tags: options.tags ?? [],
    createdAt: '2026-07-01T00:00:00Z',
    modifiedAt: '2026-07-01T00:00:00Z',
    card: {
      id: options.archidektCardId ?? options.id * 10,
      uid: options.uid ?? `${options.set.toLowerCase()}-${options.collectorNumber}`,
      collectorNumber: options.collectorNumber,
      options: ['Normal', 'Foil'],
      oracleCard: { id: options.id, name: options.name },
      edition: { editioncode: options.set.toLowerCase() },
    },
  }
}

/**
 * The synthetic Archidekt account every sync test runs against. Deliberately not
 * a real account id: a checked-in fixture must never be something a test could
 * be pointed at for real.
 */
export const TEST_ACCOUNT = { id: 424242, username: 'test-user' } as const

/** One page of a collection response, holding the given records. */
export function collectionPage(
  records: ArchidektCollectionRecord[],
  page = 1,
  totalPages = 1,
  next: string | null = null,
): ArchidektCollectionPage {
  return {
    count: records.length,
    results: records,
    next,
    previous: null,
    page,
    totalPages,
    tags: [],
    isPublic: true,
    owner: { ...TEST_ACCOUNT, avatar: '' },
  }
}

/**
 * The Scryfall id {@link printing} gives a card: a UUID-shaped value keyed by set
 * and collector number, but **not** reconstructible from them. A CSV upload's uid
 * cell has to come from the cached printing rather than from the line's own set
 * and number, and an id spelled `ltc-284` would let either pass.
 */
export function printingId(set: string, collectorNumber: string): string {
  const digits = [...`${set.toLowerCase()}${collectorNumber.toLowerCase()}`]
    .map((char) => char.codePointAt(0)!.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
    .padEnd(12, '0')
  return `00000000-0000-4000-8000-${digits}`
}

/** A cached printing, carrying only the fields the sync reads. */
export function printing(
  name: string,
  set: string,
  collectorNumber: string,
  finishes: string[],
): ScryfallCard {
  return {
    id: printingId(set, collectorNumber),
    name,
    cmc: 0,
    type_line: 'Artifact',
    prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    finishes,
    games: ['paper'],
    set: set.toLowerCase(),
    set_name: set.toUpperCase(),
    collector_number: collectorNumber,
    rarity: 'rare',
    color_identity: [],
  }
}

/**
 * A name → printings lookup over the given cards. Names the map does not hold
 * resolve to no printings, which is how a card missing from the cache reads.
 */
export function printingsLookup(cards: ScryfallCard[]): CardPrintingsLookup {
  const byName = new Map<string, ScryfallCard[]>()
  for (const card of cards) {
    const key = card.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), card])
  }
  return (name: string) => Promise.resolve(byName.get(name.toLowerCase()) ?? [])
}

/** A lookup that holds nothing — every finish falls back, every name stays as given. */
export const noPrintings: CardPrintingsLookup = () => Promise.resolve([])
