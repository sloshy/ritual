/**
 * The whole-file-rewrite gate: what re-serializing a parsed list file would
 * delete, and the one refusal every gate that will not do it shares — the admin
 * save routes, the move engines, the CSV importer's append, `cleanup` and the
 * sync engines.
 *
 * Split from `markdown-fence.ts`, whose fence grammar the changelog writer reads:
 * that module stays a pure line classifier, and the text the gates speak lives
 * here, beside the parse results it reads.
 */

import type { ParseNotice } from './line-diagnostics'
import { nestSync, syncList, syncMessage, type SyncMessage, type SyncText } from '../sync/message'

/**
 * The shape every list parse result exposes for the "would a whole-file
 * re-serialize lose something?" question.
 */
export type ParsedListContent = {
  /** Lines the parser could not read at all. */
  warnings: readonly string[]
  /** Lines belonging to fenced code blocks (delimiters included). */
  fencedLines: number
}

/** What a gate refusing a rewrite was about to do — the refusal names it. */
export type UnreadableContentAction = 'saving' | 'moving' | 'appending'

/** The single problem entry a file's fenced code blocks contribute. */
function fencedContentMessage(fencedLines: number): SyncMessage {
  return syncMessage('domain.list.fencedContent', { count: fencedLines })
}

/**
 * Everything a whole-file re-serialize would delete from a parsed list file,
 * as English text: the parser's skipped lines, plus a single line accounting
 * for fenced code blocks.
 *
 * Fenced content is prose to the parsers — it produces no per-line warnings, is
 * never a mutation target, and survives every line-preserving edit untouched.
 * The canonical serializers, however, emit only sections and card lines, so a
 * route that rewrites a whole file from parsed entries would drop the block.
 * The gates that refuse such a rewrite (admin saves, `cleanup`, the sync
 * engines) key off this list rather than `warnings` alone.
 *
 * English, like the parser's own `warnings` channel it extends: a load
 * response, a sync report and a whole-file gate all read one language whatever
 * the reader's. {@link unreadableProblems} is the same list as message
 * params, for a refusal worded in the reader's language.
 */
export function unreadableLines(parsed: ParsedListContent): string[] {
  const lines = [...parsed.warnings]
  if (parsed.fencedLines > 0) lines.push(fencedContentMessage(parsed.fencedLines).message)
  return lines
}

/** A parse that also carries its warnings and advisories as messages. */
export type NoticedListContent = ParsedListContent & { notices: readonly ParseNotice[] }

/**
 * {@link unreadableLines} as messages (English plus their key where the parser
 * has one), for a report that renders each in its reader's language.
 */
export function unreadableMessages(parsed: NoticedListContent): SyncMessage[] {
  const messages = parsed.notices
    .filter((notice) => notice.severity === 'warning')
    .map((notice) => notice.message)
  if (parsed.fencedLines > 0) messages.push(fencedContentMessage(parsed.fencedLines))
  return messages
}

/** The advisories of a parse, as messages. */
export function advisoryMessages(parsed: NoticedListContent): SyncMessage[] {
  return parsed.notices
    .filter((notice) => notice.severity === 'advisory')
    .map((notice) => notice.message)
}

/**
 * {@link unreadableLines} as message params for {@link unreadableContentMessage}:
 * the fenced-block entry keyed, so it renders in the reader's language, and the
 * parser's warnings as the text they were recorded with.
 */
export function unreadableProblems(parsed: ParsedListContent): SyncText[] {
  const problems: SyncText[] = [...parsed.warnings]
  if (parsed.fencedLines > 0) problems.push(nestSync(fencedContentMessage(parsed.fencedLines)))
  return problems
}

/**
 * The refusal text every whole-file-rewrite gate shares: English plus its key,
 * so the admin API answers in English and the CLI renders it in its own
 * language.
 *
 * Deliberately not a line count: {@link unreadableLines} collapses a whole
 * fenced block into one entry, so `problems.length` is a count of *problems*,
 * not of lines — each entry states its own extent.
 *
 * @param filePath The list file, named so the fix is obvious.
 * @param problems The result of {@link unreadableProblems}; must be non-empty.
 * @param action What the caller was about to do.
 */
export function unreadableContentMessage(
  filePath: string,
  problems: readonly SyncText[],
  action: UnreadableContentAction,
): SyncMessage {
  return syncMessage('domain.list.unreadableContent', {
    action,
    file: filePath,
    problems: syncList(problems, 'clauses'),
  })
}
