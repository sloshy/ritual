/**
 * Writing a deck's front-matter metadata — the one path every surface that
 * edits `description`/`tags`/`format`/`labels`/`sourceId`/`sourceUrl` goes through: the
 * admin route `PUT /api/metadata/:type/:slug` (and therefore the MCP
 * `set_list_metadata` tool), and the `deck-sync link` CLI command.
 *
 * The write is front-matter only: {@link writeDeckFrontMatter} re-emits the
 * body verbatim, so a deck's prose, fenced blocks, and card lines — `&N` ids
 * included — survive byte for byte. Request validation is the HTTP layer's job;
 * what lives here is the vocabulary of writable keys and how a patch merges.
 */

import type { CardLabel } from './card-labels'
import { parseDeckFrontMatter, writeDeckFrontMatter, type DeckFrontMatter } from './deck-file'
import type { DeckFormatKey } from './deck-format'

/** The keys a metadata write accepts, in the order error messages list them. */
export const DECK_METADATA_KEYS = [
  'description',
  'tags',
  'format',
  'labels',
  'sourceId',
  'sourceUrl',
] as const

/** A key a metadata write accepts. */
export type DeckMetadataKey = (typeof DECK_METADATA_KEYS)[number]

/** True when `value` names a writable deck metadata field. */
export function isDeckMetadataKey(value: string): value is DeckMetadataKey {
  return (DECK_METADATA_KEYS as readonly string[]).includes(value)
}

/**
 * A validated patch. An absent key is left alone; a key mapped to `null` is
 * deleted from the front matter; any other value is written. `null` (rather than
 * a present-but-`undefined` key) encodes the clear so the distinction survives
 * structural equality, spreads, and JSON.
 */
export type DeckMetadataPatch = {
  description?: string | null
  tags?: string[] | null
  format?: DeckFormatKey | null
  /** The deck's default card labels; `null` (or an empty set) clears them. */
  labels?: CardLabel[] | null
  sourceId?: string | null
  sourceUrl?: string | null
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
export function mergeDeckMetadata(
  existing: DeckFrontMatter,
  patch: DeckMetadataPatch,
): DeckFrontMatter {
  const merged: DeckFrontMatter = { ...existing }
  for (const key of DECK_METADATA_KEYS) {
    applyField(merged, key, patch[key])
  }
  return merged
}

/** What a metadata write produced: the full front matter, and the file's new hash. */
export type DeckMetadataWrite = {
  frontMatter: DeckFrontMatter
  contentHash: string
  /** The deck file, plus its `.sha256` sidecar when the write refreshed it. */
  writtenFiles: string[]
}

/**
 * A rule the *merged* front matter has to satisfy, returning the message
 * explaining why it does not. Validating the merge rather than the patch is what
 * lets a cross-field rule hold under a partial update: a patch that sets only
 * `sourceId` still has to agree with the `sourceUrl` already on the file.
 */
export type DeckMetadataValidator = (frontMatter: DeckFrontMatter) => string | null

/**
 * Merge `patch` into the deck file's front matter and write it back, leaving
 * every card line and every word of the body untouched. Returns the rejection
 * message when `validate` refuses the merged result, in which case nothing is
 * written.
 *
 * Key round-trip exceptions are inherited from `parseDeckFrontMatter`: every
 * named field whose stored value is not the type that field promises is dropped
 * — an unparseable `format` included — exactly as a full deck save would drop it.
 */
export async function applyDeckMetadata(
  filePath: string,
  patch: DeckMetadataPatch,
  validate?: DeckMetadataValidator,
): Promise<DeckMetadataWrite | string> {
  const existing = await parseDeckFrontMatter(filePath)
  const merged = mergeDeckMetadata(existing, patch)
  const invalid = validate?.(merged)
  if (invalid) return invalid
  const { contentHash, writtenFiles } = await writeDeckFrontMatter(filePath, merged)
  return { frontMatter: merged, contentHash, writtenFiles }
}
