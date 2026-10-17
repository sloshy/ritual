/**
 * What Archidekt answers when a request fails, read for the error that reports
 * it: the HTTP status as a number — its reason phrase dropped, since the number
 * says the same in no particular language — and Archidekt's own reason, quoted.
 * Shared by the deck and collection client (`ArchidektClient`) and the login
 * (`ArchidektAuth`), so every Archidekt failure reads, and nests, the same way.
 *
 * It lives beside the login rather than the client because `src/auth` sits a
 * layer below `src/clients` (see the `ritual/no-upward-import` layer table):
 * the client may import from here, the login could not import from there.
 */

import type { MessageKey } from '../i18n/messages/en'
import {
  isNonEmpty,
  syncList,
  SyncMessageError,
  syncRef,
  toSyncMessage,
  type NonEmpty,
  type PlaceholderDrift,
  type SyncMessage,
  type SyncMessageParams,
  type SyncParam,
} from '../sync/message'
import { isRecord } from '../util/json'
import { parsedJson, quotedReply } from '../util/reply-text'

/** The most of one of Archidekt's reasons (or of a link it served) an error quotes, in characters. */
export const MAX_REASON_CHARS = 300

/** The most of a reply without a reason an error quotes in its place, in characters. */
const MAX_QUOTED_BODY_CHARS = 500

/** The most of Archidekt's reasons one error quotes; the rest are counted. */
const MAX_REASONS = 3

/** The most characters the quoted reasons of one error add up to; the rest are counted. */
const MAX_REASONS_TOTAL_CHARS = 500

/**
 * A failed Archidekt request: its message (English plus its key, as for any
 * sync-owned error), and the HTTP status Archidekt answered with — what lets a
 * route tell "Archidekt has no such thing" (a 4xx) from "Archidekt failed"
 * (anything else) when it picks its own status.
 *
 * A **2xx** `upstreamStatus` means Archidekt answered, but with a reply Ritual
 * could not use (not JSON, or missing what the request needs): a failure of
 * Archidekt's, never a refusal of the caller's request.
 */
export class ArchidektRequestError extends SyncMessageError {
  readonly upstreamStatus: number
  constructor(message: SyncMessage, upstreamStatus: number, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ArchidektRequestError'
    this.upstreamStatus = upstreamStatus
  }
}

/**
 * The human reasons in one of Archidekt's error replies: Django REST
 * framework's `non_field_errors` list (a refused login) and its `detail`
 * (a refused token, a missing deck), each quoted — control characters
 * stripped, capped. A reply with neither (an HTML error page, an empty body)
 * gives none: its status says as much as it would.
 *
 * At most {@link MAX_REASONS} are quoted, together no longer than
 * {@link MAX_REASONS_TOTAL_CHARS}; any beyond are counted in a closing
 * "N more" (`domain.sync.moreReasons`), so a reply listing hundreds
 * of errors cannot flood the message that quotes it.
 */
export function archidektReasons(body: string): SyncParam[] {
  const json = parsedJson(body)
  if (!isRecord(json)) return []
  const found: string[] = []
  const { non_field_errors: nonField, detail } = json
  if (Array.isArray(nonField)) {
    const list: readonly unknown[] = nonField
    for (const item of list) if (typeof item === 'string') found.push(item)
  }
  if (typeof detail === 'string') found.push(detail)
  const quoted = found
    .map((reason) => quotedReply(reason, MAX_REASON_CHARS))
    .filter((r) => r !== '')

  const kept: SyncParam[] = []
  let total = 0
  for (const reason of quoted) {
    const length = [...reason].length
    // The first always fits: it is capped below the total on its own.
    if (
      kept.length === MAX_REASONS ||
      (kept.length > 0 && total + length > MAX_REASONS_TOTAL_CHARS)
    ) {
      break
    }
    kept.push(reason)
    total += length
  }
  const more = quoted.length - kept.length
  if (more > 0) kept.push(syncRef('domain.sync.moreReasons', { count: more }))
  return kept
}

/**
 * The reasons a failed data request is reported with: {@link archidektReasons}
 * when the reply holds any, else the reply itself, quoted and capped — a write
 * Archidekt refuses explains itself in per-field errors
 * (`{"cards":["This field may not be null."]}`) that hold no `detail`. A reply
 * that is markup (an HTML error page) or empty gives none.
 */
export function replyReasons(body: string): SyncParam[] {
  const reasons = archidektReasons(body)
  if (reasons.length > 0) return reasons
  if (body.trimStart().startsWith('<')) return []
  const quoted = quotedReply(body, MAX_QUOTED_BODY_CHARS)
  return quoted === '' ? [] : [quoted]
}

/** One reason as itself, several as independent clauses joined in the reader's language. */
export function reasonParam(reasons: NonEmpty<SyncParam>): SyncParam {
  return reasons.length === 1 ? reasons[0] : syncList(reasons, 'clauses')
}

/** A failure Archidekt gave no reason for, and the same failure quoting its reason. */
export type FailureKeyPair = { plain: MessageKey; withReason: MessageKey }

/**
 * The requests of a request → key-pair table whose keys' placeholders disagree
 * with the params the request supplies (`Params[R]`, beside the `status` every
 * failure carries and the `reason` the second key adds), or `never` when all
 * agree — the compile-time check {@link failureMessage}'s table lookup needs.
 */
export type FailureKeyDrift<
  R extends string,
  Table extends Record<R, FailureKeyPair>,
  Params extends Record<R, string>,
> =
  | PlaceholderDrift<R, { [K in R]: Table[K]['plain'] }, { [K in R]: Params[K] | 'status' }>
  | PlaceholderDrift<
      R,
      { [K in R]: Table[K]['withReason'] },
      { [K in R]: Params[K] | 'status' | 'reason' }
    >

/**
 * A failed Archidekt request as a message: the pair's first key when Archidekt
 * gave no reason, its second quoting the reasons otherwise, with `params` and
 * the status as a number. The pair comes from a table checked by
 * {@link FailureKeyDrift}.
 */
export function failureMessage(
  keys: FailureKeyPair,
  params: SyncMessageParams,
  status: number,
  reasons: readonly SyncParam[],
): SyncMessage {
  return isNonEmpty(reasons)
    ? toSyncMessage({
        messageKey: keys.withReason,
        messageParams: { ...params, status, reason: reasonParam(reasons) },
      })
    : toSyncMessage({ messageKey: keys.plain, messageParams: { ...params, status } })
}
