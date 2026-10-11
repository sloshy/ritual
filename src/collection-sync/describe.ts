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
 * Who holds the copies, and how many each holds:
 * `"Blue Binder" (1) and "Long Box" (2)`. The counts are the whole point — they
 * are what a reader needs to decide which list should give a copy up.
 */
export function describeAmbiguousLists(lists: readonly AmbiguousList[]): string {
  const held = lists.map((entry) => `"${entry.list}" (${entry.copies})`)
  if (held.length < 2) return held.join('')
  return `${held.slice(0, -1).join(', ')} and ${held.at(-1)}`
}

/** The warning a pull emits for a removal it cannot place by itself. */
export function describeAmbiguousRemoval(entry: AmbiguousRemoval): string {
  const card = describeSyncCard(entry.name, entry.parts)
  return `Not removing ${entry.quantity} × ${card}: ambiguous — copies live in ${describeAmbiguousLists(entry.lists)}.`
}

/** One uploaded CSV row Archidekt did not import. */
export type CollectionCsvFailure = {
  /**
   * 0-based index among the row results Archidekt reported — not necessarily
   * the plan's row order (the server can report lines the plan never counted),
   * which is why {@link card} is resolved from the response's echo rather than
   * from this number.
   */
  row: number
  /** The card the row was about, spelled the way every other log line spells it. */
  card: string
  /** Archidekt matched several printings and imported none. */
  ambiguous: boolean
  /** Archidekt matched no printing. */
  notFound: boolean
  /** Whatever Archidekt said about the row; empty when it said nothing. */
  errors: string[]
}

/** `2 not found, 1 ambiguous, 1 rejected` — why an upload dropped rows. */
export function describeCsvFailureReasons(failures: readonly CollectionCsvFailure[]): string {
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
  const parts: string[] = []
  if (notFound > 0) parts.push(`${notFound} not found`)
  if (ambiguous > 0) parts.push(`${ambiguous} ambiguous`)
  if (rejected > 0) parts.push(`${rejected} rejected`)
  if (unexplained > 0) parts.push(`${unexplained} refused without a reason`)
  return parts.join(', ')
}

/**
 * `1 card (1 row)` / `30 cards (28 rows)` — what a CSV covers. Two independent
 * counts, so two messages: one plural form cannot govern both.
 */
export function describeCsvSize(cards: number, rows: number): string {
  return `${t('domain.count.cards', { count: cards })} (${t('domain.count.rows', { count: rows })})`
}

/**
 * Why one failed row was dropped, as a reader needs it: `not found on Archidekt`.
 * Always says something — a row Archidekt refused without a flag or a message is
 * reported as exactly that, rather than as an empty reason every caller then has
 * to guard against.
 */
export function describeCsvFailure(failure: CollectionCsvFailure): string {
  if (failure.notFound) return 'not found on Archidekt'
  if (failure.ambiguous) return 'matched more than one printing'
  if (failure.errors.length > 0) return failure.errors.join('; ')
  return 'Archidekt gave no reason'
}

/**
 * Where a collection sync's copies land or leave, as its detail lines name it:
 * the list on a pull, the Archidekt collection on a push.
 */
export function collectionChangePlace(direction: SyncDirection, list: string): string {
  return direction === 'pull' ? list : archidektPlace()
}

/** The Archidekt collection, as a push's detail lines name the place its copies go. */
export function archidektPlace(): string {
  return t('domain.sync.placeArchidekt')
}

/**
 * The per-card detail line for one collection-sync change, e.g.
 * `+ 2 Sol Ring (C21:240) to Blue Binder` on a pull or
 * `- 1 Island from Archidekt` on a push; `place` comes from
 * {@link collectionChangePlace}.
 */
export function describeCollectionCardChange(
  change: CollectionSyncCardChange,
  place: string,
): string {
  const card = describeSyncCard(change.name, change.printing)
  switch (change.kind) {
    case 'added':
      return t('domain.sync.detailAdded', { quantity: change.quantity, card, place })
    case 'removed':
      return t('domain.sync.detailRemoved', { quantity: change.quantity, card, place })
    case 'pending':
      return t('domain.sync.detailPending', { quantity: change.quantity, card })
    default: {
      const unhandled: never = change
      throw new Error(`Unhandled card change: ${JSON.stringify(unhandled)}`)
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
export function describeCollectionChangeSummary(counts: CollectionChangeCounts): string {
  const pending =
    counts.pending > 0
      ? t('domain.sync.collectionPendingClause', {
          copies: t('domain.count.copies', { count: counts.pending }),
        })
      : ''
  return `${t('domain.sync.collectionCounts', { added: counts.added, removed: counts.removed })}${pending}`
}

/** The `Changes: …` line a collection sync logs for a list with changes. */
export function describeCollectionChangesLine(counts: CollectionChangeCounts): string {
  return t('domain.sync.changesLine', { summary: describeCollectionChangeSummary(counts) })
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
  place: string,
  describe: (
    change: CollectionSyncCardChange,
    place: string,
  ) => string = describeCollectionCardChange,
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
    place: string,
  ) => string = describeCollectionCardChange,
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
