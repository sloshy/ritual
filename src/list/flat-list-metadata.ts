/**
 * Writing a flat list's front-matter metadata — the one path every surface that
 * edits a collection's or wanted list's front matter goes through: the admin
 * route `PUT /api/metadata/:type/:slug` (and therefore the MCP
 * `set_list_metadata` tool) and the CLI. Mirrors `deck-metadata.ts` for decks.
 *
 * The write is front-matter only ({@link writeListFrontMatter}), so the card
 * lines — `&N` ids, label overrides, notes — survive byte for byte. Request
 * validation is the HTTP layer's job; what lives here is the vocabulary of
 * writable keys and how a patch merges. Unknown keys a user hand-authored into
 * the block round-trip untouched.
 *
 * The vocabulary is **per list type**: both carry a description and a cover
 * image, and a collection carries default card labels on top (labels say
 * nothing about cards nobody owns yet). That is why the key table is a map
 * rather than a flat union — a union would let the compiler accept `'labels'`
 * for a wanted list that refuses it at runtime.
 */

import fs from 'node:fs/promises'
import { readFrontMatterMapping, writeListFrontMatter } from './front-matter-write'
import { normalizeCardLabels, type CardLabel } from '../card/card-labels'
import { isListDescriptionError, parseListDescription } from './list-description'
import { serializeListImageRef, type ListImageRef } from './list-image'
import type { ListType } from './list-type'

/** The list types whose files carry a flat card list rather than deck sections. */
export type FlatListType = Extract<ListType, 'collection' | 'wanted'>

/**
 * The keys a metadata write accepts per flat list type, in the order error
 * messages list them. Declared `as const satisfies …` so the literals survive
 * for the "Accepted fields" message while the map stays exhaustive over the
 * flat list types.
 */
export const FLAT_LIST_METADATA_KEYS = {
  collection: ['description', 'labels', 'image'],
  wanted: ['description', 'image'],
} as const satisfies Record<FlatListType, readonly string[]>

/**
 * Merge a labels value into a front-matter mapping, returning a new mapping:
 * `null` (or an empty set) deletes the key, a non-empty set is written
 * normalized. The one merge rule behind the file-level write below and the CLI
 * editor's in-memory session edit, so the two can never disagree.
 */
export function applyLabelsPatch(
  data: Record<string, unknown>,
  labels: CardLabel[] | null,
): Record<string, unknown> {
  const merged = { ...data }
  if (labels === null || labels.length === 0) delete merged.labels
  else merged.labels = normalizeCardLabels(labels)
  return merged
}

/**
 * Merge a description into a front-matter mapping, returning a new mapping:
 * `null` — or text that is blank once trimmed — deletes the key, anything else
 * is written trimmed. The counterpart of {@link applyLabelsPatch} for the one
 * key every list type carries, and the owner of the blank-clears rule: the HTTP
 * parser normalizes too, but a value reaching this writer from anywhere else
 * must obey the same rule rather than persist a `description: ""`.
 */
export function applyDescriptionPatch(
  data: Record<string, unknown>,
  description: string | null,
): Record<string, unknown> {
  const merged = { ...data }
  const parsed = parseListDescription(description)
  // The error branch cannot occur — the argument is `string | null` — but a
  // grammar that later refuses some text must clear rather than write it.
  if (parsed === null || isListDescriptionError(parsed)) delete merged.description
  else merged.description = parsed
  return merged
}

/**
 * Merge a cover image into a front-matter mapping, returning a new mapping:
 * `null` deletes the key, a reference is written in its canonical single-key
 * mapping form. The counterpart of {@link applyLabelsPatch}, and the only place
 * a flat list's `image:` value is constructed.
 */
export function applyImagePatch(
  data: Record<string, unknown>,
  image: ListImageRef | null,
): Record<string, unknown> {
  const merged = { ...data }
  if (image === null) delete merged.image
  else merged.image = serializeListImageRef(image)
  return merged
}

/**
 * A validated patch. An absent key is left alone; `null` (or, for labels, an
 * empty array) deletes the key from the front matter; any other value is
 * written. Typed over both flat list types at once — the per-type vocabulary is
 * enforced where the request is parsed, so a wanted list never reaches here with
 * a `labels` key.
 */
export type FlatListMetadataPatch = {
  /** The list's prose blurb; `null` (or a blank string) clears it. */
  description?: string | null
  labels?: CardLabel[] | null
  image?: ListImageRef | null
}

/** What a flat list metadata write produced. */
export type FlatListMetadataWrite = {
  /** The full front matter after the write, unknown keys included. */
  frontMatter: Record<string, unknown>
  contentHash: string
  /** The list file, plus its `.sha256` sidecar when the write refreshed it. */
  writtenFiles: string[]
}

/**
 * Merge `patch` into the list file's front matter and write it back, leaving the
 * body untouched. Returns an error string — and writes nothing — when the file's
 * existing front matter cannot be read as a YAML mapping: a merge over keys we
 * cannot see would clobber them.
 *
 * Fields are folded in sequence rather than assembled in one literal, so a patch
 * naming several keys applies each key's own merge rule (an empty label set
 * clears, a `null` image deletes) instead of a shared one that fits neither.
 */
export async function applyFlatListMetadata(
  filePath: string,
  patch: FlatListMetadataPatch,
): Promise<FlatListMetadataWrite | string> {
  const original = await fs.readFile(filePath, 'utf-8')

  // A merge over keys we cannot see would clobber them, so both read failures
  // refuse the write.
  const mapping = readFrontMatterMapping(original)
  if (!mapping.ok) {
    const problem =
      mapping.reason === 'not-a-mapping'
        ? 'is not a key/value mapping'
        : 'could not be read as YAML'
    return `The file's front matter ${problem}, so a metadata write would overwrite it. Fix the block by hand first.`
  }
  let data = mapping.data
  if (patch.description !== undefined) data = applyDescriptionPatch(data, patch.description)
  if (patch.labels !== undefined) data = applyLabelsPatch(data, patch.labels)
  if (patch.image !== undefined) data = applyImagePatch(data, patch.image)

  const write = await writeListFrontMatter(filePath, data, { blankLineAfterBlock: true })
  return { frontMatter: data, ...write }
}
