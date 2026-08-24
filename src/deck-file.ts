import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { DEFAULT_SECTION, type DeckData } from './types'
import {
  isDroppedEmptySection,
  parseDeckFormat,
  resolveDeckFormat,
  type DeckFormatKey,
} from './deck-format'
import { listDeckFiles } from './importers/text-file'
import { isResolveListError, matchList, type ListLocation } from './resolve-list'
import { isPathWithinDir } from './path-validation'
import { assignMissingDeckCardIds } from './card-id'
import { readListDefaultLabels, type CardLabel } from './card-labels'
import { writeListFrontMatter, type ListFrontMatterWrite } from './front-matter-write'
import { isListImageRefError, parseListImage, type ListImageRef } from './list-image'
import { serializeCardLine } from './deck-text'

// Re-exported from `deck-text` (a browser-safe, type-only module) so existing
// importers of `deck-file` keep working while the public site reuses the pure
// formatter without the node-only helpers below.
export { serializeCardLine }

/**
 * Resolve a deck name (or slug) to its file path, by the same rules the CLI
 * resolves a list name: an exact hit on the literal file wins, otherwise the name
 * is matched ignoring case, diacritics, and separators. Returns null when nothing
 * matches, when the name is ambiguous, or when the path escapes the decks
 * directory.
 */
export async function resolveDeckFilePath(
  decksDir: string,
  deckName: string,
): Promise<string | null> {
  const deckFileName = deckName.endsWith('.md') ? deckName : `${deckName}.md`
  const deckFilePath = path.join(decksDir, deckFileName)

  if (!isPathWithinDir(deckFilePath, decksDir)) {
    return null
  }

  if (await Bun.file(deckFilePath).exists()) {
    return deckFilePath
  }

  // Fall back to the shared resolver, so an admin request for `winota-stax`
  // finds `Winota Stax.md` exactly as `ritual price winota-stax` does — and an
  // ambiguous name is refused here too, rather than silently taking the first hit.
  const candidates: ListLocation[] = (await listDeckFiles(decksDir)).map((file) => ({
    type: 'deck',
    name: path.basename(file, '.md'),
    filePath: path.join(decksDir, file),
  }))
  const matched = matchList(candidates, deckName, 'deck')
  return isResolveListError(matched) ? null : matched.filePath
}

/**
 * A deck file's YAML front matter. The named fields are the ones Ritual itself
 * reads or writes; the index signature preserves any other keys a user (or an
 * older version) put in the file, so they round-trip untouched.
 */
export type DeckFrontMatter = {
  name?: string
  /** Canonical format key. Normalized on every write by `serializeDeckToMarkdown`. */
  format?: DeckFormatKey
  created?: string
  tags?: string[]
  /**
   * The deck's default card labels, applied to every line that carries no
   * `[proxy]` override of its own. Decks accept `proxy` alone — a value naming
   * any other label is dropped by {@link validateDeckFrontMatter}.
   */
  labels?: CardLabel[]
  description?: string
  /**
   * The deck's cover image override. Absent means the built-in rule (the
   * commander, or the priciest printing). See `list-image.ts` for the grammar —
   * a value that is not a legal cover mapping is dropped by
   * {@link validateDeckFrontMatter} and warned about by `parseDeckText`.
   */
  image?: ListImageRef
  sourceId?: string
  sourceUrl?: string
  /**
   * Local wall-clock time of the last successful `deck-sync`, for display. Never
   * compared against a remote timestamp — see {@link sourceUpdatedAt}.
   */
  lastSynced?: string
  /**
   * The source deck's own `updatedAt` as of the last successful sync, copied
   * verbatim from the service. This is the divergence guard's baseline: both
   * sides of that comparison are the service's clock, so a local clock running
   * behind the server cannot manufacture a divergence.
   */
  sourceUpdatedAt?: string
} & Record<string, unknown>

/**
 * Serialize a full deck back to markdown with YAML front matter.
 *
 * An empty extras section is dropped rather than written as a bare header — see
 * {@link isDroppedEmptySection}, which `parseDeckText` reads from the other side
 * so the two cannot disagree.
 */
export function serializeDeckToMarkdown(deck: DeckData, frontMatter: DeckFrontMatter): string {
  // Invariant: a deck is never written to disk with an ID-less card line. Cards
  // that arrive without an ID (e.g. freshly synced from Archidekt) are assigned
  // one here, seeded from the deck's existing IDs, before serialization.
  const idedDeck = assignMissingDeckCardIds(deck)
  const sectionBlocks = idedDeck.sections
    .filter((section) => !isDroppedEmptySection(section))
    .map((section) => {
      const header = `## ${section.name}`
      const cardLines = section.cards.map(serializeCardLine)
      return [header, ...cardLines].join('\n')
    })

  const content = '\n' + sectionBlocks.join('\n\n') + '\n'
  return matter.stringify(content, canonicalFrontMatter(deck, frontMatter))
}

/**
 * The front matter a deck is actually written with.
 *
 * Stamps the deck's resolved format, so a format that was only ever inferred
 * (from a `## Commander` section, say) becomes explicit on the deck's first save
 * and every reader agrees thereafter. An unresolvable value is dropped rather
 * than persisted as-is: `format` is a closed vocabulary, and leaving unparseable
 * text in the file is what let the site and the editors disagree in the first
 * place.
 *
 * Keys with an `undefined` value are also dropped — a caller that builds front
 * matter from optional `DeckData` fields would otherwise fail the YAML dump.
 */
function canonicalFrontMatter(deck: DeckData, frontMatter: DeckFrontMatter): DeckFrontMatter {
  const next: DeckFrontMatter = {}
  for (const [key, value] of Object.entries(frontMatter)) {
    if (value !== undefined) next[key] = value
  }
  const format = resolveDeckFormat(deck, frontMatter.format)
  if (format) next.format = format
  else delete next.format
  return next
}

/**
 * The front matter a freshly created deck starts with. Shared by every way a deck
 * can be created — `ritual new deck`, the editors, the admin site — so they cannot drift.
 */
export function newDeckFrontMatter(name: string, format: DeckFormatKey): DeckFrontMatter {
  return { name, format, created: new Date().toISOString(), tags: [] }
}

/** The markdown a freshly created, empty deck file starts with. */
export function newDeckMarkdown(name: string, format: DeckFormatKey): string {
  const deck: DeckData = { name, format, sections: [{ name: DEFAULT_SECTION, cards: [] }] }
  return serializeDeckToMarkdown(deck, newDeckFrontMatter(name, format))
}

/**
 * Validate raw YAML front matter into a {@link DeckFrontMatter}, dropping any
 * named field whose value is not the type that field promises.
 *
 * Front matter is arbitrary user-authored YAML, so a `description:` holding a
 * nested map or a `tags:` holding a string is entirely possible — and this shape
 * ships out over the API (`MetadataResponse.frontMatter`, `DeckLoadResult`), so
 * asserting it would push a lie downstream. A bad field is dropped rather than
 * refused, which is exactly what a deck save already does with an unparseable
 * `format`; unknown keys pass through untouched so user-authored YAML round-trips.
 */
export function validateDeckFrontMatter(raw: Record<string, unknown>): DeckFrontMatter {
  // Copied, not used in place: gray-matter memoizes by content string and hands
  // the same `data` object back on a repeat parse, so mutating it would leak.
  const frontMatter: DeckFrontMatter = { ...raw }

  for (const key of [
    'name',
    'description',
    'sourceId',
    'sourceUrl',
    'created',
    'lastSynced',
    'sourceUpdatedAt',
  ]) {
    if (key in frontMatter && typeof frontMatter[key] !== 'string') delete frontMatter[key]
  }

  const tags = frontMatter.tags
  if (tags !== undefined) {
    const valid =
      Array.isArray(tags) && tags.every((tag) => typeof tag === 'string' && tag.length > 0)
    if (valid) frontMatter.tags = tags
    else delete frontMatter.tags
  }

  const format = parseDeckFormat(frontMatter.format)
  if (format) frontMatter.format = format
  else delete frontMatter.format

  // A label the deck grammar cannot carry is dropped whole rather than filtered
  // down: `labels: [sale, proxy]` is a statement about the deck the user meant,
  // and silently keeping half of it is a different statement. An empty set says
  // "no default", exactly as it does on a collection, so the key is dropped
  // rather than persisted as `labels: []`. The drop is what `parseDeckText`
  // warns about — the same value, judged by the same helper, on the read side.
  if ('labels' in frontMatter) {
    const read = readListDefaultLabels('deck', frontMatter.labels)
    if (read.labels) frontMatter.labels = read.labels
    else delete frontMatter.labels
  }

  // Same treatment, same reason: an `image:` the grammar cannot read is dropped
  // whole rather than half-kept, and `parseDeckText` warns about the identical
  // value so the drop is visible before a whole-deck save performs it. `null`
  // (the explicit "use the built-in rule") is dropped too — the key carries no
  // information once it says nothing.
  if ('image' in frontMatter) {
    const parsed = parseListImage(frontMatter.image)
    if (parsed === null || isListImageRefError(parsed)) delete frontMatter.image
    else frontMatter.image = parsed
  }

  return frontMatter
}

/**
 * Parse the front matter from a deck file. Every named field is validated by
 * {@link validateDeckFrontMatter} — `format` against the canonical key set (the
 * deck then falls back to section detection), the rest against their declared
 * types. Unknown and user-authored keys round-trip untouched.
 */
export async function parseDeckFrontMatter(filePath: string): Promise<DeckFrontMatter> {
  const content = await fs.readFile(filePath, 'utf-8')
  return validateDeckFrontMatter(matter(content).data)
}

/** What a front-matter write produced: the new content hash and the files it touched. */
export type DeckFrontMatterWrite = ListFrontMatterWrite

/**
 * Rewrite only a deck file's YAML front matter, leaving the markdown body byte
 * for byte as it was.
 *
 * Deliberately not a parse/serialize round trip: `serializeDeckToMarkdown` would
 * canonicalize every card line and assign missing IDs, turning a metadata edit
 * into a whole-file diff. Because the write goes through `writeFileWithHash`, an
 * editor that had the deck open sees a 409 on its next save rather than silently
 * clobbering the new front matter.
 *
 * Two caveats on "byte for byte": a body that lacked a trailing newline gains
 * one, and the front-matter YAML is re-dumped by js-yaml — comments and the
 * original quoting/indentation style are not preserved, though every key and
 * value the caller passes is. Note that callers building `frontMatter` from
 * {@link parseDeckFrontMatter} start from a copy that has already dropped every
 * named field whose value was not the type that field promises (see
 * {@link validateDeckFrontMatter}), so such values do not survive the round trip.
 *
 * The mechanics — gray-matter's file-object form, the `.sha256` sidecar rule —
 * live in {@link writeListFrontMatter}, shared with the flat-list metadata path.
 */
export async function writeDeckFrontMatter(
  filePath: string,
  frontMatter: DeckFrontMatter,
): Promise<DeckFrontMatterWrite> {
  return writeListFrontMatter(filePath, frontMatter)
}
