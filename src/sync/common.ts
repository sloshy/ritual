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

import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
import {
  syncElapsed,
  syncMessage,
  syncRef,
  type SyncMessage,
  type SyncParam,
  type SyncReasonFields,
} from './message'

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
): SyncMessage | null {
  if (!filter || skipped <= 0) return null
  return syncMessage(SKIPPED_MESSAGE[filter], { count: skipped })
}

/**
 * What {@link wouldRemoveAll} weighs. Named rather than positional: which side
 * is the source flips with the direction, and a swapped pair is the one bug
 * this guard cannot afford.
 */
export type RemoveAllCheck = {
  /** The run's change filter. */
  only: SyncChangeFilter | undefined
  /** How much the side being copied from holds (Archidekt on a pull). */
  source: number
  /** How much the side being written to holds (the local files on a pull). */
  destination: number
}

/**
 * Whether a run would leave its destination with nothing in it: the side it
 * copies from (Archidekt on a pull, the local files on a push) is empty while
 * the side it writes to is not, and the run's filter lets removals through.
 *
 * Such a run is refused unless the caller opted in explicitly (the CLI's
 * `--allow-remove-all`): an empty source reads exactly like "everything was
 * deleted", but far more often means a new or emptied account, the wrong deck
 * linked, or a file that lost its lines — and mirroring it would delete every
 * card the destination holds. An additions-only run cannot remove anything, so
 * it is never refused. Shared by both sync engines so the rule cannot drift.
 */
export function wouldRemoveAll(run: RemoveAllCheck): boolean {
  return run.only !== 'additions' && run.source === 0 && run.destination > 0
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

/** The precision the line reports a wait at: a tenth of a second. */
const REPORTED_PRECISION_MS = 100

/**
 * The log line for a 429 backoff wait, shared by both sync engines so the CLI,
 * the admin progress panels, and the MCP report all describe it identically.
 * The wait is a duration param, so its number and unit follow the reader's
 * locale (`2 seconds`). It rounds up to a tenth of a second — never
 * under-reported, and a sub-second wait (a short server-sent Retry-After, a
 * pacing top-up) still reads accurately instead of inflating to a whole second.
 * The floor of one tenth is unreachable from real waits (the client's minimum
 * backoff is well above it); it guards a future producer from a line that
 * claims a zero-second wait.
 */
export function describeRateLimitWait(wait: RateLimitWait): SyncMessage {
  const steps = Math.max(1, Math.ceil(wait.waitMs / REPORTED_PRECISION_MS))
  return syncMessage('domain.sync.rateLimitWait', {
    wait: syncElapsed(steps * REPORTED_PRECISION_MS),
    retry: wait.retry,
    maxRetries: wait.maxRetries,
  })
}

// ── Run reporting ─────────────────────────────────────────────────────

/**
 * The severity every sync engine labels its log lines with. `detail` is the
 * per-card listing under a change summary — information a surface may show or
 * hide as a whole (the CLI prints it only under `--verbose`).
 */
export type SyncLogLevel = 'info' | 'warn' | 'error' | 'detail'

/** Every outcome one thing a run covered (a deck, a collection list) can have. */
export const SYNC_ITEM_STATUSES = ['synced', 'failed', 'skipped'] as const

/** What happened to one thing a run covered (a deck, a collection list). */
export type SyncItemStatus = (typeof SYNC_ITEM_STATUSES)[number]

/**
 * What came of one item a run covered, as a fixed code a script can branch on —
 * the `reason` beside it is prose, and follows nothing a program should match.
 *
 * - `changed` — the item synced and something was written locally or sent to
 *   Archidekt. For a collection push run with `--csv-file`, that includes
 *   copies written to the CSV file for a manual upload (`pending`), even though
 *   they have not reached Archidekt yet.
 * - `unchanged` — the item already matched; nothing was done to it. That
 *   includes a deck push whose diff, once planned, had nothing to send (every
 *   printing change already what Archidekt holds).
 * - `dry-run` — a preview: `reason` summarizes what a real run would change.
 * - `cancelled` — the caller cancelled the run before it reached the item.
 * - `not-run` — the run refused before it reached the item (a bad pull
 *   destination, an ambiguity nobody decided, additions a push would not send);
 *   the run's own error says why.
 *
 * Both engines honour cancellation at **item boundaries only**: the item in
 * flight finishes (a deck is never half-pushed, a list never half-written), and
 * every item after it is reported `skipped` with the `cancelled` outcome rather
 * than left out of the report. Cancelling is not a failure, so `failedCount`
 * never counts it. A failed item, and one skipped for any other reason (a deck
 * the account does not own), has no outcome: its `status` and `reason` say it
 * all.
 */
export const SYNC_ITEM_OUTCOMES = [
  'changed',
  'unchanged',
  'dry-run',
  'cancelled',
  'not-run',
] as const

/** See {@link SYNC_ITEM_OUTCOMES}. */
export type SyncItemOutcome = (typeof SYNC_ITEM_OUTCOMES)[number]

/** The outcomes only a skipped item can carry: the run never reached it. */
export type UnreachedOutcome = Extract<SyncItemOutcome, 'cancelled' | 'not-run'>

/** What a synced item came to: every outcome but the two a skip says. */
export type SyncedOutcome = Exclude<SyncItemOutcome, UnreachedOutcome>

/**
 * An item's status and outcome together, with the outcome rule in the type: a
 * synced item always says what came of it, a skipped one says only that the run
 * never reached it (or nothing, for any other skip), and a failed one says
 * nothing — its reason does.
 */
export type SyncItemStanding =
  | { status: 'synced'; outcome: SyncedOutcome }
  | { status: 'skipped'; outcome?: UnreachedOutcome }
  | { status: 'failed'; outcome?: never }

/** The status, outcome and reason every engine's per-item result shares. */
export type SyncItemResultBase = SyncReasonFields & SyncItemStanding

/** The reason a skipped item carries when the run was cancelled before it started. */
export function cancelledReason(): SyncMessage {
  return syncMessage('domain.sync.reasonCancelled')
}

/** The reason a synced item carries when it already matched. */
export function noChangesReason(): SyncMessage {
  return syncMessage('domain.sync.reasonNoChanges')
}

/**
 * The reason a dry run's item carries: what a real run would change. `summary`
 * is the item's change summary — a deck's or list's `Changes:` counts, or a
 * push's count of card changes it would send.
 */
export function dryRunReason(summary: SyncParam): SyncMessage {
  return syncMessage('domain.sync.reasonDryRun', { summary })
}

/**
 * Items a cancellation never reached: skipped, but not "nothing to do" — a
 * summary counts them apart from ordinary skips. Items a *refused* run never
 * reached (`not-run`) are not counted: the run's error already says why it
 * stopped, and "cancelled with N not started" would be the wrong story.
 */
export function countUnstartedItems(items: readonly SyncItemResultBase[]): number {
  return items.filter((item) => item.outcome === 'cancelled').length
}

/** The run-level log line a cancelled run ends on; assignable to any {@link SyncEvent}. */
export type SyncCancellationLog = SyncMessage & {
  kind: 'log'
  level: 'warn'
  item: null
}

/** Keys only, resolved at call time — see {@link SKIPPED_MESSAGE}. */
const UNSTARTED_COUNT = {
  deck: 'domain.count.decks',
  collection: 'domain.count.collectionLists',
} as const satisfies Record<SyncSubjectKind, MessageKey>

/**
 * The run-level warning a cancelled run ends on, counting what it left
 * unsynced in the engine's own noun. The plural comes from the catalog.
 */
export function syncCancellationLog(kind: SyncSubjectKind, remaining: number): SyncCancellationLog {
  return {
    kind: 'log',
    level: 'warn',
    item: null,
    ...syncMessage('domain.sync.cancelled', {
      items: syncRef(UNSTARTED_COUNT[kind], { count: remaining }),
    }),
  }
}

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
  /**
   * One message per line the parser skipped (and one for the file's fenced
   * blocks): English plus its key, rendered in each reader's language.
   */
  warnings: SyncMessage[]
}

/**
 * Decide whether sources carrying unreadable lines may sync anyway. Called once,
 * before anything syncs, with every affected source; `true` syncs them (dropping
 * those lines), anything else fails them.
 */
export type ConfirmUnreadable = (sources: UnreadableSource[]) => Promise<boolean> | boolean

/** Which engine is asking, for the wording of {@link unreadableConsequence}. */
export type SyncSubjectKind = 'deck' | 'collection'

/** A deck sync's one sentence, or a collection sync's per direction. */
type UnreadableConsequenceKey = 'deck' | SyncDirection

/** Keys only, resolved at call time — see {@link SKIPPED_MESSAGE}. */
const UNREADABLE_CONSEQUENCE = {
  deck: 'domain.sync.unreadableDeckConsequence',
  pull: 'domain.sync.unreadablePullConsequence',
  push: 'domain.sync.unreadablePushConsequence',
} as const satisfies Record<UnreadableConsequenceKey, MessageKey>

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
  return t(UNREADABLE_CONSEQUENCE[kind === 'deck' ? 'deck' : direction])
}

// ── Run events ────────────────────────────────────────────────────────

/**
 * One step of a sync run, emitted as it happens.
 *
 * Shared by both engines so every surface in front of them — the CLI renderer,
 * the admin route's progress mapping, the admin SPA's run panel — reads one
 * vocabulary. `item` is whatever the run works through (a deck, a collection
 * list): a `log` naming one belongs to it and is indented under its start line,
 * while `item: null` is about the run as a whole, including sources that could
 * not be loaded at all. Only the result payload differs between engines, so it
 * is the parameter.
 */
export type SyncEvent<TResult> =
  | { kind: 'item-start'; item: string; index: number; total: number }
  | (SyncMessage & { kind: 'log'; level: SyncLogLevel; item: string | null })
  | { kind: 'item-result'; result: TResult }
  /** Emitted before anything syncs, when some source has lines the parser cannot read. */
  | { kind: 'unreadable-lines'; items: UnreadableSource[] }

/** How a surface receives a run's {@link SyncEvent}s. */
export type SyncEventHandler<TResult> = (event: SyncEvent<TResult>) => void
