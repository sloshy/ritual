/**
 * The admin HTTP surface of `ritual collection-sync`, mirroring the deck-sync
 * endpoints: a status read, a JSON run, and an SSE stream of the same run.
 *
 * What differs from deck sync follows from the shape of the feature (see
 * `collection-sync/engine.ts`): a collection is account-level, so the status
 * carries one `lastSynced` for the account rather than one per file; the request
 * names *lists* to scope the local side; and a pull needs somewhere to put cards
 * that arrived remotely, which is the `into` field (falling back to the
 * `collectionSync.pullTarget` config key, exactly as the CLI's `--into` does).
 *
 * Two of the engine's questions have no answer over HTTP, because there is nobody
 * to prompt: which list an ambiguous removal takes copies from (`removalPriority`)
 * and how a large batch of new cards reaches Archidekt (`csv`). Both are the
 * caller's decision made up front, and a run that meets either question without
 * having been given the answer fails without writing anything. The third such
 * question — whether the card cache a CSV upload keys its rows from is fresh
 * enough — has one sensible answer here rather than none: `auto`, so the refresh
 * happens and is reported through the run's progress events.
 */

import { ArchidektAuth } from '../../auth/ArchidektAuth'
import { FileTokenStore } from '../../auth/FileTokenStore'
import type { ArchidektLoginStatus } from '../../auth/interfaces'
import { ensureCardCacheForUpload } from '../../cache/freshness'
import {
  runCollectionSync,
  type CollectionSyncEvent,
  type CollectionSyncEventHandler,
  type CollectionSyncReport,
} from '../../collection-sync/engine'
import type { SyncDirection } from '../../sync-common'
import { CSV_UPLOAD_THRESHOLD } from '../../collection-sync/csv'
import { readCollectionSyncState } from '../../collection-sync/state'
import { getErrorMessage } from '../../errors'
import { listDisplayName } from '../../list-lifecycle'
import { listLocations } from '../../resolve-list'
import { getCollectionSyncPullTarget, getCollectionsDir } from '../../ritual-config'
import { sseResponse } from '../../sse'
import { apiHandler } from '../utils'
import { autoCommitAndPush, validateBodySize } from './save-helpers'
import {
  isRecord,
  parseNameArray,
  parseOptionalText,
  parseSyncRequestCore,
  readBooleanFlags,
  type BooleanFieldsOf,
  type SyncRequestCore,
} from './sync-request'

/** Shown whenever the stored Archidekt token cannot be used or refreshed. */
export const LOGIN_REQUIRED_MESSAGE =
  'Not signed into Archidekt. Sign in to sync your collection with Archidekt.'

/**
 * Shown when a token is stored but the login predates recording which account it
 * belongs to. A collection is fetched by numeric user id, so there is nothing to
 * sync against until the user signs in again.
 */
export const ACCOUNT_REQUIRED_MESSAGE =
  'The stored Archidekt login does not name an account. Sign in to Archidekt again to record it.'

/** One collection list a run can be scoped to. */
export type CollectionSyncList = {
  /** File basename — the name a request's `lists` field is matched against. */
  slug: string
  /** The list's `# Title` heading, for display. */
  name: string
}

/**
 * `GET /api/collection-sync`: the lists a run can cover, the state of the
 * Archidekt session, when the account last synced, and where a pull would put
 * new cards.
 */
export type CollectionSyncStatusResponse = {
  success: true
  lists: CollectionSyncList[]
  archidekt: ArchidektLoginStatus
  /**
   * ISO timestamp of the last sync that actually applied something; null when
   * never synced. A dry run records nothing, and neither does a run that
   * stopped without writing (an ambiguity nothing could place) — the stamp
   * means "the lists and the account agreed at this time".
   */
  lastSynced: string | null
  /** The list a pull adds new cards to unless the request names another. */
  pullTarget: string
  /**
   * How many new printings a push adds one at a time before the CSV import path
   * takes over — the engine's {@link CSV_UPLOAD_THRESHOLD}. Reported so a caller
   * can explain (or decide) the `csv` field without restating a number the server
   * owns.
   */
  csvThreshold: number
}

/**
 * A validated sync request, however it arrived (JSON body or query string). The
 * fields common to both syncs are described once on {@link SyncRequestCore}; the
 * ones below are the collection's own.
 */
export type CollectionSyncRequest = SyncRequestCore & {
  /**
   * Collection lists to scope the local side to; empty compares the whole
   * collection (every list). The remote side is always the account's entire
   * Archidekt collection.
   */
  lists: string[]
  /**
   * The list a pull adds new cards to, created if it does not exist. Absent uses
   * the `collectionSync.pullTarget` config key. A push ignores it — it writes
   * nothing locally.
   */
  into?: string
  /**
   * Collection lists an ambiguous removal may take copies from, **in priority
   * order** — a pull takes copies only from these, walking them in the order
   * given. Absent, a removal whose copies span several lists fails the run,
   * which then writes nothing: there is nobody to prompt over HTTP, so this
   * field is the caller's decision made up front. A push ignores it.
   */
  removalPriority?: string[]
  /**
   * Send a push's **additions** to Archidekt as one CSV import rather than
   * resolving and creating them one at a time — the CLI's `--csv`, and the same
   * meaning: however few there are. Absent, a push adds them individually, which
   * more than `CSV_UPLOAD_THRESHOLD` new printings refuses to do: there is
   * nobody to prompt over HTTP, so such a run fails with the engine's guidance
   * and pushes nothing at all. A pull ignores it — it makes no remote writes.
   */
  csv?: boolean
}

/**
 * Why a request naming a CSV file is refused. `--csv-file` is a CLI affordance:
 * the path is the user's own filesystem, and a server writing a file wherever a
 * request names is not something this API offers. `csv: true` is the field that
 * gets a large batch of additions to Archidekt over HTTP.
 */
export const CSV_FILE_UNSUPPORTED_MESSAGE =
  'csvFile is not supported over HTTP: use the CLI’s --csv-file to write a CSV, or csv: true to upload the additions.'

/**
 * `POST /api/collection-sync`: the run's outcome. `success` says whether the run
 * could be performed at all — a run that completed with individual lists failing
 * is a success carrying a non-zero `report.failedCount`.
 */
export type CollectionSyncRunResponse =
  | { success: true; message: string; report: CollectionSyncReport }
  | { success: false; message: string; loginRequired: boolean }

// ── Request parsing ───────────────────────────────────────────────────

/**
 * Validate a `POST /api/collection-sync` body. Returns the request or a message
 * describing why it is not one.
 */
export function parseCollectionSyncBody(value: unknown): CollectionSyncRequest | string {
  if (!isRecord(value)) return 'Invalid request body'

  const core = parseSyncRequestCore(value)
  if (typeof core === 'string') return core

  const lists = parseNameArray(value.lists, {
    field: 'lists',
    noun: 'collection list names',
    blanks: 'drop',
  })
  if (typeof lists === 'string') return lists

  const into = parseOptionalText(value.into, 'into', 'a collection list name')
  if (!into.ok) return into.message

  // The order is the priority, so a blank entry is refused rather than dropped:
  // silently shortening this array would change which binder loses a card.
  const removalPriority = parseNameArray(value.removalPriority, {
    field: 'removalPriority',
    noun: 'collection list names',
    blanks: 'reject',
  })
  if (typeof removalPriority === 'string') return removalPriority

  // Validated rather than coerced, like every other flag: it decides whether a
  // large batch of additions reaches Archidekt as one import or not at all.
  if (value.csv !== undefined && typeof value.csv !== 'boolean') return 'csv must be a boolean'
  // Refused rather than ignored: a caller mirroring the CLI's flags deserves to
  // be told this one is not available here, not to watch its additions be
  // uploaded when it asked for a file.
  if (value.csvFile !== undefined && value.csvFile !== null) return CSV_FILE_UNSUPPORTED_MESSAGE

  const request: CollectionSyncRequest = { ...core, lists }
  // Left off entirely when unset, so the configured pull target applies rather
  // than an empty list name reaching the engine.
  if (into.value !== undefined) request.into = into.value
  // Likewise: an empty priority is no priority at all, and the field reads
  // better absent than as `[]` wherever the request is echoed back.
  if (removalPriority.length > 0) request.removalPriority = removalPriority
  // And likewise for the flag: `csv: false` and no `csv` at all are the same
  // run, and a query string spells the absent case as `false` — so only the
  // asked-for case is carried.
  if (value.csv === true) request.csv = true
  return request
}

/**
 * Every boolean field of a request must appear here, or the query string would
 * silently revert it to `false`. `satisfies` makes leaving one out a type error.
 */
const BOOLEAN_FLAGS = {
  dryRun: true,
  ignoreUnreadableLines: true,
  csv: true,
} as const satisfies Record<BooleanFieldsOf<CollectionSyncRequest>, true>

/**
 * Validate the query string the SSE stream is opened with — `EventSource` can
 * only issue a bodyless GET, so the same request arrives as
 * `?direction=pull&list=binder&list=longbox&into=Inbox&dryRun=true`.
 *
 * Boolean flags are validated rather than coerced: they decide whether files are
 * written, records deleted, and unreadable lines dropped, so an unrecognized
 * value must be rejected instead of quietly meaning "no".
 *
 * `only` and `into` are string params rather than flags, so they are handed to
 * the body parser as-is and validated there — for both, an absent param and an
 * empty one mean the same thing (apply every change; use the configured pull
 * target).
 *
 * `removalPriority` repeats once per list, and `getAll` preserves the order the
 * query string spells them in — which is the whole content of a priority.
 *
 * `csvFile` is forwarded rather than dropped so the body parser can refuse it
 * here too: a caller reaching for the CLI's flag is told it does not apply
 * instead of having its additions uploaded anyway.
 */
export function parseCollectionSyncQuery(params: URLSearchParams): CollectionSyncRequest | string {
  const flags = readBooleanFlags(params, BOOLEAN_FLAGS)
  if (typeof flags === 'string') return flags
  return parseCollectionSyncBody({
    direction: params.get('direction') ?? undefined,
    lists: params.getAll('list'),
    only: params.get('only') ?? undefined,
    into: params.get('into') ?? undefined,
    removalPriority: params.getAll('removalPriority'),
    csvFile: params.get('csvFile') ?? undefined,
    ...flags,
  })
}

// ── Running a sync ────────────────────────────────────────────────────

const RUN_VERBS = { pull: 'Pulled', push: 'Pushed' } as const satisfies Record<
  SyncDirection,
  string
>

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * A one-line summary of a completed run, suitable for an alert in the UI.
 *
 * Copies are the unit, not lists: one card can live in several lists, and both
 * directions move copies rather than files. A pull names the list its additions
 * landed in, which is the one thing about a run the per-list results do not make
 * obvious.
 */
export function describeRun(report: CollectionSyncReport): string {
  if (report.lists.length === 0 && report.errors.length === 0) {
    return 'No collection lists found to sync.'
  }

  const { added, removed, skipped, pending } = report.totals
  const verb = report.dryRun ? 'Previewed' : RUN_VERBS[report.direction]
  const where = report.direction === 'pull' && added > 0 ? ` into "${report.into}"` : ''
  const parts = [`${verb} +${added} added, -${removed} removed${where}`]

  // Written to a CSV file rather than pushed: those cards are not on Archidekt
  // until the file is imported by hand, so they are never counted as added.
  if (pending > 0) parts.push(`${pending} awaiting a manual CSV upload`)
  if (skipped > 0) parts.push(`${skipped} filtered out`)
  // Counted rather than called "skipped": an ambiguous removal a `removalPriority`
  // placed *did* apply, and one nothing could place failed the whole run instead
  // of being stepped over. Either way `errors` says which it was.
  if (report.ambiguous.length > 0) {
    parts.push(pluralize(report.ambiguous.length, 'ambiguous removal'))
  }
  if (report.failedCount > 0) parts.push(`${pluralize(report.failedCount, 'list')} failed`)
  if (report.errors.length > 0) parts.push(pluralize(report.errors.length, 'error'))
  return `${parts.join(', ')}.`
}

/** The outcome of a run attempt: either a finished report or a reason it never started. */
type RunOutcome =
  | { ok: true; report: CollectionSyncReport }
  | { ok: false; status: number; message: string; loginRequired: boolean }

/**
 * Resolve the Archidekt session, run the sync, and auto-commit any list files it
 * wrote. Shared by the JSON and SSE endpoints so both enforce the same login
 * check and produce the same report — including its `unreadable` and `ambiguous`
 * lists, which is how a non-streaming caller learns what a retry would change.
 */
async function performSync(
  request: CollectionSyncRequest,
  onEvent?: CollectionSyncEventHandler,
): Promise<RunOutcome> {
  const auth = new ArchidektAuth(new FileTokenStore())
  const token = await auth.getToken()
  if (!token) {
    return { ok: false, status: 401, message: LOGIN_REQUIRED_MESSAGE, loginRequired: true }
  }
  // A collection belongs to an account rather than to a file, so the run needs
  // the numeric user id the login stored alongside the token.
  const user = await auth.getStoredUser()
  if (!user) {
    return { ok: false, status: 401, message: ACCOUNT_REQUIRED_MESSAGE, loginRequired: true }
  }

  const { report, writtenFiles } = await runCollectionSync({
    direction: request.direction,
    token,
    userId: user.id,
    lists: request.lists,
    only: request.only,
    into: request.into ?? getCollectionSyncPullTarget(),
    removalPriority: request.removalPriority,
    csv: request.csv,
    dryRun: request.dryRun,
    onEvent,
    // An HTTP caller cannot be prompted about the card cache either, and a CSV
    // upload's rows are only as good as it is — so freshness is treated as
    // `auto`: an empty or day-old cache is refreshed before the upload is built,
    // and the refresh is reported through the run's own progress events.
    ensureCsvCache: ({ log }) => ensureCardCacheForUpload('auto', { log: (m) => log(m) }),
    // No `resolveAmbiguous`: an HTTP caller cannot be walked through the copies
    // one at a time, so a removal the priority (if any) cannot place fails the
    // run — the reason lands in `report.errors`, and nothing is written.
    // No `decideCsv` either, for the same reason: a push with more additions
    // than the CSV threshold and no `csv: true` fails with the engine's guidance
    // rather than choosing between hundreds of searches and a bulk import on the
    // caller's behalf. And no `csvFile` — the request parser refuses it.
    // Nobody to prompt over HTTP: the request either carries the caller's "yes"
    // up front, or lists with unreadable lines fail and the caller retries.
    confirmUnreadable: request.ignoreUnreadableLines ? () => true : undefined,
  })

  if (writtenFiles.length > 0) {
    await autoCommitAndPush(
      getCollectionsDir(),
      writtenFiles,
      `Sync collection with Archidekt (${request.direction})`,
    )
  }

  return { ok: true, report }
}

// ── Handlers ──────────────────────────────────────────────────────────

/**
 * Every collection list, by the slug a request names it with plus its heading
 * for display. Enumerated the way the engine scopes a run, so the status and the
 * run always agree on what "the whole collection" is.
 */
async function listCollectionLists(): Promise<CollectionSyncList[]> {
  const locations = await listLocations('collection')
  return Promise.all(
    locations.map(async (location): Promise<CollectionSyncList> => {
      // A list whose heading cannot be read still syncs, so it still appears —
      // named by its slug.
      const name = await listDisplayName('collection', location.filePath).catch(() => location.name)
      return { slug: location.name, name }
    }),
  )
}

export function handleCollectionSyncStatus(): Promise<Response> {
  return apiHandler(async () => {
    const [lists, archidekt, state] = await Promise.all([
      listCollectionLists(),
      new ArchidektAuth(new FileTokenStore()).getStatus(),
      readCollectionSyncState(),
    ])
    const body: CollectionSyncStatusResponse = {
      success: true,
      lists,
      archidekt,
      lastSynced: state?.lastSynced ?? null,
      pullTarget: getCollectionSyncPullTarget(),
      csvThreshold: CSV_UPLOAD_THRESHOLD,
    }
    return Response.json(body)
  })
}

/** A run that never started, as the JSON endpoint reports it. */
function runRefused(message: string, status: number, loginRequired = false): Response {
  const body: CollectionSyncRunResponse = { success: false, message, loginRequired }
  return Response.json(body, { status })
}

export function handleCollectionSyncRun(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return runRefused('Request body must be JSON.', 400)
    }

    const parsed = parseCollectionSyncBody(raw)
    if (typeof parsed === 'string') {
      return runRefused(parsed, 400)
    }

    const outcome = await performSync(parsed)
    if (!outcome.ok) {
      return runRefused(outcome.message, outcome.status, outcome.loginRequired)
    }

    // A run that completed is a success even when individual lists failed —
    // `report.failedCount`, each list's `reason`, and `report.errors` carry that
    // detail.
    const body: CollectionSyncRunResponse = {
      success: true,
      message: describeRun(outcome.report),
      report: outcome.report,
    }
    return Response.json(body)
  })
}

/** `event: done` payload — the same shape the JSON endpoint returns. */
export type CollectionSyncDoneEvent = { message: string; report: CollectionSyncReport }
/** `event: error` payload for a run that never produced a report. */
export type CollectionSyncErrorEvent = { message: string; loginRequired: boolean }

/** The event vocabulary of `GET /api/collection-sync/stream`, name paired with payload. */
type CollectionSyncStreamEvents = {
  progress: CollectionSyncEvent
  done: CollectionSyncDoneEvent
  error: CollectionSyncErrorEvent
}

/**
 * Stream a sync run as server-sent events: one `progress` frame per
 * {@link CollectionSyncEvent}, then a single `done` (with the report) or
 * `error`.
 *
 * Failures are reported *inside* the stream rather than as an HTTP status,
 * because `EventSource` exposes no response body for a non-2xx open.
 */
export function handleCollectionSyncStream(req: Request): Promise<Response> {
  const parsed = parseCollectionSyncQuery(new URL(req.url).searchParams)

  const response = sseResponse<CollectionSyncStreamEvents>(async (send) => {
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
      send('done', { message: describeRun(outcome.report), report: outcome.report })
    } catch (error) {
      send('error', { message: getErrorMessage(error), loginRequired: false })
    }
  })
  return Promise.resolve(response)
}
