import { headlessPolicy } from '../../cache/refresh'
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
  type CollectionSyncEventHandler,
  type CollectionSyncListResult,
  type CollectionSyncReport,
} from '../../collection-sync/engine'
import type { SyncDirection } from '../../sync/common'
import { CSV_UPLOAD_THRESHOLD } from '../../collection-sync/csv'
import { readCollectionSyncState } from '../../collection-sync/state'
import { listDisplayName } from '../../list/list-lifecycle'
import { listLocations } from '../../list/resolve-list'
import { getCollectionSyncPullTarget, getCollectionsDir } from '../../config/ritual-config'
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
  parseOptionalText,
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
  return apiMessage('admin.api.collectionSync.loginRequired')
}

/** {@link loginRequiredMessage}'s rendered English, for callers that only want the text. */
export function loginRequiredText(): string {
  return loginRequiredMessage().message
}

/**
 * Shown when a token is stored but the login predates recording which account it
 * belongs to. A collection is fetched by numeric user id, so there is nothing to
 * sync against until the user signs in again.
 */
function accountRequiredMessage(): ApiMessage {
  return apiMessage('admin.api.collectionSync.accountRequired')
}

/** {@link accountRequiredMessage}'s rendered English. See {@link loginRequiredText}. */
export function accountRequiredText(): string {
  return accountRequiredMessage().message
}

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

/** `POST /api/collection-sync`: the run's outcome — see {@link SyncRunResponse}. */
export type CollectionSyncRunResponse = SyncRunResponse<CollectionSyncReport>

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

/**
 * Which tense/direction the lead clause reads in. A select branch rather than a
 * spliced-in verb: the whole clause is one sentence a translator controls.
 */
const RUN_ACTIONS = { pull: 'pulled', push: 'pushed' } as const satisfies Record<
  SyncDirection,
  string
>

/**
 * A completed run's summary as keyed clauses. The structured producer;
 * {@link describeRun} is its English rendering.
 *
 * Copies are the unit, not lists: one card can live in several lists, and both
 * directions move copies rather than files. A pull names the list its additions
 * landed in, which is the one thing about a run the per-list results do not make
 * obvious.
 */
export function summarizeRun(report: CollectionSyncReport): SyncSummary {
  if (report.lists.length === 0 && report.errors.length === 0) {
    return { clauses: [apiMessage('admin.api.collectionSync.noLists')] }
  }

  const { added, removed, skipped, pending } = report.totals
  const action = report.dryRun ? 'previewed' : RUN_ACTIONS[report.direction]
  const into = report.direction === 'pull' && added > 0 ? report.into : null
  const clauses: SyncSummaryClause[] = [
    into === null
      ? apiMessage('admin.api.collectionSync.totals', { action, added, removed })
      : apiMessage('admin.api.collectionSync.totalsInto', {
          action,
          added,
          removed,
          into: String(into),
        }),
  ]

  // Written to a CSV file rather than pushed: those cards are not on Archidekt
  // until the file is imported by hand, so they are never counted as added.
  if (pending > 0) {
    clauses.push(apiMessage('admin.api.collectionSync.pending', { count: pending }))
  }
  if (skipped > 0) {
    clauses.push(apiMessage('admin.api.collectionSync.filtered', { count: skipped }))
  }
  // Counted rather than called "skipped": an ambiguous removal a `removalPriority`
  // placed *did* apply, and one nothing could place failed the whole run instead
  // of being stepped over. Either way `errors` says which it was.
  if (report.ambiguous.length > 0) {
    clauses.push(
      apiMessage('admin.api.collectionSync.ambiguous', { count: report.ambiguous.length }),
    )
  }
  if (report.failedCount > 0) {
    clauses.push(apiMessage('admin.api.collectionSync.listsFailed', { count: report.failedCount }))
  }
  if (report.errors.length > 0) {
    clauses.push(apiMessage('admin.api.collectionSync.errors', { count: report.errors.length }))
  }
  return { clauses }
}

/**
 * A one-line English summary of a completed run — what the response's `message`
 * carries, and what a client without a translator shows.
 */
export function describeRun(report: CollectionSyncReport): string {
  return renderSyncSummaryEnglish(summarizeRun(report))
}

/**
 * Resolve the Archidekt session, run the sync, and auto-commit any list files it
 * wrote. Shared by the JSON and SSE endpoints so both enforce the same login
 * check and produce the same report — including its `unreadable` and `ambiguous`
 * lists, which is how a non-streaming caller learns what a retry would change.
 */
async function performSync(
  request: CollectionSyncRequest,
  onEvent?: CollectionSyncEventHandler,
): Promise<SyncRunOutcome<CollectionSyncReport>> {
  const auth = new ArchidektAuth(new FileTokenStore())
  const token = await auth.getToken()
  if (!token) {
    return { ok: false, status: 401, ...loginRequiredMessage(), loginRequired: true }
  }
  // A collection belongs to an account rather than to a file, so the run needs
  // the numeric user id the login stored alongside the token.
  const user = await auth.getStoredUser()
  if (!user) {
    return { ok: false, status: 401, ...accountRequiredMessage(), loginRequired: true }
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
    ensureCsvCache: ({ log }) =>
      ensureCardCacheForUpload(headlessPolicy('auto'), { log: (m) => log(m) }),
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

/** What this endpoint contributes to the shared run/stream plumbing. */
const ROUTE: SyncRouteConfig<
  CollectionSyncRequest,
  CollectionSyncReport,
  CollectionSyncListResult
> = {
  parseBody: parseCollectionSyncBody,
  parseQuery: parseCollectionSyncQuery,
  perform: performSync,
  summarize: (report) => summarizeRun(report),
}

/** `POST /api/collection-sync` — see {@link runSyncRoute}. */
export function handleCollectionSyncRun(
  req: Request,
  onProgress?: RouteProgressSink,
): Promise<Response> {
  return runSyncRoute(req, onProgress, ROUTE)
}

/** `event: done` payload — the same shape the JSON endpoint returns. */
export type CollectionSyncDoneEvent = SyncDoneEvent<CollectionSyncReport>
/** `event: error` payload for a run that never produced a report. */
export type CollectionSyncErrorEvent = SyncErrorEvent

/** `event: progress` per step, then `done` or `error` — see {@link streamSyncRoute}. */
export function handleCollectionSyncStream(req: Request): Promise<Response> {
  return streamSyncRoute(req, ROUTE)
}
