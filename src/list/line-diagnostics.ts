/**
 * The diagnostic channel the three list-file parsers share.
 *
 * Every parser reports what it read on two string arrays with very different
 * meanings, and two structured arrays beside them:
 *
 * - `warnings` — content the parser could **not** read. The whole-file-rewrite
 *   gates (`unreadableLines`) key off these: a re-serialize would delete the
 *   line, so a save, a sync, or `cleanup` must refuse.
 * - `advisories` — content the parser *did* read, with something the user
 *   should still hear: copies that will become their own lines on the next
 *   save, or a shape suggesting the file's dialect was **not** understood.
 *   Nothing is lost, so these never reach the gates.
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

/** Content the parser could not read: a whole-file rewrite would delete it. */
export type WarningNotice = {
  severity: 'warning'
  /** English plus the catalog key. */
  message: SyncMessage
}

/** A word about content the parser did read. */
export type AdvisoryNotice = {
  severity: 'advisory'
  /** English plus the catalog key. */
  message: SyncMessage
}

/** One warning or advisory as a message, with the channel it belongs to. */
export type ParseNotice = WarningNotice | AdvisoryNotice

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

/** What {@link LineDiagnostics.record} does with an advisory of each kind. */
type AdvisoryRouting =
  /** Kept in {@link LineDiagnostics.diagnostics} only — no message, no notice. */
  | 'structured-only'
  /** An ordinary advisory notice. */
  | 'advise'

/**
 * Where each advisory kind goes; a full record, so a new kind must choose.
 *
 * - `dialect-rewritten` is a read tolerance that *succeeded*, which is not
 *   news. A rewritten export dialect (`(M10) 146` → `(M10:146)`, `*F*` →
 *   `[foil]`) is the grammar working as designed, and one advisory per line
 *   would bury the one advisory that matters — a line whose dialect nobody
 *   recognized — under a hundred that do not. It is still recorded
 *   structurally, where a caller that wants to report or count them can find it.
 */
const ADVISORY_ROUTING = {
  'dialect-rewritten': 'structured-only',
  'quantity-expanded': 'advise',
  'suspect-printing-in-name': 'advise',
} as const satisfies Record<CardLineAdvisoryKind, AdvisoryRouting>

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
    const notice: WarningNotice = { severity: 'warning', message }
    warnings.push(message.message)
    notices.push(notice)
    return notice
  }
  const advise = (message: SyncMessage): ParseNotice => {
    const notice: AdvisoryNotice = { severity: 'advisory', message }
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
      // Worded here, not by the grammar (which returns codes): English plus
      // the key, located at `file:line`.
      const text = (): SyncMessage => cardLineDiagnosticMessage(diagnostic, { file, line })
      if (isCardLineError(diagnostic)) return warn(text())
      const routing: AdvisoryRouting = ADVISORY_ROUTING[diagnostic.kind]
      switch (routing) {
        case 'structured-only':
          return undefined
        case 'advise':
          return advise(text())
      }
    },
    warn,
    advise,
  }
}
