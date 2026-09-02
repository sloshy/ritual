/**
 * @fileoverview The collection-sync engine's vocabulary: the public option,
 * event and report types every surface consumes (re-exported through
 * `engine.ts`), plus the per-list bookkeeping and the {@link SyncFlow} bag the
 * pull and push halves share. Browser-safe — no node imports.
 */

import type { ArchidektClient } from '../clients/ArchidektClient'
import type {
  ConfirmUnreadable,
  SyncChangeFilter,
  SyncDirection,
  SyncEvent,
  SyncEventHandler,
  SyncItemStatus,
  SyncLogLevel,
  UnreadableSource,
} from '../sync/common'
import { syncCancellationLog, SYNC_CANCELLED_REASON } from '../sync/common'
import type { ScryfallCard } from '../scryfall/types'
import type { CardPrintingsLookup } from '../card/card-printing'
import type { AmbiguousRemoval, CollectionCsvFailure } from './describe'
import type { RemovalAssignment } from './diff'
import type { CsvFileWriter } from './csv'
import type { CollectionListStore } from './store'
import type { CollectionSyncStateStore } from './state'

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

/** One step of a run — the shared {@link SyncEvent}, carrying collection list results. */
export type CollectionSyncEvent = SyncEvent<CollectionSyncListResult>

export type CollectionSyncEventHandler = SyncEventHandler<CollectionSyncListResult>

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
export type CollectionSyncCsvCounts = {
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
   * `runCollectionSync`).
   */
  localIncomplete: boolean
  /**
   * What the CSV bulk-import path did with a push's additions, or `null` when the
   * run did not take it (a pull, or a push whose additions were few enough to add
   * one at a time). See {@link CollectionSyncCsv}.
   */
  csv: CollectionSyncCsv | null
  totals: CollectionSyncTotals
  /**
   * True when the caller cancelled the run before every list had started. The
   * lists it never reached are in {@link lists} as `skipped`; the ones it had
   * finished are reported exactly as an uncancelled run would report them, and
   * no sync timestamp was recorded.
   */
  cancelled: boolean
  /**
   * True when a pull stopped because its {@link ambiguous} removals could not
   * be placed — no strategy was given, the priority could not cover them, or
   * the resolver declined. Nothing was written. The fix is a rerun that carries
   * a decision: `removalPriority`, or explicit per-removal assignments. This is
   * the flag a client that can ask the user branches on, rather than parsing
   * {@link errors}.
   */
  unresolvedAmbiguity: boolean
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
  /**
   * Cancel the run. Honoured at list boundaries only — and, on a pull, before
   * the remote collection is fetched: the list in flight finishes, every list
   * after it is reported `skipped` with `SYNC_CANCELLED_REASON`, and the
   * report's `cancelled` flag is set. A cancelled run records no sync
   * timestamp: the lists and the account did not agree when it stopped.
   */
  signal?: AbortSignal
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
export type MutableListResult = {
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
export type ListResults = {
  track(name: string): MutableListResult
  fail(name: string, reason: string): void
  /** Mark a list stepped over — cancelled before it started, say — without failing it. */
  skip(name: string, reason: string): void
  /** Emit a list's result and return it; later calls return the same result. */
  finish(name: string, reason?: string): CollectionSyncListResult
  /** Every tracked list's result, finishing any the run left open. */
  all(): CollectionSyncListResult[]
}

export function createListResults(emit: CollectionSyncEventHandler): ListResults {
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
    emit({ kind: 'item-result', result })
    return result
  }

  return {
    track,
    fail(name: string, reason: string): void {
      const entry = track(name)
      entry.status = 'failed'
      entry.reasons.push(reason)
    },
    skip(name: string, reason: string): void {
      const entry = track(name)
      entry.status = 'skipped'
      entry.reasons.push(reason)
    },
    finish,
    all(): CollectionSyncListResult[] {
      return [...tracked.keys()].map((name) => finish(name))
    },
  }
}

/**
 * Report every list in `names` as skipped because the run was cancelled before
 * that list started — the shared tail of every cancellation point, so a
 * cancelled run always leaves the same trace: one run-level warning, then one
 * skipped result per list it never reached.
 */
export function markCancelled(
  names: readonly string[],
  emit: CollectionSyncEventHandler,
  results: ListResults,
): void {
  emit(syncCancellationLog('collection', names.length))
  for (const name of names) {
    results.skip(name, SYNC_CANCELLED_REASON)
    results.finish(name)
  }
}

// ── Run ───────────────────────────────────────────────────────────────

/** Everything both flows need beyond the indexes they were handed. */
export type SyncFlow = {
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
  /** See {@link CollectionSyncOptions.signal}. */
  signal: AbortSignal | undefined
}

/** What one direction's flow produced beyond its per-list results. */
export type FlowOutcome = {
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
  /** True when the caller cancelled the flow between lists; see the report field. */
  cancelled: boolean
  /** True when the flow stopped on ambiguous removals nobody placed; see the report field. */
  unresolvedAmbiguity: boolean
}

/**
 * The outcome of a flow that stopped before applying anything: nothing
 * written, the errors that stopped it, and any ambiguity it had found by then.
 * `unresolvedAmbiguity` says the ambiguity is *why* it stopped.
 */
export function abortedOutcome(
  errors: string[],
  ambiguous: AmbiguousRemoval[] = [],
  unresolvedAmbiguity = false,
): FlowOutcome {
  return {
    writtenFiles: [],
    errors,
    ambiguous,
    csv: null,
    totals: NO_CHANGES,
    aborted: true,
    cancelled: false,
    unresolvedAmbiguity,
  }
}

export const NO_CHANGES: CollectionSyncTotals = { added: 0, removed: 0, skipped: 0, pending: 0 }
