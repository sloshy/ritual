import { ArchidektAuth } from '../../auth/ArchidektAuth'
import { FileTokenStore } from '../../auth/FileTokenStore'
import type { ArchidektLoginStatus } from '../../auth/interfaces'
import { getDecksDir } from '../../config/ritual-config'
import {
  listSyncableDecks,
  runDeckSync,
  type DeckSyncDeckResult,
  type DeckSyncEventHandler,
  type DeckSyncReport,
  type DeckSyncStatus,
  type SyncableDeck,
} from '../../deck-sync/engine'
import { countUnstartedItems, type SyncDirection } from '../../sync/common'
import type { RouteProgressSink } from '../../util/progress'
import { apiHandler } from '../utils'
import { apiMessage, type ApiMessage } from '../../api/result'
import { renderSyncSummaryEnglish, type SyncSummary, type SyncSummaryClause } from './sync-summary'
import {
  runSyncRoute,
  streamSyncRoute,
  type SyncDoneEvent,
  type SyncErrorEvent,
  type SyncRouteConfig,
  type SyncRunOutcome,
  type SyncRunResponse,
} from './sync-route'
import { autoCommitAndPush } from './save-helpers'
import {
  isRecord,
  parseNameArray,
  parseSyncRequestCore,
  readBooleanFlags,
  type BooleanFieldsOf,
  type SyncRequestCore,
} from './sync-request'

/**
 * Shown whenever the stored Archidekt token cannot be used or refreshed.
 *
 * Rendered from the catalog rather than written out again, so the English a
 * script matches on and the sentence the admin UI translates can never drift.
 *
 * A function rather than a module-level constant: message namespaces are
 * registered by the surface entry point (`src/i18n/register/*`, plan §4.2),
 * which runs after every module body has been evaluated. Rendering at module
 * scope would freeze the key string into the response.
 */
function loginRequiredMessage(): ApiMessage {
  return apiMessage('admin.api.deckSync.loginRequired')
}

/** {@link loginRequiredMessage}'s rendered English, for callers that only want the text. */
export function loginRequiredText(): string {
  return loginRequiredMessage().message
}

/** `GET /api/deck-sync`: the syncable decks and the state of the Archidekt session. */
export type DeckSyncStatusResponse = {
  success: true
  decks: SyncableDeck[]
  archidekt: ArchidektLoginStatus
}

/**
 * A validated sync request, however it arrived (JSON body or query string).
 * Everything but the deck list is common to both syncs, so it is described once
 * on {@link SyncRequestCore}.
 */
export type DeckSyncRequest = SyncRequestCore & {
  /** Deck names/slugs to sync; empty syncs every Archidekt-linked deck. */
  decks: string[]
  /**
   * Push a deck whose remote copy changed since its recorded `sourceUpdatedAt`,
   * overwriting those remote changes. Without it such a deck fails — the CLI
   * spells this `--force`.
   */
  force: boolean
  /**
   * Also sync each card's exact printing — set, collector number, and finish.
   * Off by default; the CLI spells this `--sync-printings`.
   */
  syncPrintings: boolean
}

/** `POST /api/deck-sync`: the run's outcome — see {@link SyncRunResponse}. */
export type DeckSyncRunResponse = SyncRunResponse<DeckSyncReport>

// ── Request parsing ───────────────────────────────────────────────────

/**
 * Validate a `POST /api/deck-sync` body. Returns the request or a message
 * describing why it is not one. The direction, change filter, and flags are
 * validated the same way the collection sync validates them
 * ({@link parseSyncRequestCore}); only the list of decks is this request's own.
 */
export function parseDeckSyncBody(value: unknown): DeckSyncRequest | string {
  if (!isRecord(value)) return 'Invalid request body'

  const core = parseSyncRequestCore(value)
  if (typeof core === 'string') return core

  const decks = parseNameArray(value.decks, { field: 'decks', noun: 'deck names', blanks: 'drop' })
  if (typeof decks === 'string') return decks

  if (value.force !== undefined && typeof value.force !== 'boolean') {
    return 'force must be a boolean'
  }
  if (value.syncPrintings !== undefined && typeof value.syncPrintings !== 'boolean') {
    return 'syncPrintings must be a boolean'
  }

  return {
    ...core,
    decks,
    force: value.force === true,
    syncPrintings: value.syncPrintings === true,
  }
}

/**
 * Every boolean field of a request must appear here, or the query string would
 * silently revert it to `false`. `satisfies` makes leaving one out a type error.
 */
const BOOLEAN_FLAGS = {
  dryRun: true,
  ignoreUnreadableLines: true,
  force: true,
  syncPrintings: true,
} as const satisfies Record<BooleanFieldsOf<DeckSyncRequest>, true>

/**
 * Validate the query string the SSE stream is opened with — `EventSource` can
 * only issue a bodyless GET, so the same request arrives as
 * `?direction=pull&deck=one&deck=two&dryRun=true`.
 *
 * Boolean flags are validated rather than coerced: they decide whether files are
 * written, changes pushed, and unreadable lines deleted, so an unrecognized
 * value must be rejected instead of quietly meaning "no".
 *
 * `only` is a string enum rather than a flag, so it is handed to the body parser
 * as-is and validated there — an absent param and an empty one both mean
 * "apply everything".
 */
export function parseDeckSyncQuery(params: URLSearchParams): DeckSyncRequest | string {
  const flags = readBooleanFlags(params, BOOLEAN_FLAGS)
  if (typeof flags === 'string') return flags
  return parseDeckSyncBody({
    direction: params.get('direction') ?? undefined,
    decks: params.getAll('deck'),
    only: params.get('only') ?? undefined,
    ...flags,
  })
}

// ── Running a sync ────────────────────────────────────────────────────

function countStatus(report: DeckSyncReport, status: DeckSyncStatus): number {
  return report.decks.filter((deck) => deck.status === status).length
}

/**
 * The lead clause, one key per verb.
 *
 * Split by verb rather than spliced from `{verb} {count} deck(s)` because the
 * count needs a plural table and the verb needs a selector, and one level of
 * each is all a catalog value gets — nesting them is what the plan says to
 * solve by splitting the key instead.
 */
const RUN_VERB_KEYS = {
  pull: 'admin.api.deckSync.pulled',
  push: 'admin.api.deckSync.pushed',
} as const satisfies Record<SyncDirection, string>

/**
 * A completed run's summary as keyed clauses. The structured producer;
 * {@link describeRun} is its English rendering.
 */
export function summarizeRun(report: DeckSyncReport, dryRun: boolean): SyncSummary {
  if (report.decks.length === 0) {
    return { clauses: [apiMessage('admin.api.deckSync.noDecks')] }
  }

  const synced = countStatus(report, 'synced')
  const clauses: SyncSummaryClause[] = [
    dryRun
      ? apiMessage('admin.api.deckSync.previewed', { count: synced })
      : apiMessage(RUN_VERB_KEYS[report.direction], { count: synced }),
  ]

  // Decks a cancellation never reached are skipped too, but they get their own
  // clause: "3 skipped" would read as three decks with nothing to do.
  const unstarted = countUnstartedItems(report.decks)
  const skipped = countStatus(report, 'skipped') - unstarted
  if (skipped > 0) clauses.push(apiMessage('admin.api.deckSync.skipped', { count: skipped }))
  if (report.failedCount > 0) {
    clauses.push(apiMessage('admin.api.deckSync.failed', { count: report.failedCount }))
  }
  if (report.cancelled) {
    clauses.push(apiMessage('admin.api.deckSync.cancelled', { count: unstarted }))
  }
  return { clauses }
}

/**
 * A one-line English summary of a completed run — what the response's `message`
 * carries, and what a client without a translator shows.
 */
export function describeRun(report: DeckSyncReport, dryRun: boolean): string {
  return renderSyncSummaryEnglish(summarizeRun(report, dryRun))
}

/**
 * Resolve the Archidekt token, run the sync, and auto-commit any deck files it
 * wrote. Shared by the JSON and SSE endpoints so both enforce the same login
 * check and produce the same report — including its `unreadable` list, which is
 * how a non-streaming caller learns which lines a retry would delete.
 */
async function performSync(
  request: DeckSyncRequest,
  onEvent?: DeckSyncEventHandler,
  signal?: AbortSignal,
): Promise<SyncRunOutcome<DeckSyncReport>> {
  const token = await new ArchidektAuth(new FileTokenStore()).getToken()
  if (!token) {
    return { ok: false, status: 401, ...loginRequiredMessage(), loginRequired: true }
  }

  const { report, writtenFiles } = await runDeckSync({
    direction: request.direction,
    token,
    deckNames: request.decks,
    dryRun: request.dryRun,
    only: request.only,
    force: request.force,
    syncPrintings: request.syncPrintings,
    onEvent,
    signal,
    // Nobody to prompt over HTTP: the request either carries the caller's "yes"
    // up front, or decks with unreadable lines fail and the caller retries.
    confirmUnreadable: request.ignoreUnreadableLines ? () => true : undefined,
  })

  if (writtenFiles.length > 0) {
    await autoCommitAndPush(
      getDecksDir(),
      writtenFiles,
      `Sync decks with Archidekt (${request.direction})`,
    )
  }

  return { ok: true, report }
}

// ── Handlers ──────────────────────────────────────────────────────────

export function handleDeckSyncStatus(): Promise<Response> {
  return apiHandler(async () => {
    const [decks, archidekt] = await Promise.all([
      listSyncableDecks(),
      new ArchidektAuth(new FileTokenStore()).getStatus(),
    ])
    const body: DeckSyncStatusResponse = { success: true, decks, archidekt }
    return Response.json(body)
  })
}

/** What this endpoint contributes to the shared run/stream plumbing. */
const ROUTE: SyncRouteConfig<DeckSyncRequest, DeckSyncReport, DeckSyncDeckResult> = {
  parseBody: parseDeckSyncBody,
  parseQuery: parseDeckSyncQuery,
  perform: performSync,
  summarize: (report, request) => summarizeRun(report, request.dryRun),
}

/** `POST /api/deck-sync` — see {@link runSyncRoute}. */
export function handleDeckSyncRun(
  req: Request,
  onProgress?: RouteProgressSink,
  signal?: AbortSignal,
): Promise<Response> {
  return runSyncRoute(req, onProgress, ROUTE, signal)
}

/** `event: done` payload — the same shape the JSON endpoint returns. */
export type DeckSyncDoneEvent = SyncDoneEvent<DeckSyncReport>
/** `event: error` payload for a run that never produced a report. */
export type DeckSyncErrorEvent = SyncErrorEvent

/** `event: progress` per step, then `done` or `error` — see {@link streamSyncRoute}. */
export function handleDeckSyncStream(req: Request): Promise<Response> {
  return streamSyncRoute(req, ROUTE)
}
