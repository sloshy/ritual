import { describe, expect, test } from 'bun:test'
import { apiMessage, renderApiMessage, type ApiMessage } from '../../src/admin/api/result'
import {
  renderSyncSummary,
  renderSyncSummaryEnglish,
  type SyncSummary,
} from '../../src/admin/api/sync-summary'
import { summarizeRun as summarizeDeckRun } from '../../src/admin/api/deck-sync'
import { summarizeRun as summarizeCollectionRun } from '../../src/admin/api/collection-sync'
import type { DeckSyncReport } from '../../src/deck-sync/engine'
import type { CollectionSyncReport } from '../../src/collection-sync/engine'
import { loadDictionary, resetI18nRuntime } from '../../src/i18n/runtime'
import { tDynamic, type TranslateDynamicFn } from '../../src/i18n/t'
import type { LocaleCatalog, LocaleTag } from '../../src/i18n/types'
import { localeTag } from '../../src/i18n/locale-tag'

/**
 * The widened admin response shape (plan §7.7): `message` is rendered English —
 * byte for byte what MCP and scripts already read — and the key/params pair
 * beside it is what lets a client re-render the same sentence in the reader's
 * language.
 *
 * Everything here is pinned at the lowest layer that can express it: the
 * builders and renderers themselves, against synthetic catalogs. The handlers
 * that emit these results are covered by their own integration tests, and the
 * schemas that advertise them by `test/unit/mcp/output-schemas.test.ts`.
 */

/** A translator bound to one locale, standing in for a component's `useTDynamic()`. */
function translatorFor(locale: LocaleTag): TranslateDynamicFn {
  return (key, params) => tDynamic(locale, key, params)
}

/** Register a synthetic dictionary, so no shipped translation is under test. */
function withDictionary(tag: LocaleTag, catalog: LocaleCatalog): void {
  resetI18nRuntime()
  loadDictionary(tag, catalog)
}

describe('apiMessage', () => {
  test('renders English and carries the key it rendered from', () => {
    const result = apiMessage('admin.api.buildSite.built')
    expect(result).toEqual({
      message: 'Site built successfully',
      messageKey: 'admin.api.buildSite.built',
    })
  })

  test('carries the parameters a keyed message interpolates', () => {
    expect(apiMessage('admin.api.list.created', { listType: 'wanted', name: 'Trades' })).toEqual({
      message: "Created wanted list 'Trades'",
      messageKey: 'admin.api.list.created',
      messageParams: { listType: 'wanted', name: 'Trades' },
    })
  })

  test('renders English even when another locale is active', () => {
    // The point of the split: an operator running a German UI must not make the
    // API answer an agent in German.
    withDictionary(localeTag('xx'), { 'admin.api.buildSite.built': 'Baustelle' })
    try {
      expect(apiMessage('admin.api.buildSite.built').message).toBe('Site built successfully')
    } finally {
      resetI18nRuntime()
    }
  })
})

describe('renderApiMessage', () => {
  test('prefers the key over the server-rendered English', () => {
    withDictionary(localeTag('xx'), { 'admin.api.cache.refreshed': 'Katalog erneuert' })
    try {
      const result = apiMessage('admin.api.cache.refreshed')
      expect(renderApiMessage(translatorFor(localeTag('xx')), result)).toBe('Katalog erneuert')
    } finally {
      resetI18nRuntime()
    }
  })

  test('interpolates the parameters that rode along', () => {
    withDictionary(localeTag('xx'), { 'admin.api.list.deleted': '{name} ({listType}) weg' })
    try {
      const result = apiMessage('admin.api.list.deleted', { listType: 'deck', name: 'Burn' })
      expect(renderApiMessage(translatorFor(localeTag('xx')), result)).toBe('Burn (deck) weg')
    } finally {
      resetI18nRuntime()
    }
  })

  test('falls back to English prose for a response that carries no key', () => {
    // The incremental-conversion path: an unconverted handler sends English
    // only, and it must still render rather than rendering nothing.
    const unkeyed: ApiMessage = { message: 'decks must be an array of strings' }
    expect(renderApiMessage(translatorFor(localeTag('xx')), unkeyed)).toBe(
      'decks must be an array of strings',
    )
  })
})

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
    withDictionary(localeTag('xx'), {
      'admin.api.deckSync.pulled': { $plural: 'count', other: 'Gezogen: {count}' },
      'admin.api.deckSync.failed': 'Fehlgeschlagen: {count}',
    })
    try {
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
      expect(renderSyncSummary(translatorFor(localeTag('xx')), localized, localeTag('xx'))).toBe(
        'Gezogen: 2, Fehlgeschlagen: 1.',
      )
    } finally {
      resetI18nRuntime()
    }
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
        { name: 'Burn', status: 'synced' },
        { name: 'Elves', status: 'skipped' },
        { name: 'Storm', status: 'failed' },
      ],
      failedCount: 1,
      unreadable: [],
    }
  }

  function collectionReport(): CollectionSyncReport {
    return {
      direction: 'pull',
      into: 'Inbox',
      dryRun: false,
      lists: [{ name: 'Binder', status: 'synced', added: 2, removed: 1, pending: 0 }],
      failedCount: 0,
      errors: ['Archidekt returned 500'],
      unreadable: [],
      ambiguous: [],
      localIncomplete: false,
      csv: null,
      totals: { added: 2, removed: 1, skipped: 0, pending: 0 },
    }
  }

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
