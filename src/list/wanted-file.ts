/**
 * The wanted-list file grammar: parse `- Name (SET:CN) [foil] [ja] {note} &N`
 * lines into entries. Mirrors `collection-file.ts`: one tokenizer reads the card
 * lines and one flat-list scan (`scanFlatListFile`) reads the document, so this
 * file states only what a *wanted* entry is — a printing that may be absent, and
 * neither a condition nor labels. The in-memory entry shapes the sites and
 * endpoints trade in live in `wanted-entries.ts`.
 */
import type { Finish } from '../card/finish-condition'
import type { CardLineDiagnostic } from '../card/card-line-grammar'
import type { ListFileParseOptions } from './line-diagnostics'
import type { CardLanguage } from '../card/card-language'
import type { CardTag } from '../card/card-tags'
import type { FlatListFrontMatter } from './flat-list-front-matter'
import { scanFlatListFile } from './flat-list-scan'

export type WantedListEntry = {
  name: string
  quantity: number
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** The wanted printing's language, from a `[ja]`-style token. Absent means `en`. */
  language?: CardLanguage
  /** The line's `#tag` tokens in canonical form; absent when it carries none. */
  tags?: CardTag[]
  note?: string
  cardId?: number
  /** Section this entry belongs to. Defaults to `DEFAULT_SECTION` ("Main") when unsectioned. */
  section: string
}

export type WantedListParseResult = {
  entries: WantedListEntry[]
  /** Section names in first-seen order, including empty sections that have no entries. */
  sectionOrder: string[]
  /**
   * The file's front-matter block, when it opens with one. Round-trips verbatim
   * on save. The one key a wanted list defines is the cover `image:` (card
   * labels are a collection concept), and it is read out of this block by the
   * loaders rather than here — so this parser carries the block, never
   * interprets it.
   */
  frontMatter?: FlatListFrontMatter
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
   * per copy (wanted lists hold one line per copy, exactly like collections),
   * an export dialect that was rewritten, a name that still looks like it holds
   * a printing.
   *
   * Deliberately **not** part of `warnings`: nothing was lost and a
   * re-serialize preserves the content, so these must not trip the
   * whole-file-rewrite gates ({@link unreadableLines}).
   */
  advisories: string[]
  /**
   * Every card-line diagnostic above in structured form — code, offending
   * token, column. {@link warnings} stays the authoritative rewrite gate: it
   * also carries the front-matter and prose-line messages this parser raises
   * about the *file* rather than about one card line, which have no structured
   * form.
   */
  diagnostics: CardLineDiagnostic[]
}

export function parseWantedListFile(
  content: string,
  options: ListFileParseOptions = {},
): WantedListParseResult {
  const scan = scanFlatListFile<WantedListEntry>('wanted', content, options, (copy) => {
    // Named field by field rather than spread: a wanted list carries neither a
    // condition nor labels (the grammar refuses both), so listing what it does
    // carry keeps a widened `LineTokens` from quietly landing on an entry.
    const { name, printing, finish, language, tags, note } = copy.tokens
    return {
      name,
      quantity: 1,
      set: printing?.set,
      collectorNumber: printing?.collectorNumber,
      finish,
      language,
      tags: tags === undefined ? undefined : [...tags],
      note,
      cardId: copy.cardId,
      section: copy.section,
    }
  })
  return {
    entries: scan.entries,
    sectionOrder: scan.sectionOrder,
    frontMatter: scan.front.frontMatter,
    warnings: scan.report.warnings,
    fencedLines: scan.fencedLines,
    advisories: scan.report.advisories,
    diagnostics: scan.report.diagnostics,
  }
}

export { formatWantedListLine, type CardPrinting } from '../card/card-line'
