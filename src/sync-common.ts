/**
 * The vocabulary every Archidekt sync speaks — decks, collections, and whatever
 * comes next.
 *
 * Two engines (`deck-sync/`, `collection-sync/`) and four surfaces in front of
 * them (the CLI commands, the admin endpoints, the admin SPA, the MCP tools)
 * have to agree on a direction, a change filter, how a source that could not be
 * fully read is described, and how a run reports what it did. Declaring those
 * once here keeps them from drifting, and keeps a consumer that only needs the
 * words — the MCP server, the browser bundle — from pulling a node-only engine
 * into its module graph.
 */

import type { MessageKey } from './i18n/messages/en'
import { t } from './i18n/t'

// ── Direction ─────────────────────────────────────────────────────────

export const SYNC_DIRECTIONS = ['push', 'pull'] as const

/** The sync direction: `push` (local → Archidekt) or `pull` (Archidekt → local). */
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number]

// ── Change filter ─────────────────────────────────────────────────────

export const SYNC_CHANGE_FILTERS = ['additions', 'removals'] as const

/**
 * Narrows a sync to changes that add cards to, or remove them from, the
 * destination.
 *
 * The vocabulary is **destination-relative**: the destination is whatever the
 * run writes to, so a pull's additions are new local lines while a push's
 * additions are new (or grown) remote records. Quantity increases count as
 * additions and decreases as removals, so a filtered run applies one side and
 * reports the other as skipped rather than silently ignoring it.
 */
export type SyncChangeFilter = (typeof SYNC_CHANGE_FILTERS)[number]

/**
 * The line reporting what each filter dropped, as a {@link MessageKey} rather
 * than rendered text: this table is evaluated once at module load, so a string
 * would freeze the sentence in whatever language was active at import.
 */
const SKIPPED_MESSAGE = {
  additions: 'domain.sync.skippedRemovals',
  removals: 'domain.sync.skippedAdditions',
} as const satisfies Record<SyncChangeFilter, MessageKey>

/**
 * The log line for what a filter left out, e.g.
 * `Skipped 3 removals (applying additions only).`
 *
 * Worded without naming a flag: the same line is printed by the CLI, forwarded
 * over SSE into the admin site's progress panel — where the user picked a
 * segmented control, not a `--only` flag — and echoed in the MCP report.
 *
 * Returns null when there is nothing to say — no filter, or a filter that
 * happened to drop nothing — so callers can emit it unconditionally.
 */
export function describeSkippedChanges(
  filter: SyncChangeFilter | undefined,
  skipped: number,
): string | null {
  if (!filter || skipped <= 0) return null
  return t(SKIPPED_MESSAGE[filter], { count: skipped })
}

// ── Rate limiting ─────────────────────────────────────────────────────

/** One wait the Archidekt client is about to take after a 429 response. */
export type RateLimitWait = {
  /** How long the client sleeps before retrying, in milliseconds. */
  waitMs: number
  /** Which retry this wait precedes, 1-based. */
  retry: number
  /** The retry budget — after this many 429s the request fails for real. */
  maxRetries: number
}

/**
 * The smallest wait the line will report. Unreachable from real waits (the
 * client's minimum backoff is well above it) — it guards a future producer
 * from emitting a line that claims a zero-second wait.
 */
const MIN_REPORTED_SECONDS = 0.1

/**
 * The log line for a 429 backoff wait, shared by both sync engines so the CLI,
 * the admin progress panels, and the MCP report all describe it identically.
 * Waits round up to a tenth of a second — never under-reported, and a
 * sub-second wait (a short server-sent Retry-After, a pacing top-up) still
 * reads accurately instead of inflating to a whole second.
 */
export function describeRateLimitWait(wait: RateLimitWait): string {
  return t('domain.sync.rateLimitWait', {
    seconds: Math.max(MIN_REPORTED_SECONDS, Math.ceil(wait.waitMs / 100) / 10),
    retry: wait.retry,
    maxRetries: wait.maxRetries,
  })
}

// ── Run reporting ─────────────────────────────────────────────────────

/** The severity every sync engine labels its log lines with. */
export type SyncLogLevel = 'info' | 'warn' | 'error'

/** What happened to one thing a run covered (a deck, a collection list). */
export type SyncItemStatus = 'synced' | 'failed' | 'skipped'

/**
 * A file the parser could not fully read. Syncing re-serializes the file (a
 * pull) or reads it as the truth (a push), so every line listed in `warnings`
 * would be lost either locally or remotely — which is why both engines ask
 * before syncing one.
 */
export type UnreadableSource = {
  /** The deck's or list's display name. */
  name: string
  /** The file's basename, for pointing the user at what to fix. */
  file: string
  /** One message per line the parser skipped. */
  warnings: string[]
}

/**
 * Decide whether sources carrying unreadable lines may sync anyway. Called once,
 * before anything syncs, with every affected source; `true` syncs them (dropping
 * those lines), anything else fails them.
 */
export type ConfirmUnreadable = (sources: UnreadableSource[]) => Promise<boolean> | boolean

/** Which engine is asking, for the wording of {@link unreadableConsequence}. */
export type SyncSubjectKind = 'deck' | 'collection'

/**
 * What accepting a source's unreadable lines costs.
 *
 * A deck sync re-serializes its file in either direction, so the sentence does
 * not depend on the direction. A collection sync's does: a pull rewrites the
 * list file and drops those lines, while a push reads the file as the truth and
 * so deletes the cards it could not see from the account.
 *
 * Shared by the CLI prompts and the admin confirmation panels, so the sentence a
 * user reads before agreeing to lose lines is the same one everywhere.
 */
export function unreadableConsequence(kind: SyncSubjectKind, direction: SyncDirection): string {
  if (kind === 'deck') {
    return 'Syncing rewrites the deck file, so these lines would be removed:'
  }
  return direction === 'pull'
    ? 'A pull rewrites the list file, so these lines would be removed:'
    : 'A push treats the list file as the truth, so the cards on these lines would be removed from your Archidekt collection:'
}
