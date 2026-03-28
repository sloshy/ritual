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

export async function importFromTextFile(filePath: string): Promise<DeckData> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    throw new Error(`File not found: ${filePath}`)
  }

  const rawText = await file.text()
  const parsed = matter(rawText)

  let name = path.basename(filePath, path.extname(filePath))
  const parsedName = getString(parsed.data.name)
  if (parsedName) {
    name = parsedName.replace(/\n/g, ' ')
  }

  const description = getString(parsed.data.description)
  const sourceUrl = getString(parsed.data.sourceUrl)
  const sourceId = getString(parsed.data.sourceId)

  const primerPath = filePath.replace(/\.[^.]+$/, '.primer.md')
  const primerFile = Bun.file(primerPath)
  const primer = (await primerFile.exists())
    ? (await primerFile.text()).trim() || undefined
    : undefined

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

    const quantityMatch = trimmed.match(
      /^(\d+)[xX]?\s+(.+?)(?:\s+\(([A-Za-z0-9_]+):([^)]+)\))?(?:\s+\[(nonfoil|foil|etched)\])?(?:\s+\[(NM|LP|MP|HP|DMG)\])?(?:\s+&(\d+))?$/,
    )
    if (quantityMatch?.[1] && quantityMatch?.[2]) {
      currentSection.cards.push({
        quantity: Number.parseInt(quantityMatch[1], 10),
        name: quantityMatch[2].trim(),
        set: quantityMatch[3]?.toLowerCase(),
        collectorNumber: quantityMatch[4],
        finish: quantityMatch[5] && isFinish(quantityMatch[5]) ? quantityMatch[5] : undefined,
        condition: quantityMatch[6] && isCondition(quantityMatch[6]) ? quantityMatch[6] : undefined,
        cardId: quantityMatch[7] ? Number.parseInt(quantityMatch[7], 10) : undefined,
      })
    }
  }

  const validSections = sections.filter((s) => s.cards.length > 0)

  return {
    name,
    description,
    primer,
    sourceUrl,
    sourceId,
    sections: validSections,
  }
}
