import path from 'node:path'
import { createDefaultFileSystemClient, type FileSystemClient } from '../util/interfaces'
import { isCardBulkType, type CardBulkType } from '../scryfall/bulk-manifest'
import { getCacheDir } from './file-cache'
import { writeFileAtomic } from './atomic-write'

/**
 * Card-cache bulk provenance: which Scryfall bulk (`default_cards` or
 * `all_cards`) last built the card cache.
 *
 * Recorded in a sidecar file (`cache/card-bulk.json`) rather than inside
 * `cache.json`'s metadata block deliberately: the card cache is read through
 * the `CacheManager` interface, which several backends implement (file,
 * runtime, cache-server HTTP), and provenance is a property of the *local
 * cache directory's* last bulk ingest — exactly like `tags.json` — not
 * something every backend must be taught to round-trip.
 *
 * A missing or unreadable sidecar reads as `null` ("unrecorded"), which
 * consumers treat as `default_cards`: every cache built before provenance
 * existed was built from that bulk.
 */

const PROVENANCE_FILENAME = 'card-bulk.json'

const defaultFileSystem = createDefaultFileSystemClient()

/** The persisted provenance record. */
export type CardBulkProvenance = {
  bulkType: CardBulkType
  /** ISO-8601 time the bulk finished ingesting. */
  recordedAt: string
}

function provenancePath(): string {
  return path.join(getCacheDir(), PROVENANCE_FILENAME)
}

/**
 * Validate and parse a persisted provenance record. Returns an error string
 * (never throws) when the shape is wrong, per the parser conventions in
 * AGENTS.md — callers treat a malformed record as "unrecorded".
 */
export function parseCardBulkProvenance(json: unknown): CardBulkProvenance | string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return 'Invalid card-bulk provenance: expected an object'
  }
  const record = json as Record<string, unknown>
  if (typeof record['bulkType'] !== 'string' || !isCardBulkType(record['bulkType'])) {
    return `Invalid card-bulk provenance: unknown bulkType '${String(record['bulkType'])}'`
  }
  if (typeof record['recordedAt'] !== 'string') {
    return 'Invalid card-bulk provenance: missing string recordedAt'
  }
  return { bulkType: record['bulkType'], recordedAt: record['recordedAt'] }
}

/**
 * Which bulk last built the card cache, or `null` when no bulk ingest has
 * recorded provenance (an empty or pre-provenance cache — the latter was
 * necessarily built from `default_cards`).
 */
export async function readRecordedCardBulkType(
  fileSystem: FileSystemClient = defaultFileSystem,
): Promise<CardBulkType | null> {
  let raw: string
  try {
    raw = await fileSystem.readFile(provenancePath(), 'utf-8')
  } catch {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = parseCardBulkProvenance(json)
  return typeof parsed === 'string' ? null : parsed.bulkType
}

/** Injectable seams for {@link recordCardBulkType}. */
export type RecordCardBulkTypeOptions = {
  /** Where to write — the ScryfallClient passes its own injected file system. */
  fileSystem?: FileSystemClient
  now?: () => Date
}

/** Record which bulk just built the card cache. Called after a bulk ingest completes. */
export async function recordCardBulkType(
  bulkType: CardBulkType,
  options: RecordCardBulkTypeOptions = {},
): Promise<void> {
  const fileSystem = options.fileSystem ?? defaultFileSystem
  const now = options.now ?? ((): Date => new Date())
  const record: CardBulkProvenance = { bulkType, recordedAt: now().toISOString() }
  await fileSystem.mkdir(getCacheDir(), { recursive: true })
  await writeFileAtomic(fileSystem, provenancePath(), JSON.stringify(record, null, 2))
}
