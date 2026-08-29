import { getErrorMessage } from '../../util/errors'
import { getBaseDir } from '../../config/base-dir'
import {
  applyDeckMetadata,
  DECK_METADATA_KEYS,
  type DeckMetadataPatch,
} from '../../list/deck-metadata'
import {
  applyFlatListMetadata,
  FLAT_LIST_METADATA_KEYS,
  type FlatListMetadataPatch,
  type FlatListType,
} from '../../list/flat-list-metadata'
import { isListImageRefError, parseListImage, type ListImageRef } from '../../list/list-image'
import { isListDescriptionError, parseListDescription } from '../../list/list-description'
import { checkListImageCardId } from '../../list/list-image-file'
import {
  LIST_TYPE_LABELS,
  parseCardLabelsValue,
  unsupportedLabelsFor,
  type CardLabel,
} from '../../card/card-labels'
import type { ListType } from '../../list/list-type'
import { checkArchidektLink } from '../../deck-sync/link'
import { invalidDeckFormatMessage, parseDeckFormat } from '../../list/deck-format'
import { parseListTarget } from './target'
import { resolveListFile } from './list-info'
import { apiError, readJsonObjectBody } from '../../api/http'
import { autoCommitAndPush, validateContentHash } from './save-helpers'
import { MAX_LIST_BODY_SIZE } from '../validation'

/**
 * `PUT /api/metadata/:type/:slug` — write a list's front matter.
 *
 * Decks accept the deck vocabulary (tags/format/source link) plus `labels`
 * (their default card labels, `proxy` alone); collections accept `labels` over
 * the whole label vocabulary. **All three list types** accept `description`, the
 * prose blurb the site prints above the cards, and `image`, a list's cover
 * override — the two keys that make a wanted list worth writing to at all.
 *
 * `image` speaks exactly the front matter's own grammar (`{card}`/`{file}`/`{url}`,
 * `null` to clear), so a body, a hand-edited file, an MCP call and the admin
 * modal all share one value space with no second spelling to keep in step. A
 * `card` reference is verified against the very file being written — that is the
 * one existence check this route performs, and it lives here so every client
 * inherits the same 400 rather than re-implementing it.
 */

/** The deck front-matter fields this route may write. `null` clears a field. */
export type DeckMetadataRequest = {
  description?: string | null
  tags?: string[] | null
  format?: string | null
  /** The deck's default card labels; `null` or `[]` clears them. Decks accept `proxy` only. */
  labels?: string[] | null
  /**
   * The deck's cover image override, in the front matter's own mapping form;
   * `null` clears it and restores the built-in rule. There is no scalar
   * spelling — see `list-image.ts`.
   */
  image?: ListImageRef | null
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

/**
 * The flat-list (collection | wanted) front-matter fields this route may write.
 * `null` clears a field. The vocabulary is per type — a wanted list takes
 * `description` and `image`, and a `labels` key on one is refused by name — so
 * this shape is the union of both and {@link parseFlatListMetadataBody} narrows
 * it.
 */
export type FlatListMetadataRequest = {
  /** The list's prose blurb; `null` or `''` clears it. */
  description?: string | null
  labels?: string[] | null
  /** The list's cover image override; see {@link DeckMetadataRequest.image}. */
  image?: ListImageRef | null
  /** Optional optimistic-concurrency token from `GET /api/{collection,wanted}/:slug`. */
  contentHash?: string
}

/** The validated flat-list body: the field patch plus the optional concurrency token. */
export type ParsedFlatListMetadataBody = {
  patch: FlatListMetadataPatch
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

/** Keys that exist in deck front matter but are not user-editable metadata. */
const REJECTED_KEYS: Record<string, string> = {
  lastSynced: 'lastSynced is stamped by deck sync and cannot be edited.',
}

/**
 * How each flat list type is named in this route's refusals — capitalized
 * English, the same labels the collection and wanted save routes hand
 * {@link validateContentHash}, so a 404 and a 409 on the same list agree.
 */
const FLAT_LIST_LABELS: Record<FlatListType, string> = {
  collection: 'Collection',
  wanted: 'Wanted list',
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
 * Validate a request body's `labels` value as a list's default card labels for
 * `type`: `null` (or an empty array) clears the key, anything else must name
 * labels that type carries. Returns the patch value, or the message explaining
 * the refusal. Shared by both body parsers so a deck and a collection refuse an
 * illegal label set identically.
 */
function parseListDefaultLabels(raw: unknown, type: ListType): CardLabel[] | null | string {
  if (raw === null) return null
  const labels = parseCardLabelsValue(raw, 'labels')
  if (!labels.ok) return labels.message
  const unsupported = unsupportedLabelsFor(type, labels.labels)
  if (unsupported.length > 0) {
    return `labels [${unsupported.join(', ')}] are not supported on a ${type}; supported: ${LIST_TYPE_LABELS[type].join(', ')}.`
  }
  // An empty array says "no default"; clear the key rather than writing `[]`.
  return labels.labels.length === 0 ? null : labels.labels
}

/**
 * A validated `description` field: the value to store (`null` clears the key),
 * or the message explaining the refusal. A discriminated pair rather than
 * `string | null | string` because the value and the refusal are both strings.
 */
type DescriptionField = { ok: true; value: string | null } | { ok: false; error: string }

/**
 * Validate a request body's `description` value: `null` — or a string that is
 * blank once trimmed, since an empty description says nothing — clears the key,
 * any other string is stored trimmed. The refusal is `list-description.ts`'s own
 * wording, forwarded verbatim for the reason {@link parseListImageField} states:
 * a hand-edited file's bad `description:` reports the same sentence, so a user
 * reading either sees one wording.
 */
function parseDescriptionField(raw: unknown): DescriptionField {
  const parsed = parseListDescription(raw)
  if (isListDescriptionError(parsed)) return { ok: false, error: parsed.error }
  return { ok: true, value: parsed }
}

/**
 * Validate a request body's `image` value as a list's cover override: `null`
 * clears the key, anything else must be the front matter's own single-key
 * mapping. Returns the patch value, or the message explaining the refusal —
 * verbatim from `list-image.ts`, which is the same text a hand-edited file's bad
 * `image:` reports, so a user reading either sees one wording.
 *
 * The reference's *validity* is checked here; whether a `card` id exists is
 * checked in the handler, which is the only place holding the file it names.
 */
function parseListImageField(raw: unknown): ListImageRef | null | string {
  const parsed = parseListImage(raw)
  if (parsed !== null && isListImageRefError(parsed)) return parsed.error
  return parsed
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
    const description = parseDescriptionField(raw.description)
    if (!description.ok) return description.error
    patch.description = description.value
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

  if ('labels' in raw) {
    const labels = parseListDefaultLabels(raw.labels, 'deck')
    if (typeof labels === 'string') return labels
    patch.labels = labels
  }

  if ('image' in raw) {
    const image = parseListImageField(raw.image)
    if (typeof image === 'string') return image
    patch.image = image
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
 * {@link ParsedFlatListMetadataBody}, or return the error message explaining why
 * it is not usable. Same contract as {@link parseDeckMetadataBody}: unknown keys
 * are refused outright, and `contentHash` is validated here.
 *
 * The accepted vocabulary comes from `type`, so a `labels` key on a wanted list
 * is refused **by name** ("Unknown metadata field 'labels'") rather than being
 * accepted into a patch the writer would then have to drop — a wanted list's
 * cards belong to nobody yet, so a default label says nothing about them.
 * `description` is not narrowed that way: both flat types print a blurb.
 */
export function parseFlatListMetadataBody(
  raw: Record<string, unknown>,
  type: FlatListType,
): ParsedFlatListMetadataBody | string {
  const patch: FlatListMetadataPatch = {}

  const envelope = parseMetadataEnvelope(raw, FLAT_LIST_METADATA_KEYS[type])
  if (typeof envelope === 'string') return envelope
  const { contentHash } = envelope

  if ('description' in raw) {
    const description = parseDescriptionField(raw.description)
    if (!description.ok) return description.error
    patch.description = description.value
  }

  if ('labels' in raw) {
    const labels = parseListDefaultLabels(raw.labels, type)
    if (typeof labels === 'string') return labels
    patch.labels = labels
  }

  if ('image' in raw) {
    const image = parseListImageField(raw.image)
    if (typeof image === 'string') return image
    patch.image = image
  }

  return contentHash === undefined ? { patch } : { patch, contentHash }
}

/**
 * `PUT /api/metadata/:type/:slug` — replace the given front-matter fields on a
 * list, leaving the card lines untouched. Decks take the deck vocabulary below;
 * decks and collections take `labels` (cleared by `null` or `[]`), validated
 * against the label vocabulary, the exclusivity rule, and what the list type
 * carries — a deck accepts `proxy` alone. All three types take `description` and
 * `image`, and a wanted list takes nothing else: it is served by the same
 * flat-list branch as a collection rather than refused.
 *
 * A `card`-mode `image` is verified against the file it is being written to and
 * refused with a 400 when no line carries that `&N` (see
 * {@link checkListImageCardId}); a `file`-mode path is deliberately not checked,
 * so the art may be added later.
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

    const read = await readJsonObjectBody(req, MAX_LIST_BODY_SIZE)
    if (!read.ok) return read.response

    if (target.type !== 'deck') {
      // One branch for both flat list types: they differ only in which keys
      // their vocabulary admits, which `parseFlatListMetadataBody` already knows.
      const parsed = parseFlatListMetadataBody(read.body, target.type)
      if (typeof parsed === 'string') return apiError(parsed, 400)

      const filePath = await resolveListFile(target.type, target.slug)
      if (!filePath) {
        return apiError(`${FLAT_LIST_LABELS[target.type]} '${target.slug}' not found`, 404)
      }

      if (parsed.contentHash !== undefined) {
        const validation = await validateContentHash(
          filePath,
          parsed.contentHash,
          FLAT_LIST_LABELS[target.type],
        )
        if (!validation.valid) return validation.response
      }

      const badCardRef = await checkListImageCardId(filePath, parsed.patch.image)
      if (badCardRef !== null) return apiError(badCardRef, 400)

      const write = await applyFlatListMetadata(filePath, parsed.patch)
      if (typeof write === 'string') return apiError(write, 400)

      await autoCommitAndPush(
        getBaseDir(),
        write.writtenFiles,
        `Update metadata for ${target.type} ${target.slug}`,
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

    const badCardRef = await checkListImageCardId(filePath, parsed.patch.image)
    if (badCardRef !== null) return apiError(badCardRef, 400)

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
