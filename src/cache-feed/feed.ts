export const FEED_VERSION = 1
export const FEED_FILENAME = 'feed.json'

/** The bulk artifacts a cache feed distributes. */
export type CacheFeedKind = 'default-cards' | 'oracle-tags' | 'art-tags'

export const FEED_KINDS: readonly CacheFeedKind[] = ['default-cards', 'oracle-tags', 'art-tags']

/** Scryfall bulk-data manifest `type` for each feed kind. */
export const BULK_TYPE_BY_KIND: Record<CacheFeedKind, string> = {
  'default-cards': 'default_cards',
  'oracle-tags': 'oracle_tags',
  'art-tags': 'art_tags',
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
