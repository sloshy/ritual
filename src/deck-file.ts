import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { type Card, type DeckData } from './types'
import { listDeckFiles } from './importers/text-file'
import { isPathWithinDir } from './path-validation'
import { allocateNextIdFromContent, assignMissingDeckCardIds } from './card-id'
import { writeFileWithHash } from './content-hash'
import { serializeCardLine } from './deck-text'

// Re-exported from `deck-text` (a browser-safe, type-only module) so existing
// importers of `deck-file` keep working while the public site reuses the pure
// formatter without the node-only helpers below.
export { serializeCardLine }

/**
 * Resolve a deck name to its file path. Tries exact match first,
 * then tries with .md extension, then case-insensitive match.
 * Returns null if not found or if the resolved path escapes the decks directory.
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

  const files = await listDeckFiles(decksDir)
  const deckFileNameLower = deckFileName.toLowerCase()
  const exactMatch = files.find((f) => f.toLowerCase() === deckFileNameLower)
  if (exactMatch) return path.join(decksDir, exactMatch)

  const match = files.find((f) => f.toLowerCase().includes(deckName.toLowerCase()))
  return match ? path.join(decksDir, match) : null
}

/**
 * A deck file's YAML front matter. The named fields are the ones Ritual itself
 * reads or writes; the index signature preserves any other keys a user (or an
 * older version) put in the file, so they round-trip untouched.
 */
export type DeckFrontMatter = {
  name?: string
  /** Usually a `DeckFormatKey`; free text is tolerated for unrecognized/legacy values. */
  format?: string
  created?: string
  tags?: string[]
  sourceId?: string
  sourceUrl?: string
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
  return matter.stringify(content, frontMatter)
}

/** Parse the front matter from a deck file */
export async function parseDeckFrontMatter(filePath: string): Promise<DeckFrontMatter> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parsed = matter(content)
  return parsed.data
}

/**
 * Add a card entry under the ## Main section of a deck file.
 * Creates the section if it doesn't exist.
 */
export async function addCardToDeckFile(filePath: string, card: Card): Promise<void> {
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
}
