import { describe, expect, test } from 'bun:test'
import { apiMessage, renderApiMessage, type ApiMessage } from '../../../src/api/result'
import { loadDictionary, resetI18nRuntime } from '../../../src/i18n/runtime'
import { tDynamic, type TranslateDynamicFn } from '../../../src/i18n/t'
import type { LocaleCatalog, LocaleTag } from '../../../src/i18n/types'
import { localeTag } from '../../../src/i18n/locale-tag'

/**
 * The widened API response shape (plan §7.7): `message` is rendered English —
 * byte for byte what MCP and scripts already read — and the key/params pair
 * beside it is what lets a client re-render the same sentence in the reader's
 * language.
 *
 * Everything here is pinned at the lowest layer that can express it: the
 * builder and the renderer themselves, against synthetic catalogs. The handlers
 * that emit these results are covered by their own integration tests, and the
 * schemas that advertise them by `test/unit/mcp/output-schemas.test.ts`. The
 * sync-run summaries, which build the same shape a clause at a time, live in
 * `test/unit/admin/sync-summary.test.ts`.
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
