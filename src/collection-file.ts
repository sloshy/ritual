import { DEFAULT_SECTION, type Condition, type Finish } from './types'
import { matchSectionHeader } from './section-format'
import { isCondition, isFinish } from './finish-condition'
import { createFenceTracker } from './markdown-fence'
import { quantityPrefixAdvisory } from './card-line'
import { parseCardLabelsToken, type CardLabel } from './card-labels'
import { parseFlatListFrontMatter, type FlatListFrontMatter } from './flat-list-front-matter'

export type CollectionEntry = {
  name: string
  quantity: number
  set: string
  collectorNumber: string
  finish?: Finish
  condition?: Condition
  /**
   * This card's label override (`[keep]`, `[sale,trade]`). Replaces the list's
   * front-matter default entirely; `undefined` means "inherit the default".
   */
  labels?: CardLabel[]
  note?: string
  cardId?: number
  /** Section this entry belongs to. Defaults to `DEFAULT_SECTION` ("Main") when unsectioned. */
  section: string
}

export type CollectionParseResult = {
  entries: CollectionEntry[]
  /** Section names in first-seen order, including empty sections that have no entries. */
  sectionOrder: string[]
  /** The file's front-matter block, when it opens with one. Round-trips verbatim on save. */
  frontMatter?: FlatListFrontMatter
  /** The list's default card labels from front matter, when legally declared. */
  labels?: CardLabel[]
  warnings: string[]
  /**
   * Lines belonging to fenced code blocks (delimiters included). Fenced content
   * is prose: it yields no entries and no warnings. See {@link unreadableLines}
   * for why the whole-file save gates still care.
   */
  fencedLines: number
  /**
   * Non-fatal per-line advisories: content the parser *did* read, but about
   * which the user deserves a word — today, a card name that kept a deck's
   * quantity prefix ({@link quantityPrefixAdvisory}).
   *
   * Deliberately **not** part of `warnings`, exactly as on the deck parser:
   * nothing was lost and a re-serialize preserves the line, so these must not
   * trip the whole-file-rewrite gates ({@link unreadableLines}), whose refusal
   * text promises the listed content would be *deleted*.
   */
  advisories: string[]
}

/**
 * Matches a collection card line: `- Lightning Bolt (LEA:161) [foil] [NM] [keep] {note} &12`.
 * Whitespace between tokens is a single `\s` (one space); multiple spaces are not tolerated.
 * The three bracketed vocabularies (finish, condition, labels) are disjoint, so each token
 * is unambiguous; the optional `&N` id must stay the final capture group — the id backfill
 * and the line-preserving mutations index the match by its last group.
 */
export const COLLECTION_CARD_LINE_RE =
  /^- (.+?)(?:\s\(([A-Za-z0-9]+):([^)]+)\))?(?:\s\[(nonfoil|foil|etched)\])?(?:\s\[(NM|LP|MP|HP|DMG)\])?(?:\s\[((?:sale|trade|keep)(?:,(?:sale|trade|keep))*)\])?(?:\s\{(.*)\})?(?:\s&(\d+))?$/

/** The {@link COLLECTION_CARD_LINE_RE} capture group holding the labels token body. */
export const COLLECTION_LINE_LABELS_GROUP = 6

export function parseCollectionFile(content: string): CollectionParseResult {
  const entries: CollectionEntry[] = []
  const sectionOrder: string[] = []
  const warnings: string[] = []
  const advisories: string[] = []
  let currentSection = DEFAULT_SECTION
  let titleSeen = false
  // Fenced code blocks are prose: a bullet or `## Heading` inside one is an
  // example, not list data, and is not an unreadable line either.
  const fence = createFenceTracker()
  let fencedLines = 0

  const registerSection = (name: string): void => {
    if (!sectionOrder.includes(name)) sectionOrder.push(name)
  }

  const lines = content.split('\n')
  const front = parseFlatListFrontMatter(lines, { validateLabels: true })
  advisories.push(...front.advisories)

  for (let lineIndex = front.bodyStart; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    if (fence.feed(line).opaque) {
      fencedLines++
      continue
    }
    const trimmed = line.trim()
    if (trimmed === '') continue

    const header = matchSectionHeader(trimmed)
    if (header) {
      currentSection = header
      registerSection(header)
      continue
    }

    // The first `# Title` H1 is the list's title; any other non-bullet line is
    // content a re-serializing save would delete, so it must warn — the
    // unreadable-lines gates (sync, cleanup, admin saves) all key off these.
    if (!trimmed.startsWith('- ')) {
      if (trimmed.startsWith('# ') && !titleSeen) {
        titleSeen = true
        continue
      }
      warnings.push(`Skipped malformed line: ${trimmed}`)
      continue
    }

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

    const advisory = quantityPrefixAdvisory(name, trimmed)
    if (advisory) advisories.push(advisory)

    // The regex guarantees the token's shape and vocabulary, so the only way
    // this parse fails is the keep-exclusivity rule. The entry is still kept
    // (the card is perfectly usable on read surfaces) but the labels are
    // dropped — which is exactly why this is a warning, not an advisory: a
    // whole-file rewrite would lose the token, so the rewrite gates must block.
    const rawLabels = match[COLLECTION_LINE_LABELS_GROUP]
    let labels: CardLabel[] | undefined
    if (rawLabels !== undefined) {
      const parsedLabels = parseCardLabelsToken(rawLabels)
      if (parsedLabels.ok) {
        labels = parsedLabels.labels
      } else {
        warnings.push(
          `Conflicting labels [${rawLabels}] on '${name}' — ${parsedLabels.message} ` +
            `The labels were ignored, and a rewrite would drop them: ${trimmed}`,
        )
      }
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
      labels,
      note: match[7],
      cardId: match[8] ? Number.parseInt(match[8], 10) : undefined,
      section: currentSection,
    })
  }
  return {
    entries,
    sectionOrder,
    frontMatter: front.frontMatter,
    labels: front.labels,
    warnings,
    fencedLines,
    advisories,
  }
}
