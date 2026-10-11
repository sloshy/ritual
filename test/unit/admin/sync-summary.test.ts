import { describe, expect, test } from 'bun:test'
import {
  renderSyncSummary,
  renderSyncSummaryEnglish,
  type SyncSummary,
} from '../../../src/admin/api/sync-summary'
import { summarizeRun as summarizeDeckRun } from '../../../src/admin/api/deck-sync'
import { summarizeRun as summarizeCollectionRun } from '../../../src/admin/api/collection-sync'
import type { DeckSyncReport } from '../../../src/deck-sync/engine'
import type { CollectionSyncReport } from '../../../src/collection-sync/engine'
import { tDynamic, type TranslateDynamicFn } from '../../../src/i18n/t'
import type { LocaleTag } from '../../../src/i18n/types'
import { withSyntheticLocale } from '../../helpers/sync-text'

/** The English reason a cancelled item carries, pinned once. */
const CANCELLED = 'cancelled before it started'

/**
 * A sync run's summary has no single catalog key — it is a list of clauses — so
 * it is built structured and rendered twice: once in English for the wire, once
 * in the reader's locale by a client that has a translator.
 *
 * The producers and the renderer are pinned here, against synthetic catalogs.
 * The routes that emit these summaries are covered by their own integration
 * tests, and the schema that advertises the shape by
 * `test/unit/mcp/output-schemas.test.ts`.
 */

/** A translator bound to one locale, standing in for a component's `useTDynamic()`. */
function translatorFor(locale: LocaleTag): TranslateDynamicFn {
  return (key, params) => tDynamic(locale, key, params)
}

describe('renderSyncSummary', () => {
  const summary: SyncSummary = {
    clauses: [
      { message: 'Pulled 2 decks', messageKey: 'admin.api.deckSync.pulled' },
      { message: '1 failed', messageKey: 'admin.api.deckSync.failed' },
    ],
  }

  test('joins clauses and terminates the sentence in English', () => {
    expect(renderSyncSummaryEnglish(summary)).toBe('Pulled 2 decks, 1 failed.')
  })

  test('re-renders every clause in the reader locale', () => {
    // A synthetic dictionary, so no shipped translation is under test.
    withSyntheticLocale(
      'xx',
      {
        'admin.api.deckSync.pulled': { $plural: 'count', other: 'Gezogen: {count}' },
        'admin.api.deckSync.failed': 'Fehlgeschlagen: {count}',
      },
      (xx) => {
        const localized: SyncSummary = {
          clauses: [
            {
              message: 'Pulled 2 decks',
              messageKey: 'admin.api.deckSync.pulled',
              messageParams: { count: 2 },
            },
            {
              message: '1 failed',
              messageKey: 'admin.api.deckSync.failed',
              messageParams: { count: 1 },
            },
          ],
        }
        expect(renderSyncSummary(translatorFor(xx), localized, xx)).toBe(
          'Gezogen: 2, Fehlgeschlagen: 1.',
        )
      },
    )
  })

  test('a one-clause summary gets no separator', () => {
    expect(renderSyncSummaryEnglish({ clauses: [summary.clauses[0]!] })).toBe('Pulled 2 decks.')
  })
})

describe('summarizeRun', () => {
  /**
   * The structured producers are what `describeRun` renders, so the assertions
   * that matter here are the ones `describeRun`'s own English tests cannot make:
   * that every clause carries a key, and that none carries the terminator the
   * renderer adds.
   */
  function deckReport(): DeckSyncReport {
    return {
      direction: 'pull',
      decks: [
        { name: 'Burn', status: 'synced', outcome: 'changed' },
        { name: 'Elves', status: 'skipped' },
        { name: 'Storm', status: 'failed' },
      ],
      failedCount: 1,
      unreadable: [],
      cancelled: false,
    }
  }

  function collectionReport(): CollectionSyncReport {
    return {
      direction: 'pull',
      into: 'Inbox',
      dryRun: false,
      lists: [
        { name: 'Binder', status: 'synced', outcome: 'changed', added: 2, removed: 1, pending: 0 },
      ],
      failedCount: 0,
      errors: ['Archidekt returned 500'],
      errorMessages: [{ message: 'Archidekt returned 500' }],
      unreadable: [],
      cancelled: false,
      unresolvedAmbiguity: false,
      ambiguous: [],
      localIncomplete: false,
      csv: null,
      totals: { added: 2, removed: 1, skipped: 0, pending: 0 },
    }
  }

  test('a cancelled deck run says how many decks never started, apart from ordinary skips', () => {
    const report: DeckSyncReport = {
      ...deckReport(),
      decks: [
        { name: 'Burn', status: 'synced', outcome: 'changed' },
        { name: 'Elves', status: 'skipped', reason: 'you do not own Archidekt deck 1' },
        { name: 'Storm', status: 'skipped', outcome: 'cancelled', reason: CANCELLED },
        { name: 'Tron', status: 'skipped', outcome: 'cancelled', reason: CANCELLED },
      ],
      failedCount: 0,
      cancelled: true,
    }
    const summary = summarizeDeckRun(report, false)
    expect(summary.clauses.map((clause) => clause.messageKey)).toEqual([
      'admin.api.deckSync.pulled',
      'admin.api.deckSync.skipped',
      'admin.api.deckSync.cancelled',
    ])
    expect(renderSyncSummaryEnglish(summary)).toBe(
      'Pulled 1 deck, 1 skipped, cancelled with 2 decks not started.',
    )
  })

  test('a cancelled collection run ends on the lists it never started', () => {
    const report: CollectionSyncReport = {
      ...collectionReport(),
      lists: [
        { name: 'Binder', status: 'synced', outcome: 'changed', added: 2, removed: 1, pending: 0 },
        {
          name: 'Long Box',
          status: 'skipped',
          outcome: 'cancelled',
          reason: CANCELLED,
          added: 0,
          removed: 0,
          pending: 0,
        },
      ],
      errors: [],
      errorMessages: [],
      cancelled: true,
    }
    const summary = summarizeCollectionRun(report)
    expect(summary.clauses.map((clause) => clause.messageKey)).toEqual([
      'admin.api.collectionSync.totalsInto',
      'admin.api.collectionSync.cancelled',
    ])
    expect(renderSyncSummaryEnglish(summary)).toBe(
      'Pulled +2 added, -1 removed into "Inbox", cancelled with 1 list not started.',
    )
  })

  test('a deck run yields one keyed clause per fact, none terminated', () => {
    const summary = summarizeDeckRun(deckReport(), false)
    expect(summary.clauses.map((clause) => clause.messageKey)).toEqual([
      'admin.api.deckSync.pulled',
      'admin.api.deckSync.skipped',
      'admin.api.deckSync.failed',
    ])
    for (const clause of summary.clauses) expect(clause.message.endsWith('.')).toBe(false)
    expect(renderSyncSummaryEnglish(summary)).toBe('Pulled 1 deck, 1 skipped, 1 failed.')
  })

  test('a dry run swaps the verb key rather than splicing a verb in', () => {
    expect(summarizeDeckRun(deckReport(), true).clauses[0]?.messageKey).toBe(
      'admin.api.deckSync.previewed',
    )
  })

  test('a collection pull that added cards names its destination in one clause', () => {
    const summary = summarizeCollectionRun(collectionReport())
    expect(summary.clauses[0]).toEqual({
      message: 'Pulled +2 added, -1 removed into "Inbox"',
      messageKey: 'admin.api.collectionSync.totalsInto',
      messageParams: { action: 'pulled', added: 2, removed: 1, into: 'Inbox' },
    })
    expect(summary.clauses.at(-1)?.messageKey).toBe('admin.api.collectionSync.errors')
  })

  test('a push has no destination clause variant', () => {
    const report: CollectionSyncReport = { ...collectionReport(), direction: 'push', into: null }
    expect(summarizeCollectionRun(report).clauses[0]?.messageKey).toBe(
      'admin.api.collectionSync.totals',
    )
  })
})
