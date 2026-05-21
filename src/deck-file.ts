import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { type Card, type DeckData } from './types'
import { listDeckFiles } from './importers/text-file'
import { isPathWithinDir } from './path-validation'
import { allocateNextIdFromContent, assignMissingDeckCardIds } from './card-id'
import { writeFileWithHash } from './content-hash'

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

/** Format a single card line with optional printing metadata */
export function serializeCardLine(card: Card): string {
  let line = `${card.quantity} ${card.name}`
  if (card.set && card.collectorNumber) {
    line += ` (${card.set.toUpperCase()}:${card.collectorNumber})`
  }
  if (card.finish && card.finish !== 'nonfoil') {
    line += ` [${card.finish}]`
  }
  if (card.condition && card.condition !== 'NM') {
    line += ` [${card.condition}]`
  }
  if (card.note) {
    line += ` {${card.note}}`
  }
  if (card.cardId !== undefined) {
    line += ` &${card.cardId}`
  }
  return line
}

/** Serialize a full deck back to markdown with YAML front matter */
export function serializeDeckToMarkdown(
  deck: DeckData,
  frontMatter: Record<string, unknown>,
): string {
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
export async function parseDeckFrontMatter(filePath: string): Promise<Record<string, unknown>> {
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
