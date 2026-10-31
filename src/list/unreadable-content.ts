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
 * re-serialize lose something?" question: its notices (the `warning` ones are
 * the lines the parser could not read) and its fenced lines.
 *
 * Deliberately **not** the parser's `warnings` string channel. Every gate —
 * the English lines a load reports and the keyed problems a save refuses
 * with — reads the one `notices` channel, so the two can never disagree about
 * what a rewrite would delete.
 */
export type ParsedListContent = {
  /** Every warning and advisory the parse recorded, as messages. */
  notices: readonly ParseNotice[]
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
 * engines) key off this list — or its message forms below — never the
 * parser's own `warnings` strings.
 *
 * The English of {@link unreadableMessages}, for a reader that wants one
 * language whatever the reader's; {@link unreadableMessages} and
 * {@link unreadableProblems} are the same list as messages, for a surface that
 * renders it in the reader's language.
 */
export function unreadableLines(parsed: ParsedListContent): string[] {
  return unreadableMessages(parsed).map((message) => message.message)
}

/**
 * {@link unreadableLines} as messages (English plus their key where the parser
 * has one), for a report that renders each in its reader's language.
 */
export function unreadableMessages(parsed: ParsedListContent): SyncMessage[] {
  const messages = rewriteBlockingMessages(parsed)
  if (parsed.fencedLines > 0) messages.push(fencedContentMessage(parsed.fencedLines))
  return messages
}

/**
 * The lines a whole-file rewrite would lose, as messages —
 * {@link unreadableMessages} without the fenced-block entry, for a reader that
 * wants the parser's own per-line notices only.
 */
export function rewriteBlockingMessages(parsed: Pick<ParsedListContent, 'notices'>): SyncMessage[] {
  return parsed.notices
    .filter((notice) => notice.severity === 'warning')
    .map((notice) => notice.message)
}

/** The advisories of a parse, as messages: words about lines it read, never a rewrite gate. */
export function advisoryMessages(parsed: Pick<ParsedListContent, 'notices'>): SyncMessage[] {
  return parsed.notices
    .filter((notice) => notice.severity === 'advisory')
    .map((notice) => notice.message)
}

/**
 * What a whole-file rewrite would *delete*, as message params for
 * {@link unreadableContentMessage}: the lines the parser could not read and
 * the fenced-block entry, each nested unrendered so the refusal renders whole
 * in the reader's language.
 */
export function unreadableProblems(parsed: ParsedListContent): SyncText[] {
  return unreadableMessages(parsed).map(nestSync)
}

/**
 * The one refusal every whole-file-rewrite gate gives — what the rewrite would
 * delete ({@link unreadableContentMessage}) — or `undefined` when it may proceed.
 */
export function rewriteRefusal(
  filePath: string,
  parsed: ParsedListContent,
  action: UnreadableContentAction,
): SyncMessage | undefined {
  const lost = unreadableProblems(parsed)
  return lost.length > 0 ? unreadableContentMessage(filePath, lost, action) : undefined
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
