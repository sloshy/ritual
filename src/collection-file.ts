import { DEFAULT_SECTION, type Condition, type Finish, type ScryfallCard } from './types'
import { matchSectionHeader } from './section-format'
import { isCondition, isFinish } from './finish-condition'

export type CollectionEntry = {
  name: string
  quantity: number
  set: string
  collectorNumber: string
  finish?: Finish
  condition?: Condition
  note?: string
  cardId?: number
  /** Section this entry belongs to. Defaults to `DEFAULT_SECTION` ("Main") when unsectioned. */
  section: string
}

export type CollectionParseResult = {
  entries: CollectionEntry[]
  /** Section names in first-seen order, including empty sections that have no entries. */
  sectionOrder: string[]
  warnings: string[]
}

/**
 * Matches a collection card line: `- Lightning Bolt (LEA:161) [foil] [NM] {note} &12`.
 * Whitespace between tokens is a single `\s` (one space); multiple spaces are not tolerated.
 */
export const COLLECTION_CARD_LINE_RE =
  /^- (.+?)(?:\s\(([A-Za-z0-9]+):([^)]+)\))?(?:\s\[(nonfoil|foil|etched)\])?(?:\s\[(NM|LP|MP|HP|DMG)\])?(?:\s\{(.*)\})?(?:\s&(\d+))?$/

export function parseCollectionFile(content: string): CollectionParseResult {
  const entries: CollectionEntry[] = []
  const sectionOrder: string[] = []
  const warnings: string[] = []
  let currentSection = DEFAULT_SECTION

  const registerSection = (name: string): void => {
    if (!sectionOrder.includes(name)) sectionOrder.push(name)
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    const header = matchSectionHeader(trimmed)
    if (header) {
      currentSection = header
      registerSection(header)
      continue
    }

    if (!trimmed.startsWith('- ')) continue

    const match = trimmed.match(COLLECTION_CARD_LINE_RE)
    if (!match) {
      warnings.push(`Skipped malformed line: ${trimmed}`)
      continue
    }

    const name = match[1]!
    const setCode = match[2]
    const collectorNumber = match[3]

    if (!setCode || !collectorNumber) {
      warnings.push(`Skipping '${name}': missing set code and collector number`)
      continue
    }

    // A card before any explicit header pins the implicit Main section into the order list.
    registerSection(currentSection)
    entries.push({
      name,
      quantity: 1,
      set: setCode.toLowerCase(),
      collectorNumber,
      finish: match[4] && isFinish(match[4]) ? match[4] : undefined,
      condition: match[5] && isCondition(match[5]) ? match[5] : undefined,
      note: match[6],
      cardId: match[7] ? Number.parseInt(match[7], 10) : undefined,
      section: currentSection,
    })
  }
  return { entries, sectionOrder, warnings }
}

/** An entry's recorded finish preference, if any. */
export type FinishPreference = { finish?: Finish }

/**
 * The finish an entry's price should be read at: the entry's own finish when it
 * has one, otherwise nonfoil when the printing offers it, otherwise the
 * printing's first finish.
 */
export function resolveFinish(entry: FinishPreference, card: ScryfallCard): Finish {
  if (entry.finish) return entry.finish
  if (card.finishes.includes('nonfoil')) return 'nonfoil'
  const first = card.finishes[0]
  return first !== undefined && isFinish(first) ? first : 'nonfoil'
}
