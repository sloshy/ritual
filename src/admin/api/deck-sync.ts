import { ArchidektAuth } from '../../auth/ArchidektAuth'
import { FileTokenStore } from '../../auth/FileTokenStore'
import type { ArchidektLoginStatus } from '../../auth/interfaces'
import { getErrorMessage } from '../../errors'
import { getDecksDir } from '../../ritual-config'
import {
  listSyncableDecks,
  runDeckSync,
  SYNC_DIRECTIONS,
  type DeckSyncEvent,
  type DeckSyncEventHandler,
  type DeckSyncReport,
  type DeckSyncStatus,
  type SyncableDeck,
  type SyncDirection,
} from '../../deck-sync/engine'
import { sseResponse } from '../../sse'
import { apiHandler } from '../utils'
import { autoCommitAndPush, validateBodySize } from './save-helpers'

/** Shown whenever the stored Archidekt token cannot be used or refreshed. */
export const LOGIN_REQUIRED_MESSAGE =
  'Not signed into Archidekt. Sign in to sync decks with Archidekt.'

/** `GET /api/deck-sync`: the syncable decks and the state of the Archidekt session. */
export type DeckSyncStatusResponse = {
  success: true
  decks: SyncableDeck[]
  archidekt: ArchidektLoginStatus
}

/** A validated sync request, however it arrived (JSON body or query string). */
export type DeckSyncRequest = {
  direction: SyncDirection
  /** Deck names/slugs to sync; empty syncs every Archidekt-linked deck. */
  decks: string[]
  dryRun: boolean
  /**
   * Sync decks whose files hold lines the parser cannot read, removing those
   * lines. There is nobody to prompt over HTTP, so such decks fail by default;
   * this is the caller's explicit "yes", equivalent to the CLI's `--yes`.
   */
  ignoreUnreadableLines: boolean
}

/**
 * `POST /api/deck-sync`: the run's outcome. `success` says whether the run could
 * be performed at all — a run that completed with individual decks failing is a
 * success carrying a non-zero `report.failedCount`.
 */
export type DeckSyncRunResponse =
  | { success: true; message: string; report: DeckSyncReport }
  | { success: false; message: string; loginRequired: boolean }

// ── Request parsing ───────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a `POST /api/deck-sync` body. Returns the request or a message
 * describing why it is not one.
 */
export function parseDeckSyncBody(value: unknown): DeckSyncRequest | string {
  if (!isRecord(value)) return 'Invalid request body'

  const rawDirection = value.direction
  if (typeof rawDirection !== 'string' || rawDirection.length === 0) {
    return `direction is required (${SYNC_DIRECTIONS.join(' or ')})`
  }
  // Matched case-insensitively, as the CLI's `parseEnumFlag` does, so the same
  // value is accepted whichever surface it is typed into.
  const normalized = rawDirection.toLowerCase()
  const direction = SYNC_DIRECTIONS.find((candidate) => candidate === normalized)
  if (!direction) {
    return `Invalid direction '${rawDirection}'. Use one of: ${SYNC_DIRECTIONS.join(', ')}.`
  }

  const rawDecks = value.decks ?? []
  if (
    !Array.isArray(rawDecks) ||
    !rawDecks.every((name): name is string => typeof name === 'string')
  ) {
    return 'decks must be an array of deck names'
  }

  if (value.dryRun !== undefined && typeof value.dryRun !== 'boolean') {
    return 'dryRun must be a boolean'
  }
  if (
    value.ignoreUnreadableLines !== undefined &&
    typeof value.ignoreUnreadableLines !== 'boolean'
  ) {
    return 'ignoreUnreadableLines must be a boolean'
  }

  const decks = rawDecks.map((name) => name.trim()).filter((name) => name.length > 0)
  return {
    direction,
    decks,
    dryRun: value.dryRun === true,
    ignoreUnreadableLines: value.ignoreUnreadableLines === true,
  }
}

/** The request's boolean-valued fields — the ones a query string spells 'true'/'false'. */
type BooleanRequestFlag = {
  [K in keyof DeckSyncRequest]-?: DeckSyncRequest[K] extends boolean ? K : never
}[keyof DeckSyncRequest]

/**
 * Every boolean field of a request must appear here, or the query string would
 * silently revert it to `false`. `satisfies` makes leaving one out a type error.
 */
const BOOLEAN_FLAGS = { dryRun: true, ignoreUnreadableLines: true } as const satisfies Record<
  BooleanRequestFlag,
  true
>

/**
 * Validate the query string the SSE stream is opened with — `EventSource` can
 * only issue a bodyless GET, so the same request arrives as
 * `?direction=pull&deck=one&deck=two&dryRun=true`.
 *
 * Boolean flags are validated rather than coerced: they decide whether files are
 * written, changes pushed, and unreadable lines deleted, so an unrecognized
 * value must be rejected instead of quietly meaning "no".
 */
export function parseDeckSyncQuery(params: URLSearchParams): DeckSyncRequest | string {
  const flags = {} as Record<BooleanRequestFlag, boolean>
  for (const flag of Object.keys(BOOLEAN_FLAGS) as BooleanRequestFlag[]) {
    const raw = params.get(flag)
    if (raw !== null && raw !== 'true' && raw !== 'false')
      return `${flag} must be 'true' or 'false'`
    flags[flag] = raw === 'true'
  }
  return parseDeckSyncBody({
    direction: params.get('direction') ?? undefined,
    decks: params.getAll('deck'),
    ...flags,
  })
}

// ── Running a sync ────────────────────────────────────────────────────

function countStatus(report: DeckSyncReport, status: DeckSyncStatus): number {
  return report.decks.filter((deck) => deck.status === status).length
}

function pluralizeDecks(count: number): string {
  return `${count} deck${count === 1 ? '' : 's'}`
}

const RUN_VERBS = { pull: 'Pulled', push: 'Pushed' } as const satisfies Record<
  SyncDirection,
  string
>

/** A one-line summary of a completed run, suitable for an alert in the UI. */
export function describeRun(report: DeckSyncReport, dryRun: boolean): string {
  if (report.decks.length === 0) return 'No Archidekt decks found to sync.'

  const synced = countStatus(report, 'synced')
  const verb = dryRun ? 'Previewed' : RUN_VERBS[report.direction]
  const parts = [`${verb} ${pluralizeDecks(synced)}`]

  const skipped = countStatus(report, 'skipped')
  if (skipped > 0) parts.push(`${skipped} skipped`)
  if (report.failedCount > 0) parts.push(`${report.failedCount} failed`)
  return `${parts.join(', ')}.`
}

/** The outcome of a run attempt: either a finished report or a reason it never started. */
type RunOutcome =
  | { ok: true; report: DeckSyncReport }
  | { ok: false; status: number; message: string; loginRequired: boolean }

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
    return { ok: false, status: 401, message: LOGIN_REQUIRED_MESSAGE, loginRequired: true }
  }

  const { report, writtenFiles } = await runDeckSync({
    direction: request.direction,
    token,
    deckNames: request.decks,
    dryRun: request.dryRun,
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

/** A run that never started, as the JSON endpoint reports it. */
function runRefused(message: string, status: number, loginRequired = false): Response {
  const body: DeckSyncRunResponse = { success: false, message, loginRequired }
  return Response.json(body, { status })
}

export function handleDeckSyncRun(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return runRefused('Request body must be JSON.', 400)
    }

    const parsed = parseDeckSyncBody(raw)
    if (typeof parsed === 'string') {
      return runRefused(parsed, 400)
    }

    const outcome = await performSync(parsed)
    if (!outcome.ok) {
      return runRefused(outcome.message, outcome.status, outcome.loginRequired)
    }

    // A run that completed is a success even when individual decks failed —
    // `report.failedCount` and each deck's `reason` carry that detail.
    const body: DeckSyncRunResponse = {
      success: true,
      message: describeRun(outcome.report, parsed.dryRun),
      report: outcome.report,
    }
    return Response.json(body)
  })
}

/** `event: done` payload — the same shape the JSON endpoint returns. */
export type DeckSyncDoneEvent = { message: string; report: DeckSyncReport }
/** `event: error` payload for a run that never produced a report. */
export type DeckSyncErrorEvent = { message: string; loginRequired: boolean }

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
        send('error', { message: outcome.message, loginRequired: outcome.loginRequired })
        return
      }
      send('done', {
        message: describeRun(outcome.report, parsed.dryRun),
        report: outcome.report,
      })
    } catch (error) {
      send('error', { message: getErrorMessage(error), loginRequired: false })
    }
  })
  return Promise.resolve(response)
}
