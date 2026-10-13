import { describe, expect, test } from 'bun:test'
import {
  apiMessage,
  parseEnumParam,
  renderApiMessage,
  type ApiMessage,
  type NotAMessage,
} from '../../../src/api/result'
import { badRequest, type ApiErrorResponse } from '../../../src/api/http'
import { parseCardIndexFilters } from '../../../src/admin/api/card-index'
import { readSyncMessage, renderSyncMessage, syncMessage, syncRef } from '../../../src/sync/message'
import { keyedRefusal } from '../../helpers/api-message'
import { DEFAULT_LOCALE, resetI18nRuntime } from '../../../src/i18n/runtime'
import { t, tDynamic, type TranslateDynamicFn } from '../../../src/i18n/t'
import { parseEnumField } from '../../../src/util/parse-enum'
import { loadSyntheticLocale, withSyntheticLocale } from '../../helpers/sync-text'
import type { LocaleTag } from '../../../src/i18n/types'
import { localeTag } from '../../../src/i18n/locale-tag'

/**
 * The widened API response shape: `message` is rendered English —
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
    withSyntheticLocale('xx', { 'admin.api.buildSite.built': 'Baustelle' }, () => {
      // Vacuity guard: the process really does speak the synthetic locale.
      expect(t('admin.api.buildSite.built')).toBe('Baustelle')
      expect(apiMessage('admin.api.buildSite.built').message).toBe('Site built successfully')
    })
  })
})

describe('renderApiMessage', () => {
  test('prefers the key over the server-rendered English', () => {
    // A synthetic dictionary, so no shipped translation is under test.
    const xx = loadSyntheticLocale('xx', { 'admin.api.cache.refreshed': 'Katalog erneuert' })
    try {
      const result = apiMessage('admin.api.cache.refreshed')
      expect(renderApiMessage(translatorFor(xx), result)).toBe('Katalog erneuert')
    } finally {
      resetI18nRuntime()
    }
  })

  test('interpolates the parameters that rode along', () => {
    const xx = loadSyntheticLocale('xx', {
      'admin.api.list.deleted': '{name} ({listType}) weg, in {trash}',
    })
    try {
      const result = apiMessage('admin.api.list.deleted', {
        listType: 'deck',
        name: 'Burn',
        trash: '.trash/x',
      })
      expect(renderApiMessage(translatorFor(xx), result)).toBe('Burn (deck) weg, in .trash/x')
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

describe('the refusal envelope', () => {
  test('carries a keyed refusal’s key and params beside its English', async () => {
    // One assertion for every refusal helper: `badRequest` is `apiError` at
    // 400, and both spread the triple onto the shared envelope.
    const refusal = apiMessage('admin.api.cardIndex.slugInvalid', { slug: '../etc' })
    const body = (await badRequest(refusal).json()) as ApiErrorResponse
    expect(body).toEqual({
      success: false,
      message: "Invalid list slug '../etc'.",
      messageKey: 'admin.api.cardIndex.slugInvalid',
      messageParams: { slug: '../etc' },
    })
  })
})

describe('request parsers answer in English whatever the process locale', () => {
  test('a parser’s own refusal, and a shared enum refusal it re-renders', () => {
    // The operator's UI language must not leak into what an agent reads. The
    // synthetic dictionary covers both keys, so a producer that rendered with
    // `t()` in the active locale would answer in it here.
    const catalog = {
      'admin.api.cardIndex.slugInvalid': 'Schlecht {slug}',
      'errors.enum.invalid': 'Falsch {field} {value} {choices}',
    }
    withSyntheticLocale('xx', catalog, () => {
      // Vacuity guard: the shared enum parser itself answers in the locale.
      const localized = parseEnumField('sideways', ['push', 'pull'], 'direction')
      expect(localized.ok ? null : localized.message).toBe('Falsch direction sideways push, pull')
      expect(keyedRefusal(parseCardIndexFilters(new URLSearchParams('slug=..%2Fetc')))).toBe(
        "Invalid list slug '../etc'.",
      )
      expect(keyedRefusal(parseEnumParam('sideways', ['push', 'pull'], 'direction'))).toBe(
        "Invalid direction 'sideways'. Use one of: push, pull.",
      )
    })
  })
})

describe('readSyncMessage', () => {
  test('keeps nested params, which the admin page renders whole', () => {
    const sent = syncMessage('admin.api.importChanges.applied', {
      changes: syncRef('domain.count.changes', { count: 2 }),
      lists: syncRef('domain.count.lists', { count: 1 }),
    })
    expect(readSyncMessage({ success: true, ...sent })).toEqual(sent)
  })

  test('keeps a key it cannot vouch for, which rendering falls back from', () => {
    // The check is the renderer's: `renderSyncMessage` hands back the English
    // for a key this surface does not know.
    const read = readSyncMessage({ message: 'Hi', messageKey: 'admin.api.nope' })
    expect(read?.messageKey as string | undefined).toBe('admin.api.nope')
    expect(renderSyncMessage(read!, DEFAULT_LOCALE)).toBe('Hi')
  })

  test('is null for a body without a message', () => {
    expect(readSyncMessage({ success: false })).toBeNull()
    expect(readSyncMessage(null)).toBeNull()
  })

  test('drops a key that is not text, and params that are not an object', () => {
    // Both arrive untyped off the wire; what cannot be a key or a params bag is
    // left out, so the English is what renders.
    expect(readSyncMessage({ message: 'Hi', messageKey: 7 })).toEqual({ message: 'Hi' })
    const read = readSyncMessage({
      message: 'Hi',
      messageKey: 'admin.api.buildSite.built',
      messageParams: 'nope',
    })
    expect(read?.messageParams).toBeUndefined()
    expect(read?.messageKey as string | undefined).toBe('admin.api.buildSite.built')
  })
})

describe('NotAMessage', () => {
  test('refuses a parsed type any member of which could pass for a refusal', () => {
    // Type-level: `tsc` checks these lines; the runtime assertion only keeps the
    // test from being empty.
    type Plain = NotAMessage<ParsedA | ParsedB>
    type WithMessage = NotAMessage<ParsedA | ParsedWithMessage>
    const plain: Plain = 'any value fits'
    // @ts-expect-error — a union with one `message`-bearing member admits nothing.
    const refused: WithMessage = 'nothing fits'
    expect([plain, refused]).toHaveLength(2)
  })
})

type ParsedA = { name: string }
type ParsedB = { count: number }
type ParsedWithMessage = { message: string }
