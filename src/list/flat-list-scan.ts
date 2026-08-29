/**
 * The document scan the two flat-list parsers share.
 *
 * A collection and a wanted list are the same document: front matter, an `# H1`
 * title, `## Section` headings, and one bullet per physical card. Only the
 * *entry* differs — a collection copy carries a condition and labels, a wanted
 * copy carries neither — so that is the one thing a caller supplies.
 *
 * Keeping the scan here is the same rule the tokenizer follows one layer down:
 * the severity of a line, which lines are candidates, and how a pasted quantity
 * becomes one entry per copy are single decisions, and two parsers answering
 * them separately is exactly how a `&N` rule or a title rule ends up applied to
 * one list type and not the other.
 */

import { isCommentLine, parseCardLine, type LineTokens } from '../card/card-line-grammar'
import { isCardCandidate } from '../card/card-line-read'
import { DEFAULT_SECTION } from './deck'
import {
  createLineDiagnostics,
  type LineDiagnostics,
  type ListFileParseOptions,
} from './line-diagnostics'
import { createFenceTracker } from './markdown-fence'
import { matchSectionHeader } from './section-format'
import { parseFlatListFrontMatter, type FlatListFrontMatterParse } from './flat-list-front-matter'

/** The list types that hold one line per physical card. */
export type FlatListType = 'collection' | 'wanted'

/** One copy of one card line, as the scan hands it to an entry builder. */
export type FlatCardCopy = {
  /** Everything the line said, shared by every copy it expands into. */
  tokens: LineTokens
  /** The section this copy belongs to; `DEFAULT_SECTION` before any heading. */
  section: string
  /**
   * The line's `&N`, on the **first** copy only. The extra copies have no id
   * until a save allocates them one (see `ensure-card-ids.ts`); handing them a
   * duplicate would make two entries claim one id.
   */
  cardId?: number
}

/** What a flat-list scan read, before a caller shapes it into a parse result. */
export type FlatListScan<E> = {
  entries: E[]
  /** Section names in first-seen order, including sections that hold no entries. */
  sectionOrder: string[]
  /** The file's front-matter block and whatever the scan was allowed to read out of it. */
  front: FlatListFrontMatterParse
  /** Lines belonging to fenced code blocks, delimiters included. */
  fencedLines: number
  /** The diagnostic channels, already filled and ready to hand out. */
  report: LineDiagnostics
}

/**
 * Read a flat list file, building each entry with `buildEntry`.
 *
 * `buildEntry` returns `undefined` for a copy its list type cannot store — a
 * collection entry always names a printing, which `GRAMMAR.collection` already
 * requires, so the guard is a narrowing rather than a live filter.
 */
export function scanFlatListFile<E>(
  type: FlatListType,
  content: string,
  options: ListFileParseOptions,
  buildEntry: (copy: FlatCardCopy) => E | undefined,
): FlatListScan<E> {
  const entries: E[] = []
  const sectionOrder: string[] = []
  const report = createLineDiagnostics(options.file)
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
  const front = parseFlatListFrontMatter(lines, { validateLabels: type === 'collection' })
  report.advisories.push(...front.advisories)

  for (let lineIndex = front.bodyStart; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    if (fence.feed(line).opaque) {
      fencedLines++
      continue
    }
    const trimmed = line.trim()
    if (trimmed === '') continue
    // A `//` comment is a recognized line kind: read-tolerated, dropped on write.
    if (isCommentLine(trimmed)) continue

    const header = matchSectionHeader(trimmed)
    if (header) {
      currentSection = header
      registerSection(header)
      continue
    }

    // The first `# Title` H1 is the list's title; any other non-bullet line is
    // content a re-serializing save would delete, so it must warn — the
    // unreadable-lines gates (sync, cleanup, admin saves) all key off these.
    //
    // The bullet is what makes a line a *candidate*, and the file is the only
    // thing that knows it: the tokenizer reads a bare name as a name-only card,
    // so handing it every body line would turn a paragraph of prose into cards.
    if (!isCardCandidate(type, trimmed)) {
      if (trimmed.startsWith('# ') && !titleSeen) {
        titleSeen = true
        continue
      }
      report.warnings.push(`Skipped malformed line: ${trimmed}`)
      continue
    }

    const parsed = parseCardLine(type, trimmed)
    if (!parsed.ok) {
      report.record(parsed, lineIndex + 1)
      continue
    }
    for (const advisory of parsed.advisories) report.record(advisory, lineIndex + 1)

    // A card before any explicit header pins the implicit Main section into the order list.
    registerSection(currentSection)
    // One line per copy is a flat list's whole model, so a pasted quantity is
    // read as that many entries — and written as that many lines on the next
    // save (see `ensure-card-ids.ts`).
    const { tokens } = parsed
    for (let copy = 0; copy < tokens.quantity; copy++) {
      const entry = buildEntry({
        tokens,
        section: currentSection,
        cardId: copy === 0 ? tokens.cardId : undefined,
      })
      if (entry !== undefined) entries.push(entry)
    }
  }

  return { entries, sectionOrder, front, fencedLines, report }
}
