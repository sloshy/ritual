import type { CardBulkType } from '../scryfall/bulk-manifest'

export const FEED_VERSION = 1
export const FEED_FILENAME = 'feed.json'

/**
 * The card-bulk artifacts a feed can distribute: `default-cards` mirrors
 * Scryfall's English-only `default_cards` bulk, `all-cards` the every-language
 * `all_cards` bulk. A host publishes the card kind(s) it is configured for,
 * and each client fetches exactly the one its `defaultLanguage` demands.
 */
export type CardFeedKind = 'default-cards' | 'all-cards'

export const CARD_FEED_KINDS: readonly CardFeedKind[] = ['default-cards', 'all-cards']

/** The bulk artifacts a cache feed distributes. */
export type CacheFeedKind = CardFeedKind | 'oracle-tags' | 'art-tags'

export const FEED_KINDS: readonly CacheFeedKind[] = [
  'default-cards',
  'all-cards',
  'oracle-tags',
  'art-tags',
]

/** The tag artifacts every host publishes and every client fetches. */
export const TAG_FEED_KINDS: readonly CacheFeedKind[] = ['oracle-tags', 'art-tags']

/** Scryfall bulk-data manifest `type` for each feed kind. */
export const BULK_TYPE_BY_KIND: Record<CacheFeedKind, string> = {
  'default-cards': 'default_cards',
  'all-cards': 'all_cards',
  'oracle-tags': 'oracle_tags',
  'art-tags': 'art_tags',
}

/** The feed kind that carries a given Scryfall card bulk. */
export const CARD_KIND_BY_BULK_TYPE: Record<CardBulkType, CardFeedKind> = {
  default_cards: 'default-cards',
  all_cards: 'all-cards',
}

/** The Scryfall card bulk a card feed kind carries (the typed inverse of the above). */
export const CARD_BULK_TYPE_BY_KIND: Record<CardFeedKind, CardBulkType> = {
  'default-cards': 'default_cards',
  'all-cards': 'all_cards',
}

/** One distributable artifact in a cache feed. */
export type CacheFeedEntry = {
  kind: CacheFeedKind
  /** On-disk (and in-torrent) file name, e.g. `default-cards-20260705090855.jsonl.gz`. */
  fileName: string
  /** BitTorrent v1 info hash of the artifact's torrent. */
  infoHash: string
  /** Magnet URI including the web-seed (`ws=`) fallback URL. */
  magnet: string
  /** File size in bytes. */
  length: number
  /** Whole-file SHA-256 (hex), verified by clients after download. */
  sha256: string
  /** Scryfall's `updated_at` for this bulk file — the change-detection key. */
  scryfallUpdatedAt: string
  /** When this host published the entry (ISO 8601). */
  publishedAt: string
  /** Direct HTTP URL of the artifact (also the torrent's web seed). */
  fileUrl: string
  /** URL of the `.torrent` file. */
  torrentUrl: string
}

/** The feed document served at `/feed.json`. */
export type CacheFeedDocument = {
  version: number
  generatedAt: string
  entries: CacheFeedEntry[]
}

function isFeedKind(value: unknown): value is CacheFeedKind {
  return typeof value === 'string' && (FEED_KINDS as readonly string[]).includes(value)
}

function parseFeedEntry(value: unknown, index: number): CacheFeedEntry | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `Invalid cache feed: entry ${index} is not an object`
  }
  const entry = value as Record<string, unknown>
  if (!isFeedKind(entry['kind'])) {
    return `Invalid cache feed: entry ${index} has unknown kind '${String(entry['kind'])}'`
  }
  for (const field of [
    'fileName',
    'infoHash',
    'magnet',
    'sha256',
    'scryfallUpdatedAt',
    'publishedAt',
    'fileUrl',
    'torrentUrl',
  ]) {
    if (typeof entry[field] !== 'string' || entry[field].length === 0) {
      return `Invalid cache feed: entry ${index} is missing a string ${field}`
    }
  }
  if (typeof entry['length'] !== 'number' || entry['length'] <= 0) {
    return `Invalid cache feed: entry ${index} is missing a positive numeric length`
  }
  return value as CacheFeedEntry
}

/**
 * Validate and parse a cache feed document (e.g. fetched from a feed URL).
 * Returns an error string (never throws) when the payload is malformed, per
 * the parser conventions in AGENTS.md.
 */
export function parseCacheFeed(json: unknown): CacheFeedDocument | string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return 'Invalid cache feed: expected an object'
  }
  const doc = json as Record<string, unknown>
  if (doc['version'] !== FEED_VERSION) {
    return `Invalid cache feed: unsupported version ${String(doc['version'])} (expected ${FEED_VERSION})`
  }
  if (typeof doc['generatedAt'] !== 'string') {
    return 'Invalid cache feed: missing string generatedAt'
  }
  if (!Array.isArray(doc['entries'])) {
    return 'Invalid cache feed: missing entries array'
  }
  const entries: CacheFeedEntry[] = []
  for (let i = 0; i < doc['entries'].length; i++) {
    const parsed = parseFeedEntry(doc['entries'][i], i)
    if (typeof parsed === 'string') return parsed
    entries.push(parsed)
  }
  return { version: FEED_VERSION, generatedAt: doc['generatedAt'], entries }
}
