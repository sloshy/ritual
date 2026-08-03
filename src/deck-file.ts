import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { DEFAULT_SECTION, type DeckData } from './types'
import { parseDeckFormat, resolveDeckFormat, type DeckFormatKey } from './deck-format'
import { listDeckFiles } from './importers/text-file'
import { isResolveListError, matchList, type ListLocation } from './resolve-list'
import { isPathWithinDir } from './path-validation'
import { assignMissingDeckCardIds } from './card-id'
import { computeHash, hashPath, isRitualClean, writeFileWithHash } from './content-hash'
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
  description?: string
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

/** Serialize a full deck back to markdown with YAML front matter */
export function serializeDeckToMarkdown(deck: DeckData, frontMatter: DeckFrontMatter): string {
  // Invariant: a deck is never written to disk with an ID-less card line. Cards
  // that arrive without an ID (e.g. freshly synced from Archidekt) are assigned
  // one here, seeded from the deck's existing IDs, before serialization.
  const idedDeck = assignMissingDeckCardIds(deck)
  const sectionBlocks = idedDeck.sections.map((section) => {
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
export type DeckFrontMatterWrite = {
  contentHash: string
  /**
   * The deck file, plus its `.sha256` sidecar when that sidecar was refreshed.
   * Callers stage exactly this set, so a sidecar deliberately left stale is not
   * committed as if it had been rewritten.
   */
  writtenFiles: string[]
}

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
 * The `.sha256` sidecar is only refreshed when it matched the file *before* this
 * write: a front-matter edit says nothing about card lines, so stamping the
 * sidecar over an unrecorded hand edit would make `detect-changes` treat that
 * edit as already recorded and drop its changelog entries. The returned hash
 * always describes the new content either way — the API's optimistic-concurrency
 * check hashes content, not the sidecar.
 */
export async function writeDeckFrontMatter(
  filePath: string,
  frontMatter: DeckFrontMatter,
): Promise<DeckFrontMatterWrite> {
  const original = await fs.readFile(filePath, 'utf-8')
  const wasRitualClean = await isRitualClean(filePath, original)
  const parsed = matter(original)
  // The file-object form, not `matter.stringify(parsed.content, ...)`: given a
  // string, gray-matter re-parses it, so a body whose first line is `---` (a
  // horizontal rule) would be swallowed as a second front-matter block and the
  // card list silently dropped. `data: {}` is required because stringify does
  // `Object.assign({}, file.data, data)` — carrying the old data forward would
  // resurrect exactly the keys this write means to delete.
  const source: FrontMatterFile = { ...parsed, data: {} }
  const content = matter.stringify(source, frontMatter)
  if (wasRitualClean) {
    return {
      contentHash: await writeFileWithHash(filePath, content),
      writtenFiles: [filePath, hashPath(filePath)],
    }
  }
  await fs.writeFile(filePath, content)
  return { contentHash: computeHash(content), writtenFiles: [filePath] }
}

/**
 * The parsed-file shape `matter.stringify` reads: the body it re-emits verbatim,
 * the front-matter data it merges the new keys over, and the excerpt it re-emits
 * when one was parsed (always `''` here, since no excerpt option is used).
 */
type FrontMatterFile = { content: string; data: Record<string, unknown>; excerpt?: string }
