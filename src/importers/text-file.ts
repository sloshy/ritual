import { type DeckData, type DeckSection } from '../types'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import matter from 'gray-matter'
import { isFinish, isCondition } from '../commands/collection-helpers'
import { parseDeckFormat } from '../deck-format'

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

/** A parsed deck plus a warning for every body line the parser had to skip. */
export type DeckParseResult = { deck: DeckData; warnings: string[] }

/**
 * Parse a deck's markdown/decklist text into structured {@link DeckData}.
 *
 * The text may carry optional YAML frontmatter (`name`, `description`,
 * `sourceUrl`, `sourceId`, `format`); `fallbackName` is used as the deck name
 * only when no frontmatter `name:` is present (e.g. an uploaded file's base name
 * or a name entered in the admin UI). `primer` is an optional markdown sidecar.
 *
 * A non-blank body line that is neither a section header nor a card line is
 * skipped and reported in `warnings` — imports of loose third-party decklists
 * may ignore these, but a caller about to re-serialize a Ritual deck file must
 * not, since re-emitting would drop the skipped lines.
 *
 * This is the shared core used both by {@link importFromTextFile} (reading from
 * disk) and by the admin import API (pasted text / uploaded file content).
 */
export function parseDeckText(
  rawText: string,
  fallbackName: string,
  primer?: string,
): DeckParseResult {
  const parsed = matter(rawText)

  const name = resolveDeckName(parsed.data.name, fallbackName)

  const description = getString(parsed.data.description)
  const sourceUrl = getString(parsed.data.sourceUrl)
  const sourceId = getString(parsed.data.sourceId)
  // An unrecognized `format:` is dropped, not carried: the deck then falls back
  // to section-name detection, and the next save rewrites the file with the
  // canonical key.
  const format = parseDeckFormat(parsed.data.format) ?? undefined

  const sections: DeckSection[] = []
  // The bucket body lines land in before any header is seen. It may legitimately
  // end up empty — every canonically-written Ritual deck opens with a header —
  // so it is exempt from the dropped-section warning below, as is the `# Title`
  // H1 that adopts it (a document title is not a section anybody lost).
  const syntheticMain: DeckSection = { name: 'Main', cards: [] }
  /** Heading level that adopted the synthetic bucket; `null` while unadopted. */
  let syntheticMainLevel: number | null = null
  let currentSection: DeckSection = syntheticMain
  sections.push(currentSection)

  const lines = parsed.content.split(/\r?\n/)
  const warnings: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch?.[2]) {
      const sectionName = headerMatch[2].trim()

      if (currentSection.cards.length === 0 && currentSection.name === 'Main') {
        if (currentSection === syntheticMain) syntheticMainLevel = headerMatch[1]!.length
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
      continue
    }

    warnings.push(`Skipped malformed line: ${trimmed}`)
  }

  // A section header with no card lines under it is dropped, and re-serializing
  // the deck would therefore delete it. That is a silent edit unless it is
  // reported, so it joins the malformed-line warnings — the save routes refuse a
  // baseline that carries any.
  //
  // Two shapes are emptiness rather than loss, and neither warns:
  //
  // - **The leading bucket**, when nothing adopted it (every canonically-written
  //   Ritual deck opens with a header) or when an `#` H1 adopted it — `# My Deck`
  //   above the sections is a document title, which is how imported and
  //   hand-written decks name themselves. An `##`-or-deeper first heading with no
  //   cards under it is a genuine empty section and does warn.
  // - **A deck with no cards at all**, which is exactly what `ritual` writes for a
  //   freshly created list (`## Main` and nothing else). There is no content to
  //   lose, and warning would refuse the very first save into a new deck.
  const validSections = sections.filter((s) => s.cards.length > 0)
  if (validSections.length > 0) {
    for (const section of sections) {
      if (section.cards.length > 0) continue
      if (section === syntheticMain && (syntheticMainLevel === null || syntheticMainLevel === 1)) {
        continue
      }
      warnings.push(`Skipped empty section: ${section.name}`)
    }
  }

  const deck: DeckData = {
    name,
    format,
    description,
    primer,
    sourceUrl,
    sourceId,
    sections: validSections,
  }
  return { deck, warnings }
}

/**
 * Read a deck file (plus its `.primer.md` sidecar) and return the parse result
 * INCLUDING `warnings` — the lines the parser could not read.
 *
 * {@link importFromTextFile} is this minus the warnings, for the many callers
 * that only want the deck; anything that re-serializes the file, or reports what
 * a load actually saw, must go through this one.
 */
export async function loadDeckFile(filePath: string): Promise<DeckParseResult> {
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

/**
 * Read a deck file (and its primer sidecar) into {@link DeckData}. Skipped-line
 * warnings are dropped here — callers that re-serialize the file, or surface
 * what the load saw, use {@link loadDeckFile} instead.
 */
export async function importFromTextFile(filePath: string): Promise<DeckData> {
  return (await loadDeckFile(filePath)).deck
}
