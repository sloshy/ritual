import { type DeckData, type DeckSection } from '../types'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import matter from 'gray-matter'
import { isFinish, isCondition } from '../commands/collection-helpers'

export function isDeckFile(filename: string): boolean {
  return (
    filename.endsWith('.md') &&
    !filename.endsWith('.primer.md') &&
    !filename.endsWith('.changes.md')
  )
}

export async function listDeckFiles(decksDir: string): Promise<string[]> {
  return (await readdir(decksDir)).filter(isDeckFile)
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/\\n/g, '\n') : undefined
}

/**
 * Resolve a deck's display name: the `name:` frontmatter field if present,
 * otherwise the supplied fallback (typically a file base name or user-entered name).
 */
function resolveDeckName(rawName: unknown, fallbackName: string): string {
  const parsedName = getString(rawName)
  if (parsedName) {
    return parsedName.replace(/\n/g, ' ')
  }
  return fallbackName
}

/**
 * Read just a deck file's display name without parsing its full card list.
 * Used to filter discovered decks by the site `includeDecks` selection.
 */
export async function readDeckName(filePath: string): Promise<string> {
  const rawText = await Bun.file(filePath).text()
  return resolveDeckName(matter(rawText).data.name, path.basename(filePath, path.extname(filePath)))
}

/**
 * Matches a deck card line: `2 Lightning Bolt (LEA:161) [foil] [NM] {note} &12`.
 * Set codes allow `_` (some art-series / playtest sets use underscores).
 * Whitespace is `\s+` so multiple spaces between tokens are tolerated.
 */
export const DECK_CARD_LINE_RE =
  /^(\d+)[xX]?\s+(.+?)(?:\s+\(([A-Za-z0-9_]+):([^)]+)\))?(?:\s+\[(nonfoil|foil|etched)\])?(?:\s+\[(NM|LP|MP|HP|DMG)\])?(?:\s+\{(.*)\})?(?:\s+&(\d+))?$/

/**
 * Parse a deck's markdown/decklist text into structured {@link DeckData}.
 *
 * The text may carry optional YAML frontmatter (`name`, `description`,
 * `sourceUrl`, `sourceId`, `format`); `fallbackName` is used as the deck name
 * only when no frontmatter `name:` is present (e.g. an uploaded file's base name
 * or a name entered in the admin UI). `primer` is an optional markdown sidecar.
 *
 * This is the shared core used both by {@link importFromTextFile} (reading from
 * disk) and by the admin import API (pasted text / uploaded file content).
 */
export function parseDeckText(rawText: string, fallbackName: string, primer?: string): DeckData {
  const parsed = matter(rawText)

  const name = resolveDeckName(parsed.data.name, fallbackName)

  const description = getString(parsed.data.description)
  const sourceUrl = getString(parsed.data.sourceUrl)
  const sourceId = getString(parsed.data.sourceId)
  const format = getString(parsed.data.format)

  const sections: DeckSection[] = []
  let currentSection: DeckSection = { name: 'Main', cards: [] }
  sections.push(currentSection)

  const lines = parsed.content.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const headerMatch = trimmed.match(/^#{1,6}\s+(.+)$/)
    if (headerMatch?.[1]) {
      const sectionName = headerMatch[1].trim()

      if (currentSection.cards.length === 0 && currentSection.name === 'Main') {
        currentSection.name = sectionName
      } else {
        currentSection = { name: sectionName, cards: [] }
        sections.push(currentSection)
      }
      continue
    }

    const quantityMatch = trimmed.match(DECK_CARD_LINE_RE)
    if (quantityMatch?.[1] && quantityMatch?.[2]) {
      currentSection.cards.push({
        quantity: Number.parseInt(quantityMatch[1], 10),
        name: quantityMatch[2].trim(),
        set: quantityMatch[3]?.toLowerCase(),
        collectorNumber: quantityMatch[4],
        finish: quantityMatch[5] && isFinish(quantityMatch[5]) ? quantityMatch[5] : undefined,
        condition: quantityMatch[6] && isCondition(quantityMatch[6]) ? quantityMatch[6] : undefined,
        note: quantityMatch[7],
        cardId: quantityMatch[8] ? Number.parseInt(quantityMatch[8], 10) : undefined,
      })
    }
  }

  const validSections = sections.filter((s) => s.cards.length > 0)

  return {
    name,
    format,
    description,
    primer,
    sourceUrl,
    sourceId,
    sections: validSections,
  }
}

export async function importFromTextFile(filePath: string): Promise<DeckData> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    throw new Error(`File not found: ${filePath}`)
  }

  const rawText = await file.text()

  const primerPath = filePath.replace(/\.[^.]+$/, '.primer.md')
  const primerFile = Bun.file(primerPath)
  const primer = (await primerFile.exists())
    ? (await primerFile.text()).trim() || undefined
    : undefined

  return parseDeckText(rawText, path.basename(filePath, path.extname(filePath)), primer)
}
