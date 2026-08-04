import { getErrorMessage } from '../../errors'
import { getBaseDir } from '../../base-dir'
import { applyDeckMetadata, DECK_METADATA_KEYS, type DeckMetadataPatch } from '../../deck-metadata'
import {
  applyCollectionMetadata,
  COLLECTION_METADATA_KEYS,
  type CollectionMetadataPatch,
} from '../../flat-list-metadata'
import { parseCardLabelsValue } from '../../card-labels'
import { checkArchidektLink } from '../../deck-sync/link'
import { invalidDeckFormatMessage, parseDeckFormat } from '../../deck-format'
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
 * Decks accept the deck vocabulary (description/tags/format/source link);
 * collections accept `labels` (their default card labels). Wanted lists define
 * no front-matter keys, so they are refused with a 400 rather than silently
 * accepting a write with nothing to say.
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

/** The validated body: the field patch plus the optional concurrency token. */
export type ParsedDeckMetadataBody = {
  patch: DeckMetadataPatch
  contentHash?: string
}

/** The collection front-matter fields this route may write. `null` clears a field. */
export type CollectionMetadataRequest = {
  labels?: string[] | null
  /** Optional optimistic-concurrency token from `GET /api/collection/:slug`. */
  contentHash?: string
}

/** The validated collection body: the field patch plus the optional concurrency token. */
export type ParsedCollectionMetadataBody = {
  patch: CollectionMetadataPatch
  contentHash?: string
}

/** `PUT /api/metadata/:type/:slug` success body. */
export type MetadataResponse = {
  success: true
  slug: string
  /**
   * The full front matter after the write, unknown keys included. Deck writes
   * produce the `DeckFrontMatter` shape; collection writes the collection one.
   */
  frontMatter: Record<string, unknown>
  contentHash: string
}

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

/** The envelope every metadata body shares: the optional concurrency token. */
type MetadataEnvelope = { contentHash?: string }

/**
 * The shared prologue of both body parsers: refuse unknown keys — so a typo
 * silently writing nothing is impossible — and validate the optional
 * `contentHash` token here rather than letting the handler recover it (a
 * malformed token must fail the request, not quietly skip the concurrency
 * check). Per-surface rejection messages come from `rejectedKeys`.
 */
function parseMetadataEnvelope(
  raw: Record<string, unknown>,
  acceptedKeys: readonly string[],
  rejectedKeys?: Record<string, string>,
): MetadataEnvelope | string {
  for (const key of Object.keys(raw)) {
    if (key === 'contentHash') continue
    const rejected = rejectedKeys?.[key]
    if (rejected !== undefined) return rejected
    if (!acceptedKeys.includes(key)) {
      return `Unknown metadata field '${key}'. Accepted fields: ${acceptedKeys.join(', ')}.`
    }
  }
  if (raw.contentHash !== undefined) {
    if (typeof raw.contentHash !== 'string') return 'contentHash must be a string.'
    return { contentHash: raw.contentHash }
  }
  return {}
}

/**
 * Validate an untrusted request body object into a {@link ParsedDeckMetadataBody},
 * or return the error message explaining why it is not usable. The object guard
 * itself is the shared route prologue's job ({@link readJsonObjectBody}); this
 * validates the fields.
 */
export function parseDeckMetadataBody(
  raw: Record<string, unknown>,
): ParsedDeckMetadataBody | string {
  const patch: DeckMetadataPatch = {}

  const envelope = parseMetadataEnvelope(raw, DECK_METADATA_KEYS, REJECTED_KEYS)
  if (typeof envelope === 'string') return envelope
  const { contentHash } = envelope

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
      // An empty set says nothing; clear the key rather than writing `[]` —
      // the same rule `labels` and an empty `description` follow, so "has this
      // deck any tags?" reads the same as "has this collection a default?".
      patch.tags = tags.length === 0 ? null : tags
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
 * Validate an untrusted request body object into a
 * {@link ParsedCollectionMetadataBody}, or return the error message explaining
 * why it is not usable. Same contract as {@link parseDeckMetadataBody}: unknown
 * keys are refused outright, and `contentHash` is validated here.
 */
export function parseCollectionMetadataBody(
  raw: Record<string, unknown>,
): ParsedCollectionMetadataBody | string {
  const patch: CollectionMetadataPatch = {}

  const envelope = parseMetadataEnvelope(raw, COLLECTION_METADATA_KEYS)
  if (typeof envelope === 'string') return envelope
  const { contentHash } = envelope

  if ('labels' in raw) {
    if (raw.labels === null) {
      patch.labels = null
    } else {
      const labels = parseCardLabelsValue(raw.labels, 'labels')
      if (!labels.ok) return labels.message
      // An empty array says "no default"; clear the key rather than writing `[]`.
      patch.labels = labels.labels.length === 0 ? null : labels.labels
    }
  }

  return contentHash === undefined ? { patch } : { patch, contentHash }
}

/**
 * `PUT /api/metadata/:type/:slug` — replace the given front-matter fields on a
 * list, leaving the card lines untouched. Decks take the deck vocabulary below;
 * collections take `labels` (cleared by `null` or `[]`), validated against the
 * label vocabulary and the keep-exclusivity rule.
 *
 * Only the fields present in the body are written; a field sent as `null` (or an
 * empty string, for `description`) is deleted. Every other key round-trips,
 * except those the stored file spells with the wrong type — dropped by
 * `parseDeckFrontMatter`, exactly as a full deck save would drop them. No
 * changelog entry is recorded — the changelog is card-level, and metadata is not
 * a card change. Setting `sourceId` + an `archidekt.com` `sourceUrl` is what
 * makes a deck sync-linked, so these fields change what `POST /api/deck-sync`
 * operates on — and the two must name the same Archidekt deck once merged (a
 * mismatch is a 400; see {@link checkArchidektLink}).
 */
export async function handleMetadataSave(req: Request): Promise<Response> {
  try {
    const target = parseListTarget(req)
    if (typeof target === 'string') return apiError(target, 400)
    if (target.type === 'wanted') {
      return apiError(
        'Wanted lists carry no metadata. Use POST /api/wanted/:slug/rename to change the display name.',
        400,
      )
    }

    const read = await readJsonObjectBody(req)
    if (!read.ok) return read.response

    if (target.type === 'collection') {
      const parsed = parseCollectionMetadataBody(read.body)
      if (typeof parsed === 'string') return apiError(parsed, 400)

      const filePath = await resolveListFile('collection', target.slug)
      if (!filePath) return apiError(`Collection '${target.slug}' not found`, 404)

      if (parsed.contentHash !== undefined) {
        const validation = await validateContentHash(filePath, parsed.contentHash, 'Collection')
        if (!validation.valid) return validation.response
      }

      const write = await applyCollectionMetadata(filePath, parsed.patch)
      if (typeof write === 'string') return apiError(write, 400)

      await autoCommitAndPush(
        getBaseDir(),
        write.writtenFiles,
        `Update metadata for collection ${target.slug}`,
      )

      const response: MetadataResponse = {
        success: true,
        slug: target.slug,
        frontMatter: write.frontMatter,
        contentHash: write.contentHash,
      }
      return Response.json(response)
    }

    const parsed = parseDeckMetadataBody(read.body)
    if (typeof parsed === 'string') return apiError(parsed, 400)

    const filePath = await resolveListFile('deck', target.slug)
    if (!filePath) return apiError(`Deck '${target.slug}' not found`, 404)

    if (parsed.contentHash !== undefined) {
      const validation = await validateContentHash(filePath, parsed.contentHash, 'Deck')
      if (!validation.valid) return validation.response
    }

    // The merged result is what is validated, not the patch: a body that sets
    // only `sourceId` still has to agree with the `sourceUrl` already on the file.
    const write = await applyDeckMetadata(filePath, parsed.patch, checkArchidektLink)
    if (typeof write === 'string') return apiError(write, 400)
    const { frontMatter: merged, contentHash } = write

    await autoCommitAndPush(
      getBaseDir(),
      write.writtenFiles,
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
