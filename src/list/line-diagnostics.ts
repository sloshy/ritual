/**
 * The diagnostic channel the three list-file parsers share.
 *
 * Every parser reports what it read on two string arrays with very different
 * meanings, and one structured array beside them:
 *
 * - `warnings` — content the parser could **not** read. The whole-file-rewrite
 *   gates (`unreadableLines`) key off these: a re-serialize would delete the
 *   line, so a save, a sync, or `cleanup` must refuse.
 * - `advisories` — content the parser *did* read, with something the user
 *   should still hear: copies that will become their own lines on the next
 *   save, or a shape suggesting the file's dialect was **not** understood.
 *   Nothing is lost, so these must never reach the gates.
 * - `diagnostics` — the same events as {@link CardLineDiagnostic} values, for
 *   callers that want the code, the offending token and its column rather than
 *   a rendered sentence.
 *
 * Routing between the two string channels is the whole reason this is a shared
 * object rather than three arrays per parser: the severity split is a promise
 * about data loss, and three parsers deciding it separately is exactly how one
 * of them starts blocking saves over an advisory.
 *
 * English by construction, like the grammar it renders: card-line diagnostics
 * are not prose (AGENTS.md, "Card-line grammar is not prose").
 */

import {
  formatCardLineDiagnostic,
  isCardLineError,
  type CardLineAdvisoryKind,
  type CardLineDiagnostic,
} from '../card/card-line-grammar'

/** What every list-file parser accepts about the content it is handed. */
export type ListFileParseOptions = {
  /**
   * The file the content was read from, which prefixes every rendered
   * diagnostic (`collections/binder.md:12: …`). Absent for pasted text, which
   * renders as `line 12: …` instead.
   */
  file?: string
}

/** The three diagnostic channels a list parse fills, plus the one way to fill them. */
export type LineDiagnostics = {
  /** Content the parser could not read; the whole-file-rewrite gates read these. */
  readonly warnings: string[]
  /** Content the parser read, with a word about how; never a rewrite gate. */
  readonly advisories: string[]
  /** Every diagnostic in structured form, in the order they were recorded. */
  readonly diagnostics: CardLineDiagnostic[]
  /**
   * Record one diagnostic found at 1-based file line `line`, routing it to the
   * channel its severity demands.
   */
  record(diagnostic: CardLineDiagnostic, line: number): void
}

/**
 * A read tolerance that *succeeded* is not news. A rewritten export dialect
 * (`(M10) 146` → `(M10:146)`, `*F*` → `[foil]`) is the grammar working as
 * designed, and one advisory per line would bury the one advisory that matters
 * — a line whose dialect nobody recognized — under a hundred that do not. Such
 * a rewrite is still recorded structurally in {@link LineDiagnostics.diagnostics},
 * where a caller that wants to report or count them can find it.
 */
const STRUCTURED_ONLY_ADVISORY: CardLineAdvisoryKind = 'dialect-rewritten'

/**
 * A fresh diagnostic channel. `file`, when known, prefixes every rendered
 * string with `path:line` so a warning names the file it came from.
 */
export function createLineDiagnostics(file?: string): LineDiagnostics {
  const warnings: string[] = []
  const advisories: string[] = []
  const diagnostics: CardLineDiagnostic[] = []
  return {
    warnings,
    advisories,
    diagnostics,
    record(diagnostic, line) {
      diagnostics.push(diagnostic)
      if (!isCardLineError(diagnostic) && diagnostic.kind === STRUCTURED_ONLY_ADVISORY) return
      const text = formatCardLineDiagnostic(diagnostic, { file, line })
      if (isCardLineError(diagnostic)) warnings.push(text)
      else advisories.push(text)
    },
  }
}
