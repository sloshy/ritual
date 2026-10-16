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
 * - `notices` — every warning and advisory as a message (English plus its
 *   catalog key, `src/sync/message.ts`) with its severity, in the order they
 *   were recorded, for a caller that reports them to a reader in another
 *   language: an import surface's JSON, the admin API, MCP. Card-line
 *   diagnostics are worded by `src/card/card-line-message.ts`.
 *
 * Routing between the two string channels is the whole reason this is a shared
 * object rather than three arrays per parser: the severity split is a promise
 * about data loss, and three parsers deciding it separately is exactly how one
 * of them starts blocking saves over an advisory.
 *
 * The two string channels are English by construction: the gates and the
 * reports built on them read one language whatever the reader's. A parser
 * records through {@link LineDiagnostics.warn} / {@link LineDiagnostics.advise}
 * (or {@link LineDiagnostics.record} for a card-line diagnostic) — the channels
 * are read-only to it — so `notices` always holds everything the string
 * channels do.
 */

import {
  isCardLineError,
  type CardLineAdvisoryKind,
  type CardLineDiagnostic,
} from '../card/card-line-grammar'
import { cardLineDiagnosticMessage } from '../card/card-line-message'
import type { SyncMessage } from '../sync/message'

/** What every list-file parser accepts about the content it is handed. */
export type ListFileParseOptions = {
  /**
   * The file the content was read from, which prefixes every rendered
   * diagnostic (`collections/binder.md:12: …`). Absent for pasted text, which
   * renders as `line 12: …` instead.
   */
  file?: string
}

/** Which string channel a {@link ParseNotice} rides: lost content, or a word about read content. */
export type ParseNoticeSeverity = 'warning' | 'advisory'

/** One warning or advisory as a message, with the channel it belongs to. */
export type ParseNotice = {
  severity: ParseNoticeSeverity
  /** English plus the catalog key. */
  message: SyncMessage
}

/** The diagnostic channels a list parse fills, plus the ways to fill them. */
export type LineDiagnostics = {
  /** Content the parser could not read; the whole-file-rewrite gates read these. */
  readonly warnings: readonly string[]
  /** Content the parser read, with a word about how; never a rewrite gate. */
  readonly advisories: readonly string[]
  /** Every card-line diagnostic in structured form, in the order they were recorded. */
  readonly diagnostics: readonly CardLineDiagnostic[]
  /** Every warning and advisory as a message, in the order they were recorded. */
  readonly notices: readonly ParseNotice[]
  /**
   * Record one diagnostic found at 1-based file line `line`, routing it to the
   * channel its severity demands. Returns the notice it recorded, or
   * `undefined` for a diagnostic kept in structured form only.
   */
  record(diagnostic: CardLineDiagnostic, line: number): ParseNotice | undefined
  /** Record content the parser could not read; returns the notice recorded. */
  warn(message: SyncMessage): ParseNotice
  /** Record a word about content the parser did read; returns the notice recorded. */
  advise(message: SyncMessage): ParseNotice
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
  const notices: ParseNotice[] = []
  const warn = (message: SyncMessage): ParseNotice => {
    const notice: ParseNotice = { severity: 'warning', message }
    warnings.push(message.message)
    notices.push(notice)
    return notice
  }
  const advise = (message: SyncMessage): ParseNotice => {
    const notice: ParseNotice = { severity: 'advisory', message }
    advisories.push(message.message)
    notices.push(notice)
    return notice
  }
  return {
    warnings,
    advisories,
    diagnostics,
    notices,
    record(diagnostic, line) {
      diagnostics.push(diagnostic)
      if (!isCardLineError(diagnostic) && diagnostic.kind === STRUCTURED_ONLY_ADVISORY) {
        return undefined
      }
      // Worded here, not by the grammar (which returns codes): English plus
      // the key, located at `file:line`.
      const text = cardLineDiagnosticMessage(diagnostic, { file, line })
      return isCardLineError(diagnostic) ? warn(text) : advise(text)
    },
    warn,
    advise,
  }
}
