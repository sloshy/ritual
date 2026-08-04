/**
 * Writing a collection's front-matter metadata — the one path every surface
 * that edits a collection's `labels:` default goes through: the admin route
 * `PUT /api/metadata/:type/:slug` (and therefore the MCP `set_list_metadata`
 * tool). Mirrors `deck-metadata.ts` for decks.
 *
 * The write is front-matter only ({@link writeListFrontMatter}), so the card
 * lines — `&N` ids, label overrides, notes — survive byte for byte. Request
 * validation is the HTTP layer's job; what lives here is the vocabulary of
 * writable keys and how a patch merges. Unknown keys a user hand-authored into
 * the block round-trip untouched.
 */

import fs from 'node:fs/promises'
import { readFrontMatterMapping, writeListFrontMatter } from './front-matter-write'
import { normalizeCardLabels, type CardLabel } from './card-labels'

/** The keys a collection metadata write accepts, in the order error messages list them. */
export const COLLECTION_METADATA_KEYS = ['labels'] as const

/** A key a collection metadata write accepts. */
export type CollectionMetadataKey = (typeof COLLECTION_METADATA_KEYS)[number]

/** True when `value` names a writable collection metadata field. */
export function isCollectionMetadataKey(value: string): value is CollectionMetadataKey {
  return (COLLECTION_METADATA_KEYS as readonly string[]).includes(value)
}

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
 * A validated patch. An absent key is left alone; `null` (or an empty array)
 * deletes the key from the front matter; a non-empty array is written.
 */
export type CollectionMetadataPatch = {
  labels?: CardLabel[] | null
}

/** What a collection metadata write produced. */
export type CollectionMetadataWrite = {
  /** The full front matter after the write, unknown keys included. */
  frontMatter: Record<string, unknown>
  contentHash: string
  /** The list file, plus its `.sha256` sidecar when the write refreshed it. */
  writtenFiles: string[]
}

/**
 * Merge `patch` into the collection file's front matter and write it back,
 * leaving the body untouched. Returns an error string — and writes nothing —
 * when the file's existing front matter cannot be read as a YAML mapping: a
 * merge over keys we cannot see would clobber them.
 */
export async function applyCollectionMetadata(
  filePath: string,
  patch: CollectionMetadataPatch,
): Promise<CollectionMetadataWrite | string> {
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
  const data =
    patch.labels !== undefined ? applyLabelsPatch(mapping.data, patch.labels) : mapping.data

  const write = await writeListFrontMatter(filePath, data, { blankLineAfterBlock: true })
  return { frontMatter: data, ...write }
}
