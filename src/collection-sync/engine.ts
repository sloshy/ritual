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
import { getErrorMessage } from '../util/errors'
import { t } from '../i18n/t'
import type { ArchidektCollectionRecord } from '../importers/archidekt-collection'
import { formatResolveListError } from '../list/resolve-list'
import { scryfallIdIndex } from '../cache/scryfall-id-index'
import { getCachedCardPrintings } from '../scryfall'
import { formatElapsed } from '../util/duration'
import { buildLocalIndex, buildRemoteIndex } from './diff'
import { writeCsvFile } from './csv'
import {
  createDiskCollectionListStore,
  isResolveFailure,
  type CollectionListStore,
  type LoadedCollectionList,
} from './store'
import { createFileCollectionSyncStateStore } from './state'
import {
  type UnreadableList,
  type ConfirmUnreadableLists,
  type CollectionSyncEventHandler,
  type CollectionSyncOptions,
  type CollectionSyncRun,
  type ListResults,
  createListResults,
  type SyncFlow,
  type FlowOutcome,
  abortedOutcome,
} from './types'
import { pullFromArchidekt, validatePullDestinations } from './pull'
import { pushToArchidekt } from './push'

export type {
  CollectionSyncStatus,
  CollectionSyncListResult,
  UnreadableList,
  ConfirmUnreadableLists,
  CollectionSyncLogLevel,
  CollectionSyncEvent,
  CollectionSyncEventHandler,
  CollectionSyncTotals,
  CollectionSyncCsvStatus,
  CollectionSyncCsvCounts,
  CollectionSyncCsv,
  CollectionSyncReport,
  ScryfallIdLookup,
  AmbiguityResolutionOutcome,
  ResolveAmbiguousRemovals,
  CsvUploadQuestion,
  CsvUploadDecision,
  DecideCsvUpload,
  CsvCacheRequest,
  EnsureCsvCache,
  CollectionSyncOptions,
  CollectionSyncRun,
} from './types'

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
      emit({ kind: 'log', level: 'warn', item: null, message }),
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

  const empty = (errors: string[]): FlowOutcome => abortedOutcome(errors)

  /**
   * A run-level progress line. Every phase below announces itself before it
   * starts and says what it cost when it ends: reading the lists, loading the
   * card cache to key them by, and paging in the remote collection each take
   * long enough that silence reads as a hang.
   */
  const progress = (message: string): void => {
    emit({ kind: 'log', level: 'info', item: null, message })
  }

  // 1. Scope: the named lists, or every collection list.
  progress(t('domain.sync.readingLists'))
  const scoped = await resolveScope(options.lists ?? [], store, emit, results)

  // 2. Load them, holding back any whose lines the parser could not read.
  const loaded = await loadLists(scoped, store, emit, results, options.confirmUnreadable, dryRun)
  // The tally covers the lists that made it into the comparison, so it is short
  // by any list held back or unreadable — which is exactly what the run goes on
  // to treat as the local truth.
  const entryCount = loaded.lists.reduce((total, list) => total + list.entries.length, 0)
  progress(
    t('domain.sync.listsRead', {
      lists: t('domain.count.collectionLists', { count: loaded.lists.length }),
      entries: t('domain.count.cardEntries', { count: entryCount }),
      elapsed: formatElapsed(loaded.readElapsedMs),
    }),
  )

  if (loaded.lists.length === 0) {
    // A push with nothing readable locally would read as "the collection is
    // empty" and delete the account's records, so it is refused outright. A
    // pull is fine — an empty local side is how a first pull starts.
    if (direction === 'push') {
      const reason =
        'No readable collection lists to push. Refusing to treat that as an empty collection.'
      emit({ kind: 'log', level: 'error', item: null, message: reason })
      return report(empty([reason]), loaded)
    }
    emit({ kind: 'log', level: 'info', item: null, message: 'No collection lists to sync from.' })
  }

  // 3. Index both sides. The first printings lookup loads the whole card cache
  //    off disk, which is the longest unexplained pause a run used to have —
  //    but only when there is a line to look up, so an empty local side does not
  //    narrate work it never does.
  if (entryCount > 0) {
    progress(
      t('domain.sync.indexingLocal', {
        entries: t('domain.count.cardEntries', { count: entryCount }),
      }),
    )
  }
  const indexingStartedAt = Date.now()
  const local = await buildLocalIndex(loaded.lists, lookupPrintings)
  if (entryCount > 0) {
    progress(
      t('domain.sync.localIndexed', {
        printings: t('domain.count.printings', { count: local.index.size }),
        elapsed: formatElapsed(Date.now() - indexingStartedAt),
      }),
    )
  }
  for (const warning of local.warnings) {
    emit({ kind: 'log', level: 'warn', item: warning.list, message: warning.message })
  }

  // Destination names are validated before the remote fetch: they are local
  // facts, and a typo must fail in milliseconds rather than after paging in an
  // entire Archidekt collection. Only a pull has destinations to validate — a
  // push ignores both flags (the command warns about them).
  if (direction === 'pull') {
    const invalid = await validatePullDestinations(store, into, options.removalPriority ?? [])
    if (invalid !== null) {
      emit({ kind: 'log', level: 'error', item: null, message: invalid })
      return report(empty([invalid]), loaded)
    }
  }

  progress(t('domain.sync.fetchingCollection'))
  const fetchStartedAt = Date.now()
  const fetched = await fetchCollection(client, userId, token, (fetchedPage) => {
    progress(
      t('domain.sync.fetchedPage', {
        page: fetchedPage.page,
        totalPages: fetchedPage.totalPages,
        records: t('domain.count.collectionRecords', { count: fetchedPage.recordsSoFar }),
      }),
    )
  })
  if (typeof fetched === 'string') {
    emit({ kind: 'log', level: 'error', item: null, message: fetched })
    // Nothing can be compared without the remote side; every in-scope list is
    // unsynced rather than unchanged.
    for (const list of loaded.lists) results.fail(list.name, fetched)
    return report(empty([fetched]), loaded)
  }

  const remote = buildRemoteIndex(fetched.records)
  for (const warning of remote.warnings) {
    emit({ kind: 'log', level: 'warn', item: null, message: warning })
  }
  progress(
    t('domain.sync.collectionFetched', {
      records: t('domain.count.collectionRecords', { count: fetched.records.length }),
      printings: t('domain.count.printings', { count: remote.index.size }),
      elapsed: formatElapsed(Date.now() - fetchStartedAt),
    }),
  )
  progress(t('domain.sync.comparing'))

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
        item: null,
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
      emit({ kind: 'log', level: 'error', item: null, message })
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
  /**
   * How long reading the files took. Measured around the reads alone, so the
   * unreadable-lines confirmation — a human deciding, for as long as they like —
   * never lands in a figure the user reads as "this phase was slow".
   */
  readElapsedMs: number
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
  const startedAt = Date.now()

  for (const name of scope.names) {
    const loaded = await store.load(name)
    if (typeof loaded === 'string') {
      const reason = `Could not read collection list "${name}": ${loaded}`
      emit({ kind: 'log', level: 'error', item: null, message: reason })
      results.fail(name, reason)
      results.finish(name)
      complete = false
      continue
    }
    // Advisories are about lines that parsed: they are reported for every list,
    // whether or not the list is held back for unreadable lines, and never
    // decide anything.
    for (const advisory of loaded.advisories) {
      emit({ kind: 'log', level: 'warn', item: loaded.name, message: advisory })
    }
    if (loaded.warnings.length > 0) held.push(loaded)
    else lists.push(loaded)
  }

  // Stopped before the confirmation gate below, which waits on a person.
  const readElapsedMs = Date.now() - startedAt

  if (held.length === 0) return { lists, unreadable: [], complete, readElapsedMs }

  const unreadable: UnreadableList[] = held.map((list) => ({
    name: list.name,
    file: list.file,
    warnings: list.warnings,
  }))
  emit({ kind: 'unreadable-lines', items: unreadable })

  let accepted = dryRun
  if (!accepted && confirmUnreadable) {
    try {
      accepted = await confirmUnreadable(unreadable)
    } catch (error: unknown) {
      // A handler that throws is a decision that was never made — refuse.
      emit({
        kind: 'log',
        level: 'error',
        item: null,
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
    emit({ kind: 'log', level: 'warn', item: null, message: `${list.file}: ${reason}` })
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
      item: null,
      message:
        'This preview includes the lists above; a real run holds them back until their unreadable lines are accepted.',
    })
  }

  return { lists, unreadable, complete, readElapsedMs }
}

// ── Remote fetch ──────────────────────────────────────────────────────

/** The whole remote collection, plus who it belongs to. */
type FetchedCollection = {
  records: ArchidektCollectionRecord[]
  username: string
}

/** One page of the collection, as it lands — the fetch's only sign of life. */
type CollectionPageProgress = {
  /** The page just fetched, 1-based. */
  page: number
  /** How many pages the account's collection has, as the response reports it. */
  totalPages: number
  /** The running total across every page so far, this one included. */
  recordsSoFar: number
}

/**
 * Page through the account's collection, following `next` until it runs out,
 * reporting each page through `onPage`: the requests are paced seconds apart, so
 * a large collection spends minutes here and has to be seen to be advancing.
 *
 * `totalPages` is a backstop: a response that keeps advertising a next page can
 * not spin the run forever. Returns the message explaining a failed fetch
 * rather than throwing — the run reports it against every in-scope list.
 */
async function fetchCollection(
  client: ArchidektClient,
  userId: number,
  token: string,
  onPage: (progress: CollectionPageProgress) => void,
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
      onPage({ page, totalPages: response.totalPages, recordsSoFar: records.length })
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
