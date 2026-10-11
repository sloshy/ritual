/**
 * How a collection sync names the things it is talking about.
 *
 * These strings are produced twice for every run: once by the engine, as the log
 * lines a streaming caller watches, and once by the admin page, replaying a
 * finished report when the stream was never available. They live here — a leaf
 * module with no filesystem or network imports — so both sides say the same
 * thing and the browser bundle can use them.
 */

import type { CardLanguage } from '../card/card-language'
import { describeSyncCard, itemChangeLines, type ItemChangeLine } from '../sync/describe'
import type { SyncDirection } from '../sync/common'
import type { CollectionSyncCardChange, CollectionSyncListResult } from './types'
import { changeKey } from './card-changes'
import { t } from '../i18n/t'
import { currentLocale } from '../i18n/runtime'
import type { LocaleTag } from '../i18n/types'
import {
  prefixedMessage,
  renderSyncParam,
  syncList,
  syncRef,
  syncText,
  type PrefixedMessage,
  type SyncListParam,
  type SyncMessage,
  type SyncMessageRef,
  type SyncParam,
  type SyncText,
} from '../sync/message'
import type { Condition, Finish } from '../card/finish-condition'

/**
 * The five dimensions a local copy and a remote record must agree on to be the
 * same thing. Set codes are lowercase (the internal convention); the collector
 * number keeps the casing of whichever side supplied it, since the key itself
 * compares it case-insensitively. `language` is absent for English (a bare line
 * means `en`), and the key folds the two spellings together.
 */
export type CollectionKeyParts = {
  set: string
  collectorNumber: string
  finish: Finish
  condition: Condition
  language?: CardLanguage
}

/** One list holding copies of a printing, and how many of them it holds. */
export type AmbiguousList = {
  /** The list's name, the identifier lists are addressed by. */
  list: string
  /** How many copies of the printing that list holds. */
  copies: number
}

/**
 * A removal a pull cannot place on its own: only *some* of the printing's copies
 * are going, they are spread across several lists, and nothing in the data says
 * which binder the card physically left. (A removal taking *every* copy is never
 * ambiguous — each list simply loses everything it holds.) Such a removal is
 * placed by an ambiguity-resolution strategy, or the run fails.
 */
export type AmbiguousRemoval = {
  key: string
  parts: CollectionKeyParts
  name: string
  /** How many copies the remote is short by; fewer than the local total. */
  quantity: number
  /** The lists holding copies, with each one's share — the reason the engine cannot choose. */
  lists: AmbiguousList[]
}

/**
 * Who holds the copies, and how many each holds, as a param:
 * `"Blue Binder" (1) and "Long Box" (2)` once rendered. The counts are the whole
 * point — they are what a reader needs to decide which list should give a copy
 * up. Joined with the rendering locale's "and" list pattern (English:
 * `A, B, and C`).
 */
export function ambiguousListsParam(lists: readonly AmbiguousList[]): SyncListParam {
  return syncList(
    lists.map((entry) =>
      syncRef('domain.sync.ambiguousListShare', { list: entry.list, copies: entry.copies }),
    ),
    'and',
  )
}

/**
 * {@link ambiguousListsParam} rendered on its own. `locale` must be the locale
 * of the sentence it lands in: the UI locale for a prompt the user reads, and
 * `DEFAULT_LOCALE` for English text an agent reads.
 */
export function describeAmbiguousLists(
  lists: readonly AmbiguousList[],
  locale: LocaleTag = currentLocale(),
): string {
  return String(renderSyncParam(ambiguousListsParam(lists), locale))
}

/** The warning a pull emits for a removal it cannot place by itself. */
export function describeAmbiguousRemoval(entry: AmbiguousRemoval): SyncMessageRef {
  return syncRef('domain.sync.ambiguousRemoval', {
    quantity: entry.quantity,
    card: describeSyncCard(entry.name, entry.parts),
    lists: ambiguousListsParam(entry.lists),
  })
}

/**
 * One uploaded CSV row Archidekt did not import. `card` names it in English;
 * `cardKey` / `cardParams` ride beside it when it is a row label rather than a
 * card name, for a reader that renders it in its own language.
 */
export type CollectionCsvFailure = PrefixedMessage<'card'> & {
  /**
   * 0-based index among the row results Archidekt reported — not necessarily
   * the plan's row order (the server can report lines the plan never counted),
   * which is why {@link card} is resolved from the response's echo rather than
   * from this number.
   */
  row: number
  /**
   * The card the row was about, spelled the way every other log line spells it
   * — or, for a row Ritual cannot pair with a card, an English label naming the
   * row (`CSV row 3`).
   */
  card: string
  /** Archidekt matched several printings and imported none. */
  ambiguous: boolean
  /** Archidekt matched no printing. */
  notFound: boolean
  /** Whatever Archidekt said about the row; empty when it said nothing. */
  errors: string[]
}

/**
 * `2 not found, 1 ambiguous, 1 rejected` — why an upload dropped rows. Independent
 * counts, so they join with the `unit` list pattern: no "and" before the last.
 */
export function describeCsvFailureReasons(
  failures: readonly CollectionCsvFailure[],
): SyncListParam {
  const notFound = failures.filter((failure) => failure.notFound).length
  const ambiguous = failures.filter((failure) => failure.ambiguous).length
  const rejected = failures.filter(
    (failure) => !failure.notFound && !failure.ambiguous && failure.errors.length > 0,
  ).length
  // Reachable since the server's own `imported: false` verdict became a refusal
  // in its own right: a row can be refused with no flag and no message at all.
  const unexplained = failures.filter(
    (failure) => !failure.notFound && !failure.ambiguous && failure.errors.length === 0,
  ).length
  const parts: SyncParam[] = []
  if (notFound > 0) parts.push(syncRef('domain.sync.csvReasonNotFound', { count: notFound }))
  if (ambiguous > 0) parts.push(syncRef('domain.sync.csvReasonAmbiguous', { count: ambiguous }))
  if (rejected > 0) parts.push(syncRef('domain.sync.csvReasonRejected', { count: rejected }))
  if (unexplained > 0) {
    parts.push(syncRef('domain.sync.csvReasonUnexplained', { count: unexplained }))
  }
  return syncList(parts, 'unit')
}

/**
 * `1 card (1 row)` / `30 cards (28 rows)` — what a CSV covers. Two independent
 * counts, so two messages: one plural form cannot govern both.
 */
export function describeCsvSize(cards: number, rows: number): SyncMessageRef {
  return syncRef('domain.sync.csvSize', {
    cards: syncRef('domain.count.cards', { count: cards }),
    rows: syncRef('domain.count.rows', { count: rows }),
  })
}

/** The card or row label a failed CSV row is reported under, ready to render. */
export function csvFailureCard(failure: CollectionCsvFailure): SyncMessage {
  return prefixedMessage('card', failure) ?? syncText(failure.card)
}

/**
 * Why one failed row was dropped, as a reader needs it: `not found on Archidekt`.
 * Always says something — a row Archidekt refused without a flag or a message is
 * reported as exactly that, rather than as an empty reason every caller then has
 * to guard against.
 */
export function describeCsvFailure(failure: CollectionCsvFailure): SyncParam {
  if (failure.notFound) return syncRef('domain.sync.csvFailureNotFound')
  if (failure.ambiguous) return syncRef('domain.sync.csvFailureAmbiguous')
  // Archidekt's own words, in its own language — data, not catalog text — but
  // joined as independent clauses the way the reader's locale joins them.
  if (failure.errors.length > 0) return syncList([...failure.errors], 'clauses')
  return syncRef('domain.sync.csvFailureUnexplained')
}

/**
 * Where a collection sync's copies land or leave, as its detail lines name it:
 * the list on a pull, the Archidekt collection on a push.
 */
export function collectionChangePlace(direction: SyncDirection, list: string): SyncParam {
  return direction === 'pull' ? list : archidektPlace()
}

/** The Archidekt collection, as a push's detail lines name the place its copies go. */
export function archidektPlace(): SyncMessageRef {
  return syncRef('domain.sync.placeArchidekt')
}

/**
 * The per-card detail line for one collection-sync change, e.g.
 * `+ 2 Sol Ring (C21:240) to Blue Binder` on a pull or
 * `- 1 Island from Archidekt` on a push; `place` comes from
 * {@link collectionChangePlace}.
 */
export function describeCollectionCardChange(
  change: CollectionSyncCardChange,
  place: SyncParam,
): SyncMessageRef {
  const card = describeSyncCard(change.name, change.printing)
  switch (change.kind) {
    case 'added':
      return syncRef('domain.sync.detailAdded', { quantity: change.quantity, card, place })
    case 'removed':
      return syncRef('domain.sync.detailRemoved', { quantity: change.quantity, card, place })
    case 'pending':
      return syncRef('domain.sync.detailPending', { quantity: change.quantity, card })
    default: {
      const unhandled: never = change
      throw new Error(t('domain.sync.unhandledCardChange', { change: JSON.stringify(unhandled) }))
    }
  }
}

/** What a collection sync's `Changes:` line counts: copies by kind of change. */
export type CollectionChangeCounts = {
  added: number
  removed: number
  pending: number
}

/** Total a list's card changes by kind, in copies. */
export function collectionChangeCounts(
  changes: readonly CollectionSyncCardChange[],
): CollectionChangeCounts {
  const copies = (kind: CollectionSyncCardChange['kind']): number =>
    changes
      .filter((change) => change.kind === kind)
      .reduce((total, change) => total + change.quantity, 0)
  return { added: copies('added'), removed: copies('removed'), pending: copies('pending') }
}

/**
 * A list's change counts as the run log states them: `+2 added, -1 removed`,
 * with a pending clause when a push wrote copies to its CSV file.
 */
export function describeCollectionChangeSummary(counts: CollectionChangeCounts): SyncParam {
  // The pending clause carries its own leading separator in the catalog.
  const clauses: SyncParam[] = [
    syncRef('domain.sync.collectionCounts', { added: counts.added, removed: counts.removed }),
  ]
  if (counts.pending > 0) {
    clauses.push(
      syncRef('domain.sync.collectionPendingClause', {
        copies: syncRef('domain.count.copies', { count: counts.pending }),
      }),
    )
  }
  return syncList(clauses, 'concat')
}

/** The `Changes: …` line a collection sync logs for a list with changes. */
export function describeCollectionChangesLine(counts: CollectionChangeCounts): SyncMessageRef {
  return syncRef('domain.sync.changesLine', { summary: describeCollectionChangeSummary(counts) })
}

/**
 * Whether a change went through a push's CSV — an import or a `--csv-file`.
 * The CSV runs before any list's turn, so its cards are listed under the run
 * rather than under each list (they still count in each list's `Changes:`).
 */
export function isCsvRouted(change: CollectionSyncCardChange): boolean {
  return change.kind === 'pending' || (change.kind === 'added' && change.via === 'csv')
}

/**
 * A list's change lines: its `Changes:` count, then a detail line per card
 * that did not go through the CSV. Empty for a list with no changes.
 */
export function collectionListLines(
  changes: readonly CollectionSyncCardChange[],
  place: SyncParam,
  describe: (
    change: CollectionSyncCardChange,
    place: SyncParam,
  ) => SyncText = describeCollectionCardChange,
): ItemChangeLine[] {
  if (changes.length === 0) return []
  return itemChangeLines(
    describeCollectionChangesLine(collectionChangeCounts(changes)),
    changes.filter((change) => !isCsvRouted(change)).map((change) => describe(change, place)),
  )
}

/**
 * The run-level detail lines a finished push report implies: the cards its CSV
 * imported or wrote (once each, though every list holding one lists it), then
 * the records it deleted for cards no list holds — the lines the stream logs
 * under the run rather than under a list.
 */
export function collectionRunLines(
  lists: readonly Pick<CollectionSyncListResult, 'changes'>[],
  unlisted: readonly CollectionSyncCardChange[],
  describe: (
    change: CollectionSyncCardChange,
    place: SyncParam,
  ) => SyncText = describeCollectionCardChange,
): ItemChangeLine[] {
  // Every list holding a CSV card lists it; the run says it once, in the
  // order the lists (scope order) first name it — the order the CSV ran in.
  const csv = new Map<string, CollectionSyncCardChange>()
  for (const change of lists.flatMap((list) => list.changes ?? [])) {
    if (isCsvRouted(change) && !csv.has(changeKey(change))) csv.set(changeKey(change), change)
  }
  return itemChangeLines(
    undefined,
    [...csv.values(), ...unlisted].map((change) => describe(change, archidektPlace())),
  )
}
