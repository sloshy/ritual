import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { DEFAULT_SECTION, type Card, type DeckData } from './types'
import { parseDeckFormat, resolveDeckFormat, type DeckFormatKey } from './deck-format'
import { listDeckFiles } from './importers/text-file'
import { isResolveListError, matchList, type ListLocation } from './resolve-list'
import { isPathWithinDir } from './path-validation'
import { allocateNextIdFromContent, assignMissingDeckCardIds } from './card-id'
import { writeFileWithHash } from './content-hash'
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
  /** Set by `deck-sync` after a successful sync with the source service. */
  lastSynced?: string
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
 * can be created — `new-deck`, the editors, the admin site — so they cannot drift.
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
 * Parse the front matter from a deck file. `format` is validated against the
 * canonical key set, so an unrecognized value is dropped rather than handed on as
 * a format key; the deck then falls back to section detection. Every other key is
 * taken as YAML found it, so unknown and user-authored keys round-trip untouched.
 */
export async function parseDeckFrontMatter(filePath: string): Promise<DeckFrontMatter> {
  const content = await fs.readFile(filePath, 'utf-8')
  const frontMatter = matter(content).data as DeckFrontMatter
  const format = parseDeckFormat(frontMatter.format)
  if (format) frontMatter.format = format
  else delete frontMatter.format
  return frontMatter
}

/**
 * Add a card entry under the ## Main section of a deck file.
 * Creates the section if it doesn't exist.
 * Returns the card ID allocated for the new line, so callers can record it
 * (e.g. in a changelog entry) without re-parsing the file.
 */
export async function addCardToDeckFile(filePath: string, card: Card): Promise<number> {
  const fileContent = await fs.readFile(filePath, 'utf-8')
  const lines = fileContent.split('\n')

  // Parse existing card IDs to find the next available
  const { nextId: cardId } = allocateNextIdFromContent(fileContent)

  let mainIndex = lines.findIndex((l) => l.trim() === '## Main')
  if (mainIndex === -1) {
    lines.push('')
    lines.push('## Main')
    mainIndex = lines.length - 1
  }
  lines.splice(mainIndex + 1, 0, serializeCardLine({ ...card, cardId }))
  const content = lines.join('\n')
  await writeFileWithHash(filePath, content.endsWith('\n') ? content : content + '\n')
  return cardId
}
