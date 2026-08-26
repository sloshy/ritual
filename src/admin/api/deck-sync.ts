import { ArchidektAuth } from '../../auth/ArchidektAuth'
import { FileTokenStore } from '../../auth/FileTokenStore'
import type { ArchidektLoginStatus } from '../../auth/interfaces'
import { getErrorMessage } from '../../util/errors'
import { getDecksDir } from '../../config/ritual-config'
import {
  listSyncableDecks,
  runDeckSync,
  type DeckSyncEvent,
  type DeckSyncEventHandler,
  type DeckSyncReport,
  type DeckSyncStatus,
  type SyncableDeck,
} from '../../deck-sync/engine'
import type { SyncDirection } from '../../sync/common'
import { sseResponse } from '../../util/sse'
import { itemStartProgress, itemsDoneProgress, type RouteProgressSink } from '../../util/progress'
import { apiHandler } from '../utils'
import { apiMessage, pickMessage, type ApiMessage } from './result'
import { renderSyncSummaryEnglish, type SyncSummary, type SyncSummaryClause } from './sync-summary'
import { autoCommitAndPush, readJsonObjectBody } from './save-helpers'
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

/**
 * `POST /api/deck-sync`: the run's outcome. `success` says whether the run could
 * be performed at all — a run that completed with individual decks failing is a
 * success carrying a non-zero `report.failedCount`.
 */
export type DeckSyncRunResponse =
  | (ApiMessage & { success: true; report: DeckSyncReport; summary: SyncSummary })
  | (ApiMessage & { success: false; loginRequired: boolean })

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

  const skipped = countStatus(report, 'skipped')
  if (skipped > 0) clauses.push(apiMessage('admin.api.deckSync.skipped', { count: skipped }))
  if (report.failedCount > 0) {
    clauses.push(apiMessage('admin.api.deckSync.failed', { count: report.failedCount }))
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

/** The outcome of a run attempt: either a finished report or a reason it never started. */
type RunOutcome =
  | { ok: true; report: DeckSyncReport }
  | (ApiMessage & { ok: false; status: number; loginRequired: boolean })

/**
 * Resolve the Archidekt token, run the sync, and auto-commit any deck files it
 * wrote. Shared by the JSON and SSE endpoints so both enforce the same login
 * check and produce the same report — including its `unreadable` list, which is
 * how a non-streaming caller learns which lines a retry would delete.
 */
async function performSync(
  request: DeckSyncRequest,
  onEvent?: DeckSyncEventHandler,
): Promise<RunOutcome> {
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

/**
 * A run that never started, as the JSON endpoint reports it. Takes the whole
 * message triple so a keyed refusal keeps its key on the way out.
 */
function runRefused(reason: ApiMessage, status: number, loginRequired = false): Response {
  const body: DeckSyncRunResponse = { success: false, ...pickMessage(reason), loginRequired }
  return Response.json(body, { status })
}

/** A run's event mapper plus the scale its reports counted against. */
interface DeckSyncProgressMapping {
  onEvent: DeckSyncEventHandler
  /**
   * The engine's deck total, as its `deck-start` events reported it — the
   * denominator every in-flight report used, and therefore the one the terminal
   * report must use. `0` until an event says otherwise, which is also the honest
   * scale for a run that found nothing to sync.
   */
  scale: () => number
}

/**
 * Map the engine's events onto the shared progress scale.
 *
 * Only `deck-start` advances it: a `log` line has no position on the scale, and
 * forwarding one would either repeat the last value (the spec wants progress to
 * increase) or invent a fake increment. Log lines stay on the SSE channel, where
 * the admin UI renders them as text.
 */
function deckSyncProgressEvents(sink: RouteProgressSink): DeckSyncProgressMapping {
  let total = 0
  return {
    onEvent: (event: DeckSyncEvent): void => {
      if (event.kind !== 'deck-start') return
      total = event.total
      sink(itemStartProgress(`Syncing ${event.deck}`, event.index, event.total))
    },
    scale: () => total,
  }
}

export function handleDeckSyncRun(req: Request, onProgress?: RouteProgressSink): Promise<Response> {
  return apiHandler(async () => {
    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response
    const raw: unknown = parsedBody.body

    const parsed = parseDeckSyncBody(raw)
    if (typeof parsed === 'string') {
      // A validation message is composed from the caller's own field names, so
      // it carries no catalog key — the English text is the whole of it.
      return runRefused({ message: parsed }, 400)
    }

    const mapping = onProgress === undefined ? undefined : deckSyncProgressEvents(onProgress)
    const outcome = await performSync(parsed, mapping?.onEvent)
    if (!outcome.ok) {
      return runRefused(outcome, outcome.status, outcome.loginRequired)
    }

    // A run that completed is a success even when individual decks failed —
    // `report.failedCount` and each deck's `reason` carry that detail.
    const summary = summarizeRun(outcome.report, parsed.dryRun)
    const message = renderSyncSummaryEnglish(summary)
    // On the engine's scale, not `report.decks.length`: the report also holds
    // decks that never emitted a `deck-start`, so counting it would move the
    // denominator out from under every frame already sent.
    if (mapping) onProgress?.(itemsDoneProgress(mapping.scale(), message))
    const body: DeckSyncRunResponse = {
      success: true,
      message,
      summary,
      report: outcome.report,
    }
    return Response.json(body)
  })
}

/** `event: done` payload — the same shape the JSON endpoint returns. */
export type DeckSyncDoneEvent = ApiMessage & { report: DeckSyncReport; summary: SyncSummary }
/** `event: error` payload for a run that never produced a report. */
export type DeckSyncErrorEvent = ApiMessage & { loginRequired: boolean }

/** The event vocabulary of `GET /api/deck-sync/stream`, name paired with payload. */
type DeckSyncStreamEvents = {
  progress: DeckSyncEvent
  done: DeckSyncDoneEvent
  error: DeckSyncErrorEvent
}

/**
 * Stream a sync run as server-sent events: one `progress` frame per
 * {@link DeckSyncEvent}, then a single `done` (with the report) or `error`.
 *
 * Failures are reported *inside* the stream rather than as an HTTP status,
 * because `EventSource` exposes no response body for a non-2xx open.
 */
export function handleDeckSyncStream(req: Request): Promise<Response> {
  const parsed = parseDeckSyncQuery(new URL(req.url).searchParams)

  const response = sseResponse<DeckSyncStreamEvents>(async (send) => {
    try {
      if (typeof parsed === 'string') {
        send('error', { message: parsed, loginRequired: false })
        return
      }

      const outcome = await performSync(parsed, (event) => send('progress', event))
      if (!outcome.ok) {
        send('error', { ...pickMessage(outcome), loginRequired: outcome.loginRequired })
        return
      }
      const summary = summarizeRun(outcome.report, parsed.dryRun)
      send('done', {
        message: renderSyncSummaryEnglish(summary),
        summary,
        report: outcome.report,
      })
    } catch (error) {
      send('error', { message: getErrorMessage(error), loginRequired: false })
    }
  })
  return Promise.resolve(response)
}
