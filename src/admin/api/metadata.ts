import { getErrorMessage } from '../../errors'
import { getBaseDir } from '../../base-dir'
import { hashPath } from '../../content-hash'
import { parseDeckFrontMatter, writeDeckFrontMatter, type DeckFrontMatter } from '../../deck-file'
import { invalidDeckFormatMessage, parseDeckFormat, type DeckFormatKey } from '../../deck-format'
import { parseListTarget } from './target'
import { resolveListFile } from './list-info'
import {
  apiError,
  autoCommitAndPush,
  readJsonObjectBody,
  validateContentHash,
} from './save-helpers'

/**
 * `PUT /api/metadata/:type/:slug` — write a list's front matter.
 *
 * Decks only for now: collections and wanted lists carry no front matter (their
 * serializer would drop any YAML on the next save), so they are refused with a
 * 400 rather than silently accepting a write that would not survive.
 */

/** The deck front-matter fields this route may write. `null` clears a field. */
export type DeckMetadataRequest = {
  description?: string | null
  tags?: string[] | null
  format?: string | null
  sourceId?: string | null
  sourceUrl?: string | null
  /** Optional optimistic-concurrency token from `GET /api/deck/:slug`. */
  contentHash?: string
}

/**
 * The validated patch. An absent key is left alone; a key mapped to `null` is
 * deleted from the front matter; any other value is written. `null` (rather than
 * a present-but-`undefined` key) encodes the clear so the distinction survives
 * structural equality, spreads, and JSON.
 */
export type DeckMetadataPatch = {
  description?: string | null
  tags?: string[] | null
  format?: DeckFormatKey | null
  sourceId?: string | null
  sourceUrl?: string | null
}

/** A key a metadata write accepts. */
export type DeckMetadataKey = (typeof DECK_METADATA_KEYS)[number]

/** The validated body: the field patch plus the optional concurrency token. */
export type ParsedDeckMetadataBody = {
  patch: DeckMetadataPatch
  contentHash?: string
}

/** `PUT /api/metadata/:type/:slug` success body. */
export type MetadataResponse = {
  success: true
  slug: string
  /** The full front matter after the write. */
  frontMatter: DeckFrontMatter
  contentHash: string
}

/** The keys a metadata write accepts, in the order the error message lists them. */
export const DECK_METADATA_KEYS = [
  'description',
  'tags',
  'format',
  'sourceId',
  'sourceUrl',
] as const

/** The message for `name`, which must go through the rename route so the file follows. */
const NAME_REJECTED_MESSAGE =
  "name cannot be set here — a list's display name is changed with POST /api/deck/:slug/rename, " +
  'which also renames the file and its sidecars.'

/** Keys that exist in deck front matter but are not user-editable metadata. */
const REJECTED_KEYS: Record<string, string> = {
  name: NAME_REJECTED_MESSAGE,
  created: 'created is stamped when the deck is created and cannot be edited.',
  lastSynced: 'lastSynced is stamped by deck sync and cannot be edited.',
}

/**
 * Validate an untrusted request body object into a {@link ParsedDeckMetadataBody},
 * or return the error message explaining why it is not usable. The object guard
 * itself is the shared route prologue's job ({@link readJsonObjectBody}); this
 * validates the fields. Unknown keys are refused outright so a typo silently
 * writing nothing is impossible, and
 * `contentHash` is validated here rather than recovered by the handler — a
 * malformed token must fail the request, not quietly skip the concurrency check.
 */
export function parseDeckMetadataBody(
  raw: Record<string, unknown>,
): ParsedDeckMetadataBody | string {
  const patch: DeckMetadataPatch = {}

  for (const key of Object.keys(raw)) {
    if (key === 'contentHash') continue
    const rejected = REJECTED_KEYS[key]
    if (rejected !== undefined) return rejected
    if (!(DECK_METADATA_KEYS as readonly string[]).includes(key)) {
      return `Unknown metadata field '${key}'. Accepted fields: ${DECK_METADATA_KEYS.join(', ')}.`
    }
  }

  let contentHash: string | undefined
  if ('contentHash' in raw && raw.contentHash !== undefined) {
    if (typeof raw.contentHash !== 'string') return 'contentHash must be a string.'
    contentHash = raw.contentHash
  }

  if ('description' in raw) {
    if (raw.description === null) {
      patch.description = null
    } else {
      if (typeof raw.description !== 'string') return 'description must be a string or null.'
      const trimmed = raw.description.trim()
      // An empty description says nothing; clear the key rather than writing `''`.
      patch.description = trimmed === '' ? null : trimmed
    }
  }

  if ('tags' in raw) {
    if (raw.tags === null) {
      patch.tags = null
    } else {
      if (!Array.isArray(raw.tags)) return 'tags must be an array of strings or null.'
      const tags: string[] = []
      for (const tag of raw.tags) {
        if (typeof tag !== 'string' || tag.trim() === '') {
          return 'tags must be an array of non-empty strings.'
        }
        const trimmed = tag.trim()
        if (!tags.includes(trimmed)) tags.push(trimmed)
      }
      patch.tags = tags
    }
  }

  if ('format' in raw) {
    if (raw.format === null) {
      patch.format = null
    } else {
      const format = parseDeckFormat(raw.format)
      if (!format) return invalidDeckFormatMessage(raw.format)
      patch.format = format
    }
  }

  if ('sourceId' in raw) {
    if (raw.sourceId === null) {
      patch.sourceId = null
    } else {
      if (typeof raw.sourceId !== 'string' || raw.sourceId.trim() === '') {
        return 'sourceId must be a non-empty string or null.'
      }
      patch.sourceId = raw.sourceId.trim()
    }
  }

  if ('sourceUrl' in raw) {
    if (raw.sourceUrl === null) {
      patch.sourceUrl = null
    } else {
      if (typeof raw.sourceUrl !== 'string') return 'sourceUrl must be an http(s) URL.'
      const trimmed = raw.sourceUrl.trim()
      let parsed: URL
      try {
        parsed = new URL(trimmed)
      } catch {
        return 'sourceUrl must be an http(s) URL.'
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'sourceUrl must be an http(s) URL.'
      }
      patch.sourceUrl = trimmed
    }
  }

  return contentHash === undefined ? { patch } : { patch, contentHash }
}

/**
 * Apply one patched field to the front matter being built. Absent leaves the
 * existing value alone; `null` deletes the key outright (the write helper dumps
 * the object straight to YAML, so leaving it would persist a literal `null`).
 */
function applyField<K extends DeckMetadataKey>(
  target: DeckFrontMatter,
  key: K,
  value: DeckMetadataPatch[K],
): void {
  if (value === undefined) return
  if (value === null) delete target[key]
  // The patch's value type for `key` is exactly the front matter's, but TS cannot
  // relate two indexed accesses through an unresolved `K`.
  else (target as Record<DeckMetadataKey, unknown>)[key] = value
}

/** Merge a validated patch over existing front matter. */
function mergeFrontMatter(existing: DeckFrontMatter, patch: DeckMetadataPatch): DeckFrontMatter {
  const merged: DeckFrontMatter = { ...existing }
  for (const key of DECK_METADATA_KEYS) {
    applyField(merged, key, patch[key])
  }
  return merged
}

/**
 * `PUT /api/metadata/:type/:slug` — replace the given front-matter fields on a
 * deck, leaving the card lines untouched.
 *
 * Only the fields present in the body are written; a field sent as `null` (or an
 * empty string, for `description`) is deleted. Every other key round-trips, with
 * one exception inherited from `parseDeckFrontMatter`: a `format` the canonical
 * parser rejects is dropped, exactly as a full deck save would drop it. No
 * changelog entry is recorded — the changelog is card-level, and metadata is not
 * a card change. Setting `sourceId` + an `archidekt.com` `sourceUrl` is what
 * makes a deck sync-linked, so these fields change what `POST /api/deck-sync`
 * operates on.
 */
export async function handleMetadataSave(req: Request): Promise<Response> {
  try {
    const target = parseListTarget(req)
    if (typeof target === 'string') return apiError(target, 400)
    if (target.type !== 'deck') {
      return apiError(
        'Collections and wanted lists carry no metadata. Use POST /api/<type>/:slug/rename to change the display name.',
        400,
      )
    }

    const read = await readJsonObjectBody(req)
    if (!read.ok) return read.response

    const parsed = parseDeckMetadataBody(read.body)
    if (typeof parsed === 'string') return apiError(parsed, 400)

    const filePath = await resolveListFile('deck', target.slug)
    if (!filePath) return apiError(`Deck '${target.slug}' not found`, 404)

    if (parsed.contentHash !== undefined) {
      const validation = await validateContentHash(filePath, parsed.contentHash, 'Deck')
      if (!validation.valid) return validation.response
    }

    const existing = await parseDeckFrontMatter(filePath)
    const merged = mergeFrontMatter(existing, parsed.patch)
    const contentHash = await writeDeckFrontMatter(filePath, merged)

    await autoCommitAndPush(
      getBaseDir(),
      [filePath, hashPath(filePath)],
      `Update metadata for deck ${target.slug}`,
    )

    const response: MetadataResponse = {
      success: true,
      slug: target.slug,
      frontMatter: merged,
      contentHash,
    }
    return Response.json(response)
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}
