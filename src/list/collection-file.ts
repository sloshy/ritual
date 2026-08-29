/**
 * The collection file grammar: parse `- Name (SET:CN) [foil] [NM] [ja] [keep]
 * {note} &N` bullets into entries. Every card line is read by the one tokenizer
 * (`parseCardLine`) and every document by the one flat-list scan
 * (`scanFlatListFile`), so this file states only what a *collection* entry is —
 * the condition and the label override a wanted list does not carry.
 */
import type { Condition, Finish } from '../card/finish-condition'
import type { CardLanguage } from '../card/card-language'
import type { CardLineDiagnostic } from '../card/card-line-grammar'
import type { ListFileParseOptions } from './line-diagnostics'
import type { CardLabel } from '../card/card-labels'
import type { FlatListFrontMatter } from './flat-list-front-matter'
import { scanFlatListFile } from './flat-list-scan'

export type CollectionEntry = {
  name: string
  quantity: number
  set: string
  collectorNumber: string
  finish?: Finish
  condition?: Condition
  /** The printing's language, from a `[ja]`-style token. Absent means `en` (bare lines stay bare). */
  language?: CardLanguage
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
   * which the user deserves a word — a quantity that will expand into one line
   * per copy, an export dialect that was rewritten, a name that still looks
   * like it holds a printing.
   *
   * Deliberately **not** part of `warnings`, exactly as on the deck parser:
   * nothing was lost and a re-serialize preserves the content, so these must
   * not trip the whole-file-rewrite gates ({@link unreadableLines}), whose
   * refusal text promises the listed content would be *deleted*.
   */
  advisories: string[]
  /**
   * Every card-line diagnostic above in structured form — code, offending
   * token, column — for callers that want more than the rendered sentence.
   * {@link warnings} stays the authoritative rewrite gate: it also carries the
   * front-matter and prose-line messages this parser raises about the *file*
   * rather than about one card line, which have no structured form.
   */
  diagnostics: CardLineDiagnostic[]
}

export function parseCollectionFile(
  content: string,
  options: ListFileParseOptions = {},
): CollectionParseResult {
  const scan = scanFlatListFile<CollectionEntry>('collection', content, options, (copy) => {
    // Named field by field rather than spread, so a widened `LineTokens` cannot
    // quietly land an unmodelled field on a collection entry.
    const { name, printing, finish, condition, language, labels, note } = copy.tokens
    // A collection line always names a printing — `GRAMMAR.collection` requires
    // it, so the scan's parse already refused a line without one.
    if (printing === undefined) return undefined
    return {
      name,
      quantity: 1,
      set: printing.set,
      collectorNumber: printing.collectorNumber,
      finish,
      condition,
      language,
      labels: labels === undefined ? undefined : [...labels],
      note,
      cardId: copy.cardId,
      section: copy.section,
    }
  })
  return {
    entries: scan.entries,
    sectionOrder: scan.sectionOrder,
    frontMatter: scan.front.frontMatter,
    labels: scan.front.labels,
    warnings: scan.report.warnings,
    fencedLines: scan.fencedLines,
    advisories: scan.report.advisories,
    diagnostics: scan.report.diagnostics,
  }
}
