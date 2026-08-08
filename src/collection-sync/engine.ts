/**
 * The Archidekt collection-sync engine, shared by every surface that syncs
 * collections: the `collection-sync` CLI command, the admin site's Sync
 * Collection page (and its SSE stream), and the `sync_collection` MCP tool.
 *
 * It mirrors `deck-sync/engine.ts` — structured events, per-list results,
 * dry runs, unreadable-line confirmation, an injectable client — but the shape
 * of the problem differs in two ways that show up everywhere below:
 *
 * - **Many local lists, one remote collection.** A run compares the union of
 *   the in-scope collection lists against the whole account collection, so
 *   there is no per-file link and no per-file `lastSynced`; the run's timestamp
 *   is account-level state (`state.ts`).
 * - **Placement is local knowledge.** A card that appeared remotely belongs in
 *   *some* binder and only the user knows which, so a pull writes additions to
 *   one designated target list, and refuses to guess which binder *some* of a
 *   printing's copies left when they span several lists — such a removal needs
 *   a resolution strategy (a removal priority, or the caller deciding), or the
 *   run fails without writing anything.
 *
 * Every side effect is behind a seam — the {@link CollectionListStore} for
 * files, the {@link ArchidektClient} for the network, the lookups for the
 * Scryfall cache, and the state store for the timestamp — so the semantics are
 * testable without touching any of them.
 */

import { ArchidektClient, createPacedArchidektClient } from '../clients/ArchidektClient'
import { getErrorMessage } from '../errors'
import { t } from '../i18n/t'
import type {
  ArchidektCollectionRecord,
  CollectionCsvUploadResult,
} from '../importers/archidekt-collection'
import { formatResolveListError, normalizeListName } from '../resolve-list'
import { scryfallIdIndex } from '../cache/scryfall-id-index'
import { getCachedCardPrintings } from '../scryfall'
import {
  describeSkippedChanges,
  type ConfirmUnreadable,
  type SyncChangeFilter,
  type SyncDirection,
  type SyncItemStatus,
  type SyncLogLevel,
  type UnreadableSource,
} from '../sync-common'
import type { ScryfallCard } from '../types'
import type { CardPrintingsLookup } from '../card-printing'
import {
  describeAmbiguousRemoval,
  describeCollectionKey,
  describeCsvFailure,
  describeCsvFailureReasons,
  describeCsvSize,
  type AmbiguousRemoval,
  type CollectionCsvFailure,
} from './describe'
import {
  applyRemovalAssignments,
  buildLocalIndex,
  buildRemoteIndex,
  createRecordBody,
  operationAdded,
  operationRemoved,
  planPull,
  planPush,
  pullChangesByList,
  resolveAmbiguousByPriority,
  unmappableLanguageWarning,
  updateRecordBody,
  type LocalCollectionIndex,
  type PullAddition,
  type PullListChanges,
  type PullRemoval,
  type PushCreate,
  type PushOperation,
  type RemoteCollectionIndex,
  type RemovalAssignment,
} from './diff'
import {
  ARCHIDEKT_IMPORT_URL,
  COLLECTION_CSV_UPLOAD,
  collectionCsvOutcome,
  CSV_UPLOAD_THRESHOLD,
  planCollectionCsv,
  writeCsvFile,
  type CsvFileWriter,
} from './csv'
import {
  createDiskCollectionListStore,
  isResolveFailure,
  type CollectionListStore,
  type LoadedCollectionList,
} from './store'
import { createFileCollectionSyncStateStore, type CollectionSyncStateStore } from './state'

// ── Public surface ────────────────────────────────────────────────────

/** What happened to one collection list during a run. */
export type CollectionSyncStatus = SyncItemStatus

export type CollectionSyncListResult = {
  name: string
  status: CollectionSyncStatus
  reason?: string
  /** Copies added: written into this list on a pull, created or grown remotely on a push. */
  added: number
  /** Copies removed: deleted from this list on a pull, trimmed or deleted remotely on a push. */
  removed: number
  /**
   * Copies this list holds that a push wrote to a `--csv-file` instead of
   * pushing: they are **not** on Archidekt until the file is imported by hand.
   * Always 0 on a pull, and on a push that did not export a CSV.
   */
  pending: number
}

/**
 * A collection list holding lines the parser cannot read. A pull re-serializes
 * the file, so every line listed in `warnings` would be deleted by the save; a
 * push treats the file as the truth, so those lines would be deleted from the
 * account instead. Both directions therefore ask before proceeding.
 */
export type UnreadableList = UnreadableSource

/**
 * Decide whether lists carrying unreadable lines may sync anyway. Called once,
 * before anything syncs, with every affected list; `true` syncs them (dropping
 * those lines), anything else fails them.
 */
export type ConfirmUnreadableLists = ConfirmUnreadable

export type CollectionSyncLogLevel = SyncLogLevel

/**
 * One step of a run, emitted as it happens.
 *
 * A `log` event with a `list` belongs to the list currently being synced; one
 * with `list: null` is about the run as a whole — the remote fetch, records for
 * cards that live in no list any more, and removals too ambiguous to place.
 */
export type CollectionSyncEvent =
  | { kind: 'list-start'; list: string; index: number; total: number }
  | { kind: 'log'; level: CollectionSyncLogLevel; list: string | null; message: string }
  | { kind: 'list-result'; result: CollectionSyncListResult }
  /** Emitted before anything syncs, when some list has lines the parser cannot read. */
  | { kind: 'unreadable-lines'; lists: UnreadableList[] }

export type CollectionSyncEventHandler = (event: CollectionSyncEvent) => void

/** Copies the run moved, and how many changes its `--only` filter skipped. */
export type CollectionSyncTotals = {
  added: number
  removed: number
  skipped: number
  /**
   * Copies written to a `--csv-file` instead of pushed — they reach Archidekt
   * only once the file is imported by hand, so they are deliberately not part of
   * {@link added}.
   */
  pending: number
}

/** What the CSV path did with a push's additions; see {@link CollectionSyncCsv}. */
export type CollectionSyncCsvStatus = 'uploaded' | 'exported' | 'planned' | 'failed' | 'empty'

/** The counts every CSV outcome carries. */
type CollectionSyncCsvCounts = {
  /** Copies the CSV covers. */
  cards: number
  /** Data rows the CSV holds — one per printing. */
  rows: number
  /**
   * Additions the CSV could not carry because the local Scryfall cache does not
   * hold their printing. They were added one at a time instead, so they are
   * counted in the ordinary per-list `added` figures.
   */
  uncached: number
}

/**
 * What became of a push's additions when they took the CSV path — the field
 * every non-CLI consumer (the JSON report, the admin page, the MCP tool) reads to
 * find out whether those cards are on Archidekt, waiting in a file, or lost to a
 * failed upload. `null` on a run whose additions did not take the CSV path at
 * all.
 */
export type CollectionSyncCsv =
  | (CollectionSyncCsvCounts & {
      status: 'uploaded'
      /** Upload requests made — Archidekt takes 2000 rows per request. */
      chunks: number
      /** Rows Archidekt did not import; their lists are reported as failed. */
      failures: CollectionCsvFailure[]
      /**
       * Chunk responses Ritual could not read. Their rows are counted as imported
       * on faith — nothing said otherwise — so a non-zero count means part of this
       * outcome is assumed rather than confirmed. The run log carries each
       * response verbatim.
       */
      unconfirmedChunks: number
    })
  | (CollectionSyncCsvCounts & {
      status: 'exported'
      /** Where the CSV was written. Its cards await a manual import. */
      path: string
    })
  /** A dry run's preview of an upload. Nothing was searched, sent, or written. */
  | (CollectionSyncCsvCounts & { status: 'planned'; destination: 'upload' })
  /** A dry run's preview of a `csvFile` run, naming the file it would have written. */
  | (CollectionSyncCsvCounts & { status: 'planned'; destination: 'export'; path: string })
  | (CollectionSyncCsvCounts & {
      status: 'failed'
      /** Why the whole CSV failed. The rest of the run went ahead regardless. */
      message: string
    })
  /**
   * The CSV path was taken but no row could be built: every addition's printing is
   * missing from the local Scryfall cache ({@link CollectionSyncCsvCounts.uncached}
   * counts them). Reported rather than left `null` so a caller reading only the
   * report still learns why those cards took the slow route.
   */
  | (CollectionSyncCsvCounts & { status: 'empty' })

export type CollectionSyncReport = {
  direction: SyncDirection
  /** The list a pull added new cards to; null on a push. */
  into: string | null
  dryRun: boolean
  lists: CollectionSyncListResult[]
  /** Lists that failed. Run-level failures are in {@link errors} instead. */
  failedCount: number
  /**
   * Failures that belong to the run rather than to one list — the collection
   * fetch, or deleting records for cards that live in no list any more.
   * Callers deciding an exit code must treat these as failures too.
   */
  errors: string[]
  /**
   * Lists holding lines the parser cannot read, with those lines. Reported
   * whether the run went ahead or refused them, so the JSON report and the
   * non-streaming endpoint — which never see the `unreadable-lines` event —
   * can still show what accepting would delete.
   */
  unreadable: UnreadableList[]
  /**
   * Partial removals a pull could not place on its own, because the copies span
   * several lists. Reported whether or not a resolution strategy later placed
   * them — and when none could, {@link errors} says so and nothing was written.
   */
  ambiguous: AmbiguousRemoval[]
  /**
   * True when some in-scope list did not make it into the comparison — a name
   * that did not resolve, a file that could not be read, or a list held back for
   * unreadable lines. The local side then looks emptier than it is, so the run
   * withholds the changes that shortfall would otherwise manufacture (see
   * {@link runCollectionSync}).
   */
  localIncomplete: boolean
  /**
   * What the CSV bulk-import path did with a push's additions, or `null` when the
   * run did not take it (a pull, or a push whose additions were few enough to add
   * one at a time). See {@link CollectionSyncCsv}.
   */
  csv: CollectionSyncCsv | null
  totals: CollectionSyncTotals
}

/** Resolves Scryfall ids to cached cards; satisfied by the cache's id index. */
export type ScryfallIdLookup = (ids: readonly string[]) => Promise<Map<string, ScryfallCard>>

/**
 * What a resolver made of the ambiguous set: a complete assignment, or the
 * message explaining why the decision could not be made. The message is the
 * resolver's own — "no terminal", "you declined", "you cancelled half way" are
 * different things to be told — and it reaches the run's report verbatim, so a
 * scripted run (`--output json`) carries the reason too.
 */
export type AmbiguityResolutionOutcome =
  | { ok: true; assignments: RemovalAssignment[] }
  | { ok: false; message: string }

/**
 * Decide where every ambiguous removal takes its copies from, in one go.
 *
 * Called once with the whole ambiguous set, and only when the run has no
 * {@link CollectionSyncOptions.removalPriority} and is not a dry run. A refusal
 * — or an assignment that does not account for every copy — fails the run,
 * which then writes nothing at all: resolution is all-or-nothing, so a session
 * the user abandons half way through leaves the lists untouched.
 */
export type ResolveAmbiguousRemovals = (
  ambiguous: readonly AmbiguousRemoval[],
) => Promise<AmbiguityResolutionOutcome> | AmbiguityResolutionOutcome

/** What a run is asking about when it consults {@link DecideCsvUpload}. */
export type CsvUploadQuestion = {
  /**
   * Printings that would be created — the figure compared against
   * {@link threshold}, and the number of Archidekt searches adding them one at a
   * time would cost.
   */
  additions: number
  /** The threshold that raised the question: {@link CSV_UPLOAD_THRESHOLD}. */
  threshold: number
}

/**
 * How a large batch of additions should reach Archidekt.
 *
 * `upload` sends one CSV import, `export` writes the CSV to `path` and pushes
 * nothing, `individual` takes the old per-card path anyway, and `abort` gives up
 * with a reason of the decider's own wording — "you cancelled" and "there is no
 * terminal" are different things to be told, and the message reaches the run's
 * report verbatim.
 */
export type CsvUploadDecision =
  | { kind: 'upload' }
  | { kind: 'export'; path: string }
  | { kind: 'individual' }
  | { kind: 'abort'; message: string }

/**
 * Decide how a push's additions reach Archidekt when there are more of them than
 * {@link CSV_UPLOAD_THRESHOLD} — the CLI's prompt.
 *
 * Consulted only when neither {@link CollectionSyncOptions.csv} nor
 * {@link CollectionSyncOptions.csvFile} was given, the threshold is exceeded, and
 * the run is not a dry run. Called before anything is written to Archidekt, so a
 * refusal leaves the account exactly as it was.
 */
export type DecideCsvUpload = (
  question: CsvUploadQuestion,
) => Promise<CsvUploadDecision> | CsvUploadDecision

/** What a run tells its {@link EnsureCsvCache} gate about the upload it is about to build. */
export type CsvCacheRequest = {
  /** Printings whose Scryfall id the CSV needs from the local cache. */
  additions: number
  /** Report a refresh in progress through the run's own log. */
  log: (message: string) => void
}

/**
 * Make the local Scryfall cache fit to build a CSV upload from, or refuse the run.
 *
 * Every uploaded row is keyed by the Scryfall id the local cache holds for that
 * printing, so an empty or stale cache means rows that quietly go missing and
 * additions that fall back to one paced search each — the rate-limit trap the CSV
 * path exists to avoid. Consulted once, after the route is settled and **before
 * any remote write**, so a refusal (the string) leaves the account untouched.
 *
 * Surfaces supply their own policy: the CLI's `--refresh` mode, and `auto` for the
 * server surfaces, which cannot prompt. Omitted, no freshness is required — which
 * is only right for a caller that has already vouched for the cache.
 */
export type EnsureCsvCache = (request: CsvCacheRequest) => Promise<true | string> | true | string

export type CollectionSyncOptions = {
  direction: SyncDirection
  /** An Archidekt access token; callers obtain one from `ArchidektAuth.getToken()`. */
  token: string
  /** The numeric Archidekt user id whose collection to sync (from `getStoredUser`). */
  userId: number
  /** Collection lists to sync; empty (the default) syncs every collection list. */
  lists?: string[]
  /**
   * Apply only one side of the diff — additions or removals, relative to the
   * sync destination (local files on a pull, Archidekt on a push). Omitted,
   * every change applies. Skipped changes are still counted and logged.
   */
  only?: SyncChangeFilter
  /**
   * The list a pull writes new cards into, created on first use. Callers
   * resolve it (`--into` → `collectionSync.pullTarget` → `Inbox`) before
   * calling. Matched against existing lists by **name only** — not by the
   * substring rule other list lookups use — so a target that does not exist is
   * created rather than landing in whichever list happens to contain the word.
   * Unused by a push.
   */
  into: string
  /**
   * Collection lists an ambiguous removal may take copies from, in priority
   * order — copies come only from these lists, tail lines first within each.
   * Names resolve the way {@link into} does (exact name, never the substring
   * rule), and an unknown name fails the run.
   *
   * When given, this is the **only** strategy consulted:
   * {@link resolveAmbiguous} is never called (even interactively), and an
   * ambiguity the priority cannot place fails the run.
   */
  removalPriority?: string[]
  /**
   * Resolve every ambiguous removal at once — the CLI's interactive session.
   * Consulted only when no {@link removalPriority} was given and the run is not
   * a dry run. Omitted, an ambiguous removal fails the run.
   */
  resolveAmbiguous?: ResolveAmbiguousRemovals
  /**
   * Send a push's **additions** to Archidekt as one CSV import instead of
   * resolving and creating them one at a time, however few there are. Additions
   * take that path automatically once there are more than
   * {@link CSV_UPLOAD_THRESHOLD} of them; this option asks for it outright, so
   * nothing is decided (or prompted for) at run time. Quantity changes and
   * removals are unaffected — they never ride the CSV.
   */
  csv?: boolean
  /**
   * Write a push's additions to this CSV file **instead of** pushing them: the
   * cards wait there until the user imports them at
   * `archidekt.com/collections/import`, and the run reports them as pending
   * rather than added. Quantity changes and removals still push normally. Wins
   * over {@link csv}; callers reject the combination up front.
   */
  csvFile?: string
  /**
   * Decide how over-threshold additions reach Archidekt. Consulted only when
   * neither {@link csv} nor {@link csvFile} was given and the run is not a dry
   * run; omitted, such a run fails without pushing anything (there is no safe
   * default — one path costs hundreds of requests and the other changes how the
   * cards are created).
   */
  decideCsv?: DecideCsvUpload
  /**
   * Require a card cache fresh enough to key the upload's rows by, refreshing it
   * (or refusing the run) according to the surface's own policy. Consulted only
   * when a push's additions take the CSV path — over the threshold, {@link csv},
   * or {@link csvFile} — and before anything is written to Archidekt. Omitted,
   * the cache is used as it is.
   */
  ensureCsvCache?: EnsureCsvCache
  /** Report what would sync without writing files or touching Archidekt. */
  dryRun?: boolean
  onEvent?: CollectionSyncEventHandler
  /**
   * Confirm syncing lists whose files carry unreadable lines. Omitted, such
   * lists fail — a sync must never silently drop a line it could not parse.
   * Never consulted under `dryRun`, which changes nothing and so has nothing
   * to confirm.
   */
  confirmUnreadable?: ConfirmUnreadableLists
  /** Injectable for tests; a fresh {@link ArchidektClient} by default. */
  client?: ArchidektClient
  /** Injectable for tests; the disk-backed list store by default. */
  store?: CollectionListStore
  /** Injectable for tests; the Scryfall cache by default. */
  lookupPrintings?: CardPrintingsLookup
  /** Injectable for tests; the Scryfall cache's id index by default. */
  lookupByScryfallId?: ScryfallIdLookup
  /** Injectable for tests; the file beside the Archidekt token by default. */
  state?: CollectionSyncStateStore
  /** Injectable for tests; writes {@link csvFile} to disk by default. */
  writeCsv?: CsvFileWriter
}

export type CollectionSyncRun = {
  report: CollectionSyncReport
  /**
   * Every file the run wrote — each changed list, its `.sha256` sidecar, its
   * changelog, any list a pull had to create, and the CSV a push wrote for
   * {@link CollectionSyncOptions.csvFile}. Always empty on a dry run, and on a
   * push that was not asked for a CSV file (a push writes nothing else locally).
   * Callers that commit a run (the admin endpoints) stage exactly this set, so a
   * CSV path outside the collections directory is theirs to filter.
   */
  writtenFiles: string[]
}

// ── Per-list result bookkeeping ───────────────────────────────────────

/** A list's result while the run is still adding to it. */
type MutableListResult = {
  name: string
  status: CollectionSyncStatus
  /** Every reason recorded for the list; joined into the final result. */
  reasons: string[]
  added: number
  removed: number
  pending: number
}

/**
 * The run's per-list results, in first-seen order. Lists are tracked as they
 * are encountered and finished (emitted) once, so a card that fails for two
 * lists marks both without either being reported twice.
 */
type ListResults = {
  track(name: string): MutableListResult
  fail(name: string, reason: string): void
  /** Emit a list's result and return it; later calls return the same result. */
  finish(name: string, reason?: string): CollectionSyncListResult
  /** Every tracked list's result, finishing any the run left open. */
  all(): CollectionSyncListResult[]
}

function createListResults(emit: CollectionSyncEventHandler): ListResults {
  const tracked = new Map<string, MutableListResult>()
  const finished = new Map<string, CollectionSyncListResult>()

  const track = (name: string): MutableListResult => {
    const existing = tracked.get(name)
    if (existing) return existing
    const created: MutableListResult = {
      name,
      status: 'synced',
      reasons: [],
      added: 0,
      removed: 0,
      pending: 0,
    }
    tracked.set(name, created)
    return created
  }

  const finish = (name: string, reason?: string): CollectionSyncListResult => {
    const already = finished.get(name)
    if (already) return already
    const entry = track(name)
    if (reason) entry.reasons.push(reason)
    const result: CollectionSyncListResult = {
      name: entry.name,
      status: entry.status,
      reason: entry.reasons.length > 0 ? entry.reasons.join('; ') : undefined,
      added: entry.added,
      removed: entry.removed,
      pending: entry.pending,
    }
    finished.set(name, result)
    emit({ kind: 'list-result', result })
    return result
  }

  return {
    track,
    fail(name: string, reason: string): void {
      const entry = track(name)
      entry.status = 'failed'
      entry.reasons.push(reason)
    },
    finish,
    all(): CollectionSyncListResult[] {
      return [...tracked.keys()].map((name) => finish(name))
    },
  }
}

// ── Run ───────────────────────────────────────────────────────────────

/** Everything both flows need beyond the indexes they were handed. */
type SyncFlow = {
  client: ArchidektClient
  store: CollectionListStore
  token: string
  dryRun: boolean
  only: SyncChangeFilter | undefined
  into: string
  /** The removal priority as the caller spelled it; resolved per run. */
  removalPriority: string[]
  resolveAmbiguous: ResolveAmbiguousRemovals | undefined
  /** Force the CSV path for a push's additions, whatever their count. */
  csv: boolean
  /** Write the additions' CSV here instead of pushing them. */
  csvFile: string | undefined
  decideCsv: DecideCsvUpload | undefined
  ensureCsvCache: EnsureCsvCache | undefined
  emit: CollectionSyncEventHandler
  results: ListResults
  /** The Scryfall cache, by card name — CSV rows are built from it. */
  lookupPrintings: CardPrintingsLookup
  lookupByScryfallId: ScryfallIdLookup
  writeCsv: CsvFileWriter
  /** False when some in-scope list is missing from the local index; see the report field. */
  localComplete: boolean
}

/** What one direction's flow produced beyond its per-list results. */
type FlowOutcome = {
  writtenFiles: string[]
  errors: string[]
  ambiguous: AmbiguousRemoval[]
  /** What the CSV path did with a push's additions; null when it was not taken. */
  csv: CollectionSyncCsv | null
  totals: CollectionSyncTotals
  /**
   * True when the flow stopped before applying anything — an unusable removal
   * priority, or an ambiguity no strategy could place. Such a run wrote nothing
   * at all, which is why it also records no sync timestamp: "nothing was
   * written" has to mean the account state file too, or every surface reporting
   * `lastSynced` claims a sync that never happened.
   */
  aborted: boolean
}

const NO_CHANGES: CollectionSyncTotals = { added: 0, removed: 0, skipped: 0, pending: 0 }

/**
 * Sync the account's Archidekt collection with the in-scope collection lists in
 * one direction, emitting progress as it goes.
 *
 * Per-list failures never abort the run: each list's outcome lands in the
 * report and the rest continue, so callers branch on `failedCount` and
 * `errors`.
 */
export async function runCollectionSync(
  options: CollectionSyncOptions,
): Promise<CollectionSyncRun> {
  const { direction, token, userId, into } = options
  const emit = options.onEvent ?? ((): void => {})
  const dryRun = options.dryRun ?? false
  const client =
    options.client ??
    createPacedArchidektClient((message) =>
      emit({ kind: 'log', level: 'warn', list: null, message }),
    )
  const store = options.store ?? createDiskCollectionListStore()
  // Cache-only by design: names are "resolved against the local card cache"
  // (docs), and a miss takes the documented nonfoil-with-warning path. The
  // network-falling-back lookup would fire one Scryfall request per distinct
  // uncached name — hundreds on a first sync, even under --dry-run — and
  // blocklist every 404 for a week.
  const lookupPrintings = options.lookupPrintings ?? getCachedCardPrintings
  const lookupByScryfallId =
    options.lookupByScryfallId ?? ((ids: readonly string[]) => scryfallIdIndex.lookup(ids))
  const stateStore = options.state ?? createFileCollectionSyncStateStore()
  const results = createListResults(emit)

  const report = (outcome: FlowOutcome, loaded: LoadedLists): CollectionSyncRun => {
    const lists = results.all()
    return {
      report: {
        direction,
        into: direction === 'pull' ? into : null,
        dryRun,
        lists,
        failedCount: lists.filter((list) => list.status === 'failed').length,
        errors: outcome.errors,
        unreadable: loaded.unreadable,
        ambiguous: outcome.ambiguous,
        localIncomplete: !loaded.complete,
        csv: outcome.csv,
        totals: outcome.totals,
      },
      writtenFiles: outcome.writtenFiles,
    }
  }

  const empty = (errors: string[] = []): FlowOutcome => ({
    writtenFiles: [],
    errors,
    ambiguous: [],
    csv: null,
    totals: NO_CHANGES,
    aborted: errors.length > 0,
  })

  // 1. Scope: the named lists, or every collection list.
  const scoped = await resolveScope(options.lists ?? [], store, emit, results)

  // 2. Load them, holding back any whose lines the parser could not read.
  const loaded = await loadLists(scoped, store, emit, results, options.confirmUnreadable, dryRun)

  if (loaded.lists.length === 0) {
    // A push with nothing readable locally would read as "the collection is
    // empty" and delete the account's records, so it is refused outright. A
    // pull is fine — an empty local side is how a first pull starts.
    if (direction === 'push') {
      const reason =
        'No readable collection lists to push. Refusing to treat that as an empty collection.'
      emit({ kind: 'log', level: 'error', list: null, message: reason })
      return report(empty([reason]), loaded)
    }
    emit({ kind: 'log', level: 'info', list: null, message: 'No collection lists to sync from.' })
  }

  // 3. Index both sides.
  const local = await buildLocalIndex(loaded.lists, lookupPrintings)
  for (const warning of local.warnings) {
    emit({ kind: 'log', level: 'warn', list: warning.list, message: warning.message })
  }

  // Destination names are validated before the remote fetch: they are local
  // facts, and a typo must fail in milliseconds rather than after paging in an
  // entire Archidekt collection. Only a pull has destinations to validate — a
  // push ignores both flags (the command warns about them).
  if (direction === 'pull') {
    const invalid = await validatePullDestinations(store, into, options.removalPriority ?? [])
    if (invalid !== null) {
      emit({ kind: 'log', level: 'error', list: null, message: invalid })
      return report(empty([invalid]), loaded)
    }
  }

  const fetched = await fetchCollection(client, userId, token)
  if (typeof fetched === 'string') {
    emit({ kind: 'log', level: 'error', list: null, message: fetched })
    // Nothing can be compared without the remote side; every in-scope list is
    // unsynced rather than unchanged.
    for (const list of loaded.lists) results.fail(list.name, fetched)
    return report(empty([fetched]), loaded)
  }

  const remote = buildRemoteIndex(fetched.records)
  for (const warning of remote.warnings) {
    emit({ kind: 'log', level: 'warn', list: null, message: warning })
  }
  emit({
    kind: 'log',
    level: 'info',
    list: null,
    message: `Archidekt collection: ${fetched.records.length} records, ${remote.index.size} distinct printings.`,
  })

  // 4. Plan and apply.
  const flow: SyncFlow = {
    client,
    store,
    token,
    dryRun,
    only: options.only,
    into,
    removalPriority: options.removalPriority ?? [],
    resolveAmbiguous: options.resolveAmbiguous,
    csv: options.csv ?? false,
    csvFile: options.csvFile,
    decideCsv: options.decideCsv,
    ensureCsvCache: options.ensureCsvCache,
    emit,
    results,
    lookupPrintings,
    lookupByScryfallId,
    writeCsv: options.writeCsv ?? writeCsvFile,
    localComplete: loaded.complete,
  }
  const names = loaded.lists.map((list) => list.name)
  const outcome =
    direction === 'pull'
      ? await pullFromArchidekt(flow, local.index, remote.index, names)
      : await pushToArchidekt(flow, local.index, remote.index, names)

  // 5. Record when the account last synced. A dry run changed nothing, and
  //    neither did a run that aborted before applying anything — stamping the
  //    state file for either would have the status page and
  //    `get_sync_status` report a sync that wrote nothing at all.
  if (!dryRun && !outcome.aborted) {
    try {
      await stateStore.write({
        lastSynced: new Date().toISOString(),
        userId,
        username: fetched.username,
      })
    } catch (error: unknown) {
      emit({
        kind: 'log',
        level: 'warn',
        list: null,
        message: `Could not record the sync timestamp: ${getErrorMessage(error)}`,
      })
    }
  }

  return report(outcome, loaded)
}

// ── Scope and loading ─────────────────────────────────────────────────

/** The in-scope list names, and whether every one the caller asked for is there. */
type ResolvedScope = {
  names: string[]
  /** False when a requested name did not resolve — the scope is short of a list. */
  complete: boolean
}

/**
 * The lists a run covers: the named ones (each resolved the way every other
 * command resolves a list name), or every collection list when none were named.
 * A name that does not resolve fails as its own list result — one bad name does
 * not sink the run — but it does make the scope incomplete, which the diff has
 * to account for.
 */
async function resolveScope(
  names: string[],
  store: CollectionListStore,
  emit: CollectionSyncEventHandler,
  results: ListResults,
): Promise<ResolvedScope> {
  if (names.length === 0) return { names: await store.allLists(), complete: true }

  const resolved: string[] = []
  let complete = true
  for (const name of names) {
    const location = await store.resolve(name)
    if (isResolveFailure(location)) {
      const message = formatResolveListError(location, 'none')
      emit({ kind: 'log', level: 'error', list: null, message })
      results.fail(name, message)
      results.finish(name)
      complete = false
      continue
    }
    if (!resolved.includes(location.name)) resolved.push(location.name)
  }
  return { names: resolved, complete }
}

type LoadedLists = {
  lists: LoadedCollectionList[]
  unreadable: UnreadableList[]
  /**
   * False when some in-scope list is missing from {@link lists} — it failed to
   * resolve, failed to read, or was held back for unreadable lines. The union of
   * the loaded lists is then *not* the local truth, which is what
   * {@link runCollectionSync} keys its safety check off.
   */
  complete: boolean
}

/**
 * Read every in-scope list, holding back the ones carrying lines the parser
 * cannot read until the caller accepts what syncing them would drop. No
 * decision — no handler, or a declined prompt — fails those lists, since that
 * is the direction that cannot destroy anything. A dry run changes nothing, so
 * it reports the lines and previews the lists like any other.
 */
async function loadLists(
  scope: ResolvedScope,
  store: CollectionListStore,
  emit: CollectionSyncEventHandler,
  results: ListResults,
  confirmUnreadable: ConfirmUnreadableLists | undefined,
  dryRun: boolean,
): Promise<LoadedLists> {
  const lists: LoadedCollectionList[] = []
  const held: LoadedCollectionList[] = []
  let complete = scope.complete

  for (const name of scope.names) {
    const loaded = await store.load(name)
    if (typeof loaded === 'string') {
      const reason = `Could not read collection list "${name}": ${loaded}`
      emit({ kind: 'log', level: 'error', list: null, message: reason })
      results.fail(name, reason)
      results.finish(name)
      complete = false
      continue
    }
    // Advisories are about lines that parsed: they are reported for every list,
    // whether or not the list is held back for unreadable lines, and never
    // decide anything.
    for (const advisory of loaded.advisories) {
      emit({ kind: 'log', level: 'warn', list: loaded.name, message: advisory })
    }
    if (loaded.warnings.length > 0) held.push(loaded)
    else lists.push(loaded)
  }

  if (held.length === 0) return { lists, unreadable: [], complete }

  const unreadable: UnreadableList[] = held.map((list) => ({
    name: list.name,
    file: list.file,
    warnings: list.warnings,
  }))
  emit({ kind: 'unreadable-lines', lists: unreadable })

  let accepted = dryRun
  if (!accepted && confirmUnreadable) {
    try {
      accepted = await confirmUnreadable(unreadable)
    } catch (error: unknown) {
      // A handler that throws is a decision that was never made — refuse.
      emit({
        kind: 'log',
        level: 'error',
        list: null,
        message: `Could not confirm the unreadable lines: ${getErrorMessage(error)}`,
      })
    }
  }

  for (const list of held) {
    if (accepted) {
      lists.push(list)
      continue
    }
    const count = list.warnings.length
    const reason = `${t('domain.count.unreadableLines', { count })} would be dropped by a sync`
    emit({ kind: 'log', level: 'warn', list: null, message: `${list.file}: ${reason}` })
    results.fail(list.name, reason)
    results.finish(list.name)
    complete = false
  }

  if (accepted && dryRun && !confirmUnreadable) {
    // The preview includes lists a real run would hold back, so say so rather
    // than letting the two disagree silently.
    emit({
      kind: 'log',
      level: 'info',
      list: null,
      message:
        'This preview includes the lists above; a real run holds them back until their unreadable lines are accepted.',
    })
  }

  return { lists, unreadable, complete }
}

// ── Remote fetch ──────────────────────────────────────────────────────

/** The whole remote collection, plus who it belongs to. */
type FetchedCollection = {
  records: ArchidektCollectionRecord[]
  username: string
}

/**
 * Page through the account's collection, following `next` until it runs out.
 * `totalPages` is a backstop: a response that keeps advertising a next page can
 * not spin the run forever. Returns the message explaining a failed fetch
 * rather than throwing — the run reports it against every in-scope list.
 */
async function fetchCollection(
  client: ArchidektClient,
  userId: number,
  token: string,
): Promise<FetchedCollection | string> {
  const records: ArchidektCollectionRecord[] = []
  // Every page names the owner; the loop always reads at least one before
  // returning, so this is only undefined on a path that returns an error.
  let username: string | undefined
  let page = 1

  while (true) {
    try {
      const response = await client.fetchCollectionPage(userId, page, token)
      records.push(...response.results)
      username = response.owner.username
      if (!response.next) break
      page++
      if (page > response.totalPages) break
    } catch (error: unknown) {
      // No outer prefix: the client's error already names the page and account
      // it could not fetch ("Failed to fetch collection page 1 for user 12345: …").
      return getErrorMessage(error)
    }
  }

  return { records, username: username ?? '' }
}

// ── Pull (Archidekt → local) ──────────────────────────────────────────

async function pullFromArchidekt(
  flow: SyncFlow,
  local: LocalCollectionIndex,
  remote: RemoteCollectionIndex,
  names: string[],
): Promise<FlowOutcome> {
  const { emit, results, store, dryRun } = flow
  const writtenFiles: string[] = []

  const plan = planPull(local, remote, flow.only)
  const skippedMessage = describeSkippedChanges(flow.only, plan.skipped)
  if (skippedMessage) emit({ kind: 'log', level: 'info', list: null, message: skippedMessage })

  let target = flow.into
  let applicable = plan

  /**
   * Give up on the whole pull. Nothing has been written at this point — not a
   * list, not the target list a pull creates, not the sync timestamp — which is
   * what `aborted` tells {@link runCollectionSync}.
   */
  const abort = (message: string): FlowOutcome => {
    emit({ kind: 'log', level: 'error', list: null, message })
    return {
      writtenFiles: [],
      errors: [message],
      ambiguous: plan.ambiguous,
      csv: null,
      totals: NO_CHANGES,
      aborted: true,
    }
  }

  // Ambiguity is settled before anything is written: a run that cannot place
  // every ambiguous removal writes nothing at all, so a half-made decision can
  // never reach a list file.
  const priority = await resolveRemovalPriority(flow.store, flow.removalPriority)
  if (typeof priority === 'string') return abort(priority)

  for (const ambiguous of plan.ambiguous) {
    emit({ kind: 'log', level: 'warn', list: null, message: describeAmbiguousRemoval(ambiguous) })
  }

  if (plan.ambiguous.length > 0) {
    const placed = await placeAmbiguous(flow, local, plan.ambiguous, priority)
    if (typeof placed === 'string') return abort(placed)
    if (placed.length > 0) applicable = { ...plan, removals: [...plan.removals, ...placed] }
  }

  // A list that dropped out of the comparison makes every card it holds look
  // remote-only, so pulling would copy that whole file into the target list.
  // Removals are safe (they only ever name a list that *was* loaded), so only
  // the additions are withheld.
  if (!flow.localComplete && applicable.additions.length > 0) {
    const copies = applicable.additions.reduce((total, addition) => total + addition.quantity, 0)
    emit({
      kind: 'log',
      level: 'error',
      list: null,
      message: `Not adding ${t('domain.count.copies', { count: copies })}: some collection lists in scope could not be read, so cards they already hold would be duplicated into "${flow.into}". Fix or accept those lists and run again.`,
    })
    applicable = { ...applicable, additions: [] }
  }

  // The target list is only needed — and only created — when something is
  // actually being added. When it cannot be resolved, the additions are
  // dropped (they have nowhere to go) and the removals still apply.
  if (applicable.additions.length > 0) {
    const resolved = await resolveTarget(flow)
    if (typeof resolved === 'string') {
      emit({ kind: 'log', level: 'error', list: null, message: resolved })
      results.fail(flow.into, resolved)
      results.finish(flow.into)
      applicable = { ...applicable, additions: [] }
    } else {
      target = resolved.name
      writtenFiles.push(...resolved.writtenFiles)
    }
  }

  const resolveName = await pulledNameResolver(flow, applicable.additions)
  const changesByList = new Map<string, PullListChanges>()
  for (const entry of pullChangesByList(applicable, target, resolveName)) {
    changesByList.set(entry.list, entry)
  }

  // Every in-scope list is reported, plus the target list when it is not one of
  // them — a pull that only adds still has something to say about where.
  const ordered = [...names]
  if (changesByList.has(target) && !ordered.includes(target)) ordered.push(target)

  let added = 0
  let removed = 0
  for (const [index, name] of ordered.entries()) {
    emit({ kind: 'list-start', list: name, index, total: ordered.length })
    const changes = changesByList.get(name)
    if (!changes || changes.changes.length === 0) {
      emit({ kind: 'log', level: 'info', list: name, message: 'No changes.' })
      results.finish(name, 'no changes')
      continue
    }

    const summary = `+${changes.added} added, -${changes.removed} removed`
    emit({ kind: 'log', level: 'info', list: name, message: `Changes: ${summary}` })

    // Counted only once the write lands, so the totals describe what happened
    // rather than what was planned.
    const countChanges = (): void => {
      const entry = results.track(name)
      entry.added += changes.added
      entry.removed += changes.removed
      added += changes.added
      removed += changes.removed
    }

    if (dryRun) {
      countChanges()
      emit({ kind: 'log', level: 'info', list: name, message: '[dry-run] Not saved.' })
      results.finish(name, `dry-run: ${summary}`)
      continue
    }

    try {
      writtenFiles.push(...(await store.apply(name, changes.changes)))
      countChanges()
      emit({ kind: 'log', level: 'info', list: name, message: 'Saved.' })
      results.finish(name)
    } catch (error: unknown) {
      const reason = `Failed to save: ${getErrorMessage(error)}`
      emit({ kind: 'log', level: 'error', list: name, message: reason })
      results.fail(name, reason)
      results.finish(name)
    }
  }

  return {
    writtenFiles,
    // A pull's only failures belong to a list — including a target list that
    // could not be resolved, which is reported under the name it was asked for.
    errors: [],
    ambiguous: plan.ambiguous,
    // The CSV path is a push's answer to a large batch of additions; a pull
    // writes list files, which have no such cost.
    csv: null,
    totals: { added, removed, skipped: plan.skipped, pending: 0 },
    aborted: false,
  }
}

// ── Ambiguous removals ────────────────────────────────────────────────

/**
 * Resolve the run's removal priority to canonical list names, or the message
 * explaining why it cannot be used.
 *
 * Names are matched exactly (normalized), the way the pull target is: a priority
 * is a promise about which binders may lose cards, and the substring rule could
 * quietly take copies out of a neighbouring one. Every bad name is reported at
 * once, so a fixed run does not trip over the next typo.
 */
async function resolveRemovalPriority(
  store: CollectionListStore,
  removalPriority: readonly string[],
): Promise<string[] | string> {
  if (removalPriority.length === 0) return []

  const resolved: string[] = []
  const problems: string[] = []
  for (const name of removalPriority) {
    const matches = await listsNamed(store, name)
    if (matches.length === 0) {
      problems.push(`no collection list is named "${name}"`)
    } else if (matches.length > 1) {
      problems.push(`more than one collection list is named "${name}": ${matches.join(', ')}`)
    } else if (!resolved.includes(matches[0]!)) {
      resolved.push(matches[0]!)
    }
  }

  return problems.length > 0 ? `Cannot use the removal priority: ${problems.join('; ')}.` : resolved
}

/** The cards an unplaceable set of removals is about, for the failure message. */
function describeUnplaceable(unresolved: readonly AmbiguousRemoval[]): string {
  return unresolved
    .map((entry) => `${entry.quantity} × ${describeCollectionKey(entry.name, entry.parts)}`)
    .join(', ')
}

/**
 * Place the plan's ambiguous removals, or return the message explaining why the
 * run cannot proceed.
 *
 * Precedence: a removal priority is the only strategy consulted when one was
 * given (it never prompts, even on a terminal); otherwise the caller's
 * {@link ResolveAmbiguousRemovals} decides; with neither, an ambiguous removal
 * fails the run. A dry run resolves nothing for real — it reports what a real
 * run would do, and never fails.
 */
async function placeAmbiguous(
  flow: SyncFlow,
  local: LocalCollectionIndex,
  ambiguous: readonly AmbiguousRemoval[],
  priority: readonly string[],
): Promise<PullRemoval[] | string> {
  const { emit, dryRun } = flow
  const preview = dryRun ? '[dry-run] ' : ''

  const announce = (removals: readonly PullRemoval[], reason: string): void => {
    for (const removal of removals) {
      emit({
        kind: 'log',
        level: 'info',
        list: null,
        message: `${preview}Removing ${removal.copies.length} × ${describeCollectionKey(removal.name, removal.parts)} from "${removal.list}" (${reason}).`,
      })
    }
  }

  if (priority.length > 0) {
    const resolution = resolveAmbiguousByPriority(local, ambiguous, priority)
    if (resolution.ok) {
      announce(resolution.removals, 'removal priority')
      return resolution.removals
    }
    const message = `The removal priority (${priority.join(', ')}) cannot place ${describeUnplaceable(resolution.unresolved)}. Nothing was written.`
    if (!dryRun) return message
    emit({ kind: 'log', level: 'warn', list: null, message: `${preview}${message}` })
    return []
  }

  if (dryRun) {
    // A preview neither prompts nor fails; it says what a real run would need.
    emit({
      kind: 'log',
      level: 'warn',
      list: null,
      message: `${preview}A real run would refuse to place ${describeUnplaceable(ambiguous)} until the ambiguity is resolved.`,
    })
    return []
  }

  if (!flow.resolveAmbiguous) {
    return `Could not place ${describeUnplaceable(ambiguous)}: the removals are ambiguous and were not resolved. Nothing was written.`
  }

  let outcome: AmbiguityResolutionOutcome
  try {
    outcome = await flow.resolveAmbiguous(ambiguous)
  } catch (error: unknown) {
    // A resolver that throws is a decision that was never made — refuse.
    return `Could not resolve the ambiguous removals: ${getErrorMessage(error)}. Nothing was written.`
  }
  // The resolver's own wording — which of "no terminal", "declined", and
  // "cancelled" happened is the actionable part, and only it knows.
  if (!outcome.ok) return `${outcome.message} Nothing was written.`

  const resolution = applyRemovalAssignments(local, ambiguous, outcome.assignments)
  if (!resolution.ok) {
    return `Could not place ${describeUnplaceable(resolution.unresolved)}: the resolution did not say which lists lose those copies. Nothing was written.`
  }
  announce(resolution.removals, 'resolved')
  return resolution.removals
}

// ── The pull target ───────────────────────────────────────────────────

/**
 * The lists answering exactly to a name (normalized), never by the substring
 * rule `store.resolve` applies — shared by the pull target and the removal
 * priority, both of which name a list that is about to be written to.
 */
async function listsNamed(store: CollectionListStore, name: string): Promise<string[]> {
  const normalized = normalizeListName(name)
  return (await store.allLists()).filter((list) => normalizeListName(list) === normalized)
}

/**
 * Everything a pull can check about its destination names before touching the
 * network: the removal priority resolves, and `--into` is not ambiguous.
 *
 * Both are purely local, so they run right after the lists load and *before* the
 * remote collection is paged in — a typo must not cost a multi-minute fetch
 * first. `--into` naming no list is fine (a pull creates it); `--into` naming
 * two is not, and only the user can say which they meant. The full target
 * resolution still happens later, when something is actually being added.
 *
 * Deliberately a gate rather than a resolver: the resolved names are recomputed
 * inside the flow, because `pullFromArchidekt` takes an injected store and must
 * not depend on this having run — the same reason {@link resolveTarget} repeats
 * its own ambiguity check. The store caches `allLists()`, so the repeat costs
 * nothing.
 */
export async function validatePullDestinations(
  store: CollectionListStore,
  into: string,
  removalPriority: readonly string[],
): Promise<string | null> {
  const priority = await resolveRemovalPriority(store, removalPriority)
  if (typeof priority === 'string') return priority

  const matches = await listsNamed(store, into)
  if (matches.length > 1) {
    return `More than one collection list is named "${into}": ${matches.join(', ')}. Point --into (or collectionSync.pullTarget) at one of them.`
  }
  return null
}

/** The pull target, created when it does not exist yet, or the reason it could not be. */
type PullTarget = { name: string; writtenFiles: string[] }

async function resolveTarget(flow: SyncFlow): Promise<PullTarget | string> {
  const { store, emit, dryRun, into } = flow
  // The target is a destination rather than a lookup, so it is matched by name
  // only — never by the substring rule `store.resolve` applies. The default
  // target `Inbox` would otherwise silently resolve to an unrelated
  // `card-inbox` binder and pull a stranger's cards into it.
  const matches = await listsNamed(store, into)
  if (matches.length === 1) return { name: matches[0]!, writtenFiles: [] }
  if (matches.length > 1) {
    // Two lists answer to the name — creating a third would be worse than
    // stopping, and only the user can say which they meant. A run through
    // `runCollectionSync` has already refused this at
    // {@link validatePullDestinations}; the branch stands because the store is
    // injectable and this function must not depend on that gate having run.
    return `More than one collection list is named "${into}": ${matches.join(', ')}. Point --into (or collectionSync.pullTarget) at one of them.`
  }

  if (dryRun) {
    emit({
      kind: 'log',
      level: 'info',
      list: null,
      message: `[dry-run] Would create collection list "${into}" for the cards being added.`,
    })
    return { name: into, writtenFiles: [] }
  }

  const created = await store.create(into)
  if (typeof created === 'string') {
    return `Could not create the collection list "${into}": ${created}`
  }
  emit({
    kind: 'log',
    level: 'info',
    list: null,
    message: `Created collection list "${created.name}" for the cards being added.`,
  })
  return { name: created.name, writtenFiles: created.writtenFiles }
}

/**
 * Name pulled cards the way the cache spells them.
 *
 * Archidekt reports the oracle name, while list files (and the cache) use the
 * full Scryfall name — `Front // Back` for split and double-faced cards — so a
 * pulled line written under the oracle name would not resolve to a card. The
 * printing is looked up by its Scryfall id, which every record carries; a
 * printing the cache does not hold falls back to the oracle name.
 */
async function pulledNameResolver(
  flow: SyncFlow,
  additions: readonly PullAddition[],
): Promise<(addition: PullAddition) => string> {
  if (additions.length === 0) return (addition) => addition.name
  let cards: Map<string, ScryfallCard>
  try {
    cards = await flow.lookupByScryfallId(additions.map((addition) => addition.scryfallId))
  } catch (error: unknown) {
    flow.emit({
      kind: 'log',
      level: 'warn',
      list: null,
      message: `Could not read the Scryfall cache: ${getErrorMessage(error)}`,
    })
    return (addition) => addition.name
  }
  return (addition) => cards.get(addition.scryfallId)?.name ?? addition.name
}

// ── Push (local → Archidekt) ──────────────────────────────────────────

async function pushToArchidekt(
  flow: SyncFlow,
  local: LocalCollectionIndex,
  remote: RemoteCollectionIndex,
  names: string[],
): Promise<FlowOutcome> {
  const { emit, results } = flow
  const errors: string[] = []

  const plan = planPush(local, remote, flow.only)
  const skippedMessage = describeSkippedChanges(flow.only, plan.skipped)
  if (skippedMessage) emit({ kind: 'log', level: 'info', list: null, message: skippedMessage })

  // The mirror image of the pull guard above: a list missing from the comparison
  // makes the cards it holds look gone, and a push would delete them from the
  // account. Only the operations that take copies away are withheld — the ones
  // that add copies are as valid as they would be with the list present.
  let operations = plan.operations
  if (!flow.localComplete) {
    const shrinking = operations.filter((operation) => operationRemoved(operation) > 0)
    if (shrinking.length > 0) {
      const copies = shrinking.reduce((total, operation) => total + operationRemoved(operation), 0)
      emit({
        kind: 'log',
        level: 'error',
        list: null,
        message: `Not removing ${t('domain.count.copies', { count: copies })} from Archidekt: some collection lists in scope could not be read, so cards they still hold would look gone. Fix or accept those lists and run again.`,
      })
      operations = operations.filter((operation) => operationRemoved(operation) === 0)
    }
  }

  // How the additions reach Archidekt is settled *before* the first remote
  // write, the way an ambiguous removal is settled before the first file write: a
  // run that cannot answer the question leaves the account untouched rather than
  // half-pushed.
  const creates = operations.filter(
    (operation): operation is PushCreate => operation.kind === 'create',
  )
  const route = await routeAdditions(flow, creates)
  if (typeof route === 'string') {
    emit({ kind: 'log', level: 'error', list: null, message: route })
    return {
      writtenFiles: [],
      errors: [route],
      ambiguous: [],
      csv: null,
      totals: NO_CHANGES,
      aborted: true,
    }
  }

  let added = 0
  let removed = 0
  let pending = 0
  let csv: CollectionSyncCsv | null = null
  const writtenFiles: string[] = []

  if (route.kind !== 'individual' && creates.length > 0) {
    const bulk = await pushAdditionsAsCsv(flow, route, creates)
    csv = bulk.csv
    added += bulk.added
    pending += bulk.pending
    writtenFiles.push(...bulk.writtenFiles)
    // Whatever the outcome, the creates the CSV took are not tried again one at a
    // time — a failed upload is reported as a failure, not retried by another
    // route (which would double-import on a partial success).
    const carried = new Set<PushOperation>(bulk.carried)
    operations = operations.filter((operation) => !carried.has(operation))
  }

  // Operations belong to the list holding the key's copies; the ones for cards
  // that live in no list any more belong to the run. `lists` follows scope
  // order (the local index was built in it), so an operation always executes at
  // its *earliest* list's turn — every other list it counts against is still
  // ahead of the loop and has not been reported yet.
  const byList = new Map<string, PushOperation[]>()
  const orphaned: PushOperation[] = []
  for (const operation of operations) {
    const owner = operation.lists[0]
    if (owner === undefined) {
      orphaned.push(operation)
      continue
    }
    const existing = byList.get(owner)
    if (existing) existing.push(operation)
    else byList.set(owner, [operation])
  }

  for (const [index, name] of names.entries()) {
    emit({ kind: 'list-start', list: name, index, total: names.length })
    const owned = byList.get(name) ?? []
    if (owned.length === 0) {
      // A key held in several binders is pushed once, at its first list's turn
      // (or by the CSV upload, before the loop began), and credited to every list
      // holding it — so a list with nothing of its own may still have moved
      // copies, and must not report "no changes". Nor may a list the CSV already
      // failed: "could not be imported; no changes" is two answers to one
      // question.
      const entry = results.track(name)
      if (
        entry.status !== 'failed' &&
        entry.added === 0 &&
        entry.removed === 0 &&
        entry.pending === 0
      ) {
        emit({ kind: 'log', level: 'info', list: name, message: 'No changes.' })
        results.finish(name, 'no changes')
      } else {
        results.finish(name)
      }
      continue
    }

    for (const operation of owned) {
      const applied = await runPushOperation(flow, operation, name, route.kind !== 'individual')
      if (!applied) continue
      const operationAdd = operationAdded(operation)
      const operationRemove = operationRemoved(operation)
      added += operationAdd
      removed += operationRemove
      // A key held in several lists is equally pushed from each of them, so the
      // counts (and any failure) are recorded against all of them.
      for (const list of operation.lists) {
        const entry = results.track(list)
        entry.added += operationAdd
        entry.removed += operationRemove
      }
    }

    results.finish(name)
  }

  for (const operation of orphaned) {
    // Orphans are removals — a card no list holds any more — so the CSV route
    // never applies to them.
    const applied = await runPushOperation(flow, operation, null, false)
    if (!applied) {
      errors.push(pushFailureReason(operation))
      continue
    }
    removed += operationRemoved(operation)
  }

  return {
    writtenFiles,
    errors,
    ambiguous: [],
    csv,
    totals: { added, removed, skipped: plan.skipped, pending },
    // A push applies its operations one by one: a failed one is a failure of
    // that operation, not of the run, which still reached Archidekt.
    aborted: false,
  }
}

// ── Push additions as a CSV import ────────────────────────────────────

/** Added one at a time, as every push below the threshold is. */
type IndividualRoute = { kind: 'individual' }
/** Sent to Archidekt as one CSV import. */
type UploadRoute = { kind: 'upload' }
/** Written to a file instead of being pushed at all. */
type ExportRoute = { kind: 'export'; path: string }

/** How a push's additions reach Archidekt, once the question is settled. */
type CsvRoute = IndividualRoute | UploadRoute | ExportRoute

/** The two routes that build a CSV out of the additions. */
type CsvBulkRoute = UploadRoute | ExportRoute

/**
 * Decide the route the additions take, or return the message explaining why the
 * run cannot proceed. Nothing has been written to Archidekt when this is called.
 *
 * Precedence: `csvFile` (write instead of push) beats `csv` (upload), both beat
 * the threshold; at or below the threshold nothing changes about how a push
 * behaves. Over it, a dry run answers itself — it previews the upload rather than
 * resolving printings one at a time, which is what makes a first dry run cheap —
 * and a real run asks {@link DecideCsvUpload}, or fails when there is nobody to
 * ask.
 *
 * Whichever way a CSV route is reached, the local cache the rows are keyed from
 * has to be fit for it, so {@link EnsureCsvCache} gets the last word — a refusal
 * there is a refusal of the run.
 */
async function routeAdditions(
  flow: SyncFlow,
  creates: readonly PushCreate[],
): Promise<CsvRoute | string> {
  const route = await chooseAdditionsRoute(flow, creates)
  if (typeof route === 'string' || route.kind === 'individual') return route

  // The rows are built from the local Scryfall cache, so a cache the surface's
  // policy will not vouch for stops the run here — before the first remote write,
  // and without falling back to a search per card.
  if (flow.ensureCsvCache) {
    let ready: true | string
    try {
      ready = await flow.ensureCsvCache({
        additions: creates.length,
        log: (message) => flow.emit({ kind: 'log', level: 'info', list: null, message }),
      })
    } catch (error: unknown) {
      return `Could not prepare the card cache for a CSV upload: ${getErrorMessage(error)}. Nothing was pushed.`
    }
    if (ready !== true) return `${ready} Nothing was pushed.`
  }
  return route
}

/** The route itself, before the cache the rows come from is taken into account. */
async function chooseAdditionsRoute(
  flow: SyncFlow,
  creates: readonly PushCreate[],
): Promise<CsvRoute | string> {
  if (creates.length === 0) return { kind: 'individual' }
  if (flow.csvFile !== undefined) return { kind: 'export', path: flow.csvFile }
  if (flow.csv) return { kind: 'upload' }
  if (creates.length <= CSV_UPLOAD_THRESHOLD) return { kind: 'individual' }
  if (flow.dryRun) return { kind: 'upload' }

  if (!flow.decideCsv) {
    // Surface-neutral: this branch is reached only by callers that supply no
    // decider (the admin API, the MCP tool), where naming CLI flags would be
    // advice the reader cannot take. The CLI's own decider words its refusal with
    // the flags that settle it.
    return `${creates.length} cards would be added — more than ${CSV_UPLOAD_THRESHOLD}, so adding them one at a time would cost ${creates.length} printing searches, and this run was not told to upload them as one CSV import instead. Nothing was pushed.`
  }

  let decision: CsvUploadDecision
  try {
    decision = await flow.decideCsv({
      additions: creates.length,
      threshold: CSV_UPLOAD_THRESHOLD,
    })
  } catch (error: unknown) {
    // A decider that throws is a decision that was never made — refuse.
    return `Could not decide how to add ${creates.length} cards: ${getErrorMessage(error)}. Nothing was pushed.`
  }

  switch (decision.kind) {
    case 'individual':
      return { kind: 'individual' }
    case 'upload':
      return { kind: 'upload' }
    case 'export': {
      // A blank path is not a destination: writing to it would fail after the
      // rest of the push had already gone out.
      const path = decision.path.trim()
      if (path === '') return 'No file was named for the additions CSV. Nothing was pushed.'
      return { kind: 'export', path }
    }
    case 'abort':
      // The decider's own wording — "cancelled" and "no terminal" are different
      // things to be told, and only it knows which happened.
      return `${decision.message} Nothing was pushed.`
  }
}

/** What the CSV path did, and which creates it took off the per-card path. */
type CsvAdditions = {
  csv: CollectionSyncCsv | null
  /** The CSV file a `csvFile` run wrote; empty otherwise. */
  writtenFiles: string[]
  /** Copies the upload landed on Archidekt. */
  added: number
  /** Copies waiting in a file for a manual import. */
  pending: number
  /**
   * The creates the CSV took responsibility for — excluded from the per-card path
   * whether they were imported, exported, or lost to a failed upload. Empty when
   * no row could be built at all, which sends every addition back the slow way.
   */
  carried: PushCreate[]
}

/** How many failed rows are named individually before the log stops listing them. */
const CSV_FAILURE_DETAIL_LIMIT = 10

/**
 * Send a push's additions through Archidekt's CSV importer — or write them to a
 * file for the user to import — crediting each list with the copies that actually
 * landed.
 *
 * Additions whose printing the local cache does not hold cannot be turned into a
 * row (a uid-less row is one Archidekt would have to guess about), so they are
 * reported and handed back to the per-card path. A wholesale upload failure fails
 * those additions' lists and nothing else: the run's quantity changes and
 * removals are unaffected by it.
 */
async function pushAdditionsAsCsv(
  flow: SyncFlow,
  route: CsvBulkRoute,
  creates: readonly PushCreate[],
): Promise<CsvAdditions> {
  const { emit, results, dryRun } = flow
  const nothing: CsvAdditions = {
    csv: null,
    writtenFiles: [],
    added: 0,
    pending: 0,
    carried: [],
  }

  const plan = await planCollectionCsv(creates, flow.lookupPrintings)
  for (const warning of plan.warnings) {
    emit({ kind: 'log', level: 'warn', list: null, message: warning })
  }
  if (plan.uncached.length > 0) {
    const count = plan.uncached.length
    emit({
      kind: 'log',
      level: 'warn',
      list: null,
      message: t('domain.sync.csvUncachedAdditions', { count }),
    })
  }
  const counts: CollectionSyncCsvCounts = {
    cards: plan.copies,
    rows: plan.rows.length,
    uncached: plan.uncached.length,
  }
  // Not a single row could be keyed, so there is nothing to upload or write — but
  // the run *did* take the CSV route, and a caller reading only the report would
  // otherwise see `csv: null` and no explanation for the slow path those
  // additions took.
  if (plan.rows.length === 0) return { ...nothing, csv: { ...counts, status: 'empty' } }

  const size = describeCsvSize(counts.cards, counts.rows)

  /** Credit every list holding these creates, and total the copies. */
  const credit = (rows: readonly PushCreate[], field: 'added' | 'pending'): number => {
    let total = 0
    for (const operation of rows) {
      total += operation.quantity
      for (const list of operation.lists) {
        results.track(list)[field] += operation.quantity
      }
    }
    return total
  }

  /** Fail every list whose additions the CSV lost, without touching the run. */
  const failRows = (rows: readonly PushCreate[], reason: string): void => {
    for (const operation of rows) {
      for (const list of operation.lists) results.fail(list, reason)
    }
  }

  if (dryRun) {
    emit({
      kind: 'log',
      level: 'info',
      list: null,
      message:
        route.kind === 'export'
          ? `[dry-run] Would write ${size} to ${route.path} for a manual upload at ${ARCHIDEKT_IMPORT_URL}.`
          : `[dry-run] Would upload ${size} as a CSV import.`,
    })
    return {
      csv:
        route.kind === 'export'
          ? { ...counts, status: 'planned', destination: 'export', path: route.path }
          : { ...counts, status: 'planned', destination: 'upload' },
      writtenFiles: [],
      // A preview counts what a real run would do, exactly as the rest of a dry
      // run does — as pending when the cards would only be written to a file.
      added: route.kind === 'export' ? 0 : credit(plan.rows, 'added'),
      pending: route.kind === 'export' ? credit(plan.rows, 'pending') : 0,
      carried: plan.rows,
    }
  }

  if (route.kind === 'export') {
    try {
      await flow.writeCsv(route.path, `${plan.csv}\n`)
    } catch (error: unknown) {
      const message = `Failed to write the additions CSV to ${route.path}: ${getErrorMessage(error)}`
      emit({ kind: 'log', level: 'error', list: null, message })
      failRows(plan.rows, message)
      return { ...nothing, csv: { ...counts, status: 'failed', message }, carried: plan.rows }
    }
    emit({
      kind: 'log',
      level: 'info',
      list: null,
      message: `Wrote ${size} to ${route.path}; they were not pushed. Import the file at ${ARCHIDEKT_IMPORT_URL}.`,
    })
    return {
      csv: { ...counts, status: 'exported', path: route.path },
      writtenFiles: [route.path],
      added: 0,
      pending: credit(plan.rows, 'pending'),
      carried: plan.rows,
    }
  }

  emit({ kind: 'log', level: 'info', list: null, message: `Uploading ${size} as a CSV import...` })
  let result: CollectionCsvUploadResult
  try {
    result = await flow.client.uploadCollectionCsv(plan.csv, COLLECTION_CSV_UPLOAD, flow.token)
  } catch (error: unknown) {
    const message = `Failed to upload ${size} as a CSV import: ${getErrorMessage(error)}`
    emit({ kind: 'log', level: 'error', list: null, message })
    failRows(plan.rows, message)
    return { ...nothing, csv: { ...counts, status: 'failed', message }, carried: plan.rows }
  }

  for (const unreadable of result.unreadable) {
    emit({
      kind: 'log',
      level: 'warn',
      list: null,
      message: `Could not read Archidekt's answer for CSV chunk ${unreadable.chunk}: ${unreadable.message}. Response: ${unreadable.body}`,
    })
  }

  // Paired once, by operation rather than by row number: `failed` is the creates
  // Archidekt refused, so nothing below has to trust a row index a second time.
  const { failures, failed, unpaired } = collectionCsvOutcome(plan, result)
  if (unpaired > 0) {
    emit({
      kind: 'log',
      level: 'warn',
      list: null,
      message: `${t('domain.count.refusedRows', { count: unpaired })} could not be matched to a card; the copies they carried are credited on faith — a later push reconciles anything actually missed.`,
    })
  }
  const refused = new Set<PushCreate>(failed)
  if (failures.length > 0) {
    const reasons = describeCsvFailureReasons(failures)
    emit({
      kind: 'log',
      level: 'warn',
      list: null,
      message: `Archidekt did not import ${failures.length} of ${counts.rows} CSV rows${reasons ? ` (${reasons})` : ''}.`,
    })
    for (const failure of failures.slice(0, CSV_FAILURE_DETAIL_LIMIT)) {
      emit({
        kind: 'log',
        level: 'warn',
        list: null,
        // The describer always has something to say, so there is no empty-reason
        // shape to word around here.
        message: `  Not imported: ${failure.card} — ${describeCsvFailure(failure)}.`,
      })
    }
    if (failures.length > CSV_FAILURE_DETAIL_LIMIT) {
      emit({
        kind: 'log',
        level: 'warn',
        list: null,
        message: `  …and ${failures.length - CSV_FAILURE_DETAIL_LIMIT} more.`,
      })
    }
    failRows(
      failed,
      `${t('domain.count.cards', { count: failures.length })} could not be imported from the CSV`,
    )
  }

  const landed = plan.rows.filter((operation) => !refused.has(operation))
  const imported = landed.reduce((total, operation) => total + operation.quantity, 0)
  emit({
    kind: 'log',
    level: 'info',
    list: null,
    message: `Imported ${describeCsvSize(imported, landed.length)} from the CSV in ${t('domain.count.requests', { count: result.chunkCount })}.`,
  })

  return {
    csv: {
      ...counts,
      status: 'uploaded',
      chunks: result.chunkCount,
      failures,
      // Rows in a chunk whose answer could not be read are counted as imported
      // because nothing said otherwise; the count is how a report-only consumer
      // tells that apart from a confirmed import.
      unconfirmedChunks: new Set(result.unreadable.map((entry) => entry.chunk)).size,
    },
    writtenFiles: [],
    added: credit(landed, 'added'),
    pending: 0,
    carried: plan.rows,
  }
}

/** The reason recorded when an orphaned operation fails; the log carries the detail. */
function pushFailureReason(operation: PushOperation): string {
  return `Failed to remove ${describeCollectionKey(operation.name, operation.parts)} from Archidekt`
}

/**
 * Execute one push operation, returning whether it applied. A failure is
 * reported against every list holding the key (a card split across binders is
 * equally unpushed from either) and never aborts the run.
 *
 * @param csvRouted Whether this run's additions took the CSV path. A create that
 *   is here despite that is one the local cache could not key, and a **dry run**
 *   then reports it rather than resolving it: the whole point of previewing a
 *   large push is that it costs no per-card search, and a stale cache must not be
 *   able to turn one preview into hundreds of them.
 */
async function runPushOperation(
  flow: SyncFlow,
  operation: PushOperation,
  list: string | null,
  csvRouted: boolean,
): Promise<boolean> {
  const { client, token, dryRun, emit, results } = flow
  const label = describeCollectionKey(operation.name, operation.parts)

  const fail = (reason: string): boolean => {
    emit({ kind: 'log', level: 'error', list, message: reason })
    for (const name of operation.lists) results.fail(name, reason)
    return false
  }

  const log = (message: string): void => {
    emit({ kind: 'log', level: 'info', list, message })
  }

  if (operation.kind === 'create') {
    // Said before anything is sent (and on dry runs too): the record about to be
    // created will not carry the language the local line does.
    const languageWarning = unmappableLanguageWarning(operation.name, operation.parts)
    if (languageWarning) emit({ kind: 'log', level: 'warn', list, message: languageWarning })
    if (dryRun && csvRouted) {
      log(
        `[dry-run] Would add ${operation.quantity} × ${label} one at a time — the printing is not in the Scryfall cache, so it cannot ride the CSV and was not resolved here.`,
      )
      return true
    }
    // Resolving the printing is a read, so a dry run does it too: an
    // unresolvable printing is the failure a dry run most needs to surface.
    const found = await client.searchCards(
      operation.name,
      operation.parts.set,
      token,
      operation.parts.collectorNumber,
    )
    if (typeof found === 'string') return fail(found)
    if (dryRun) {
      log(`[dry-run] Would add ${operation.quantity} × ${label}.`)
      return true
    }
    try {
      await client.createCollectionRecord(createRecordBody(operation, found.id), token)
    } catch (error: unknown) {
      return fail(`Failed to add ${label}: ${getErrorMessage(error)}`)
    }
    log(`Added ${operation.quantity} × ${label}.`)
    return true
  }

  if (operation.kind === 'update') {
    const grew = operation.delta > 0
    const change = `${Math.abs(operation.delta)} × ${label}`
    if (dryRun) {
      log(`[dry-run] Would ${grew ? 'add' : 'remove'} ${change}.`)
      return true
    }
    try {
      await client.updateCollectionRecord(operation.record.id, updateRecordBody(operation), token)
    } catch (error: unknown) {
      return fail(`Failed to update ${label}: ${getErrorMessage(error)}`)
    }
    log(`${grew ? 'Added' : 'Removed'} ${change}.`)
    return true
  }

  if (dryRun) {
    log(`[dry-run] Would remove ${operation.removed} × ${label}.`)
    return true
  }
  try {
    await client.deleteCollectionRecords(
      operation.records.map((record) => record.id),
      token,
    )
  } catch (error: unknown) {
    return fail(`Failed to remove ${label}: ${getErrorMessage(error)}`)
  }
  log(`Removed ${operation.removed} × ${label}.`)
  return true
}
