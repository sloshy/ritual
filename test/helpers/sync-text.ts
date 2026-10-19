/**
 * Shared helpers for asserting on sync messages (`src/sync/message.ts`): their
 * English rendering, change lines rendered to English, and a synthetic UI locale
 * to prove a message really renders in the reader's language.
 */

import { expect } from 'bun:test'
import { localeTag } from '../../src/i18n/locale-tag-message'
import { en, type MessageKey } from '../../src/i18n/messages/en'
import { enMeta } from '../../src/i18n/messages/en.meta'
import { pseudoLocalize } from '../../scripts/generate-locales'
import {
  currentLocale,
  DEFAULT_LOCALE,
  loadDictionary,
  resetI18nRuntime,
  setLocale,
} from '../../src/i18n/runtime'
import type { LocaleCatalog, LocaleTag } from '../../src/i18n/types'
import type { ItemChangeLine } from '../../src/sync/describe'
import {
  renderSyncMessage,
  renderSyncParam,
  syncList,
  SyncMessageError,
  syncRef,
  type SyncMessage,
  type SyncParam,
} from '../../src/sync/message'

/** A sync message, reference, literal or param, rendered as English. */
export function english(text: SyncMessage | SyncParam): string {
  return typeof text === 'object' && 'message' in text
    ? renderSyncMessage(text, DEFAULT_LOCALE)
    : renderSyncParam(text, DEFAULT_LOCALE)
}

/** A change line with its text rendered in English. */
export type EnglishLine = { level: ItemChangeLine['level']; text: string }

/** Change lines with their text rendered in English. */
export function englishLines(lines: readonly ItemChangeLine[]): EnglishLine[] {
  return lines.map((line) => ({ level: line.level, text: english(line.text) }))
}

/**
 * Run `body` with a synthetic dictionary loaded for `tag` and that locale
 * applied, then put the runtime back — so a locale test cannot leak into the
 * next one even when it fails.
 */
export function withSyntheticLocale<T>(
  tag: string,
  catalog: LocaleCatalog,
  body: (locale: LocaleTag) => T,
): T {
  const locale = localeTag(tag)
  loadDictionary(locale, catalog)
  setLocale(locale)
  try {
    return body(locale)
  } finally {
    resetI18nRuntime()
  }
}

/**
 * {@link withSyntheticLocale} for an async `body`: the locale stays applied
 * until the promise settles, so a handler that awaits before it renders is
 * still judged in the synthetic language.
 */
export async function withSyntheticLocaleAsync<T>(
  tag: string,
  catalog: LocaleCatalog,
  body: (locale: LocaleTag) => Promise<T>,
): Promise<T> {
  const locale = localeTag(tag)
  loadDictionary(locale, catalog)
  setLocale(locale)
  try {
    return await body(locale)
  } finally {
    resetI18nRuntime()
  }
}

/** Load a synthetic dictionary for `tag` without applying it; reset with `resetI18nRuntime`. */
export function loadSyntheticLocale(tag: string, catalog: LocaleCatalog): LocaleTag {
  const locale = localeTag(tag)
  loadDictionary(locale, catalog)
  return locale
}

let pseudoCatalogMemo: LocaleCatalog | null = null

/**
 * The whole English catalog pseudo-localized (`en-XA`): every message changes
 * under it, so text that leaks into something meant to be language-neutral — a
 * persisted file, an English API message — is unmissable. Memoized: generating
 * it walks ~4,000 keys.
 */
export function pseudoCatalog(): LocaleCatalog {
  pseudoCatalogMemo ??= pseudoLocalize(en, enMeta)
  return pseudoCatalogMemo
}

/**
 * One plain-string message of {@link pseudoCatalog}, placeholders unfilled — for
 * building what a pseudo-localized line reads. Throws on a `$plural` / `$select`
 * message, whose forms a test must pick itself.
 */
export function pseudoString(key: MessageKey): string {
  const value = pseudoCatalog()[key]
  if (typeof value !== 'string') throw new Error(`${key} is not a plain-string message`)
  return value
}

/**
 * The `other` form of one of {@link pseudoCatalog}'s `$plural` messages,
 * placeholders unfilled — {@link pseudoString}'s twin for a counted noun.
 */
export function pseudoPlural(key: MessageKey): string {
  const value = pseudoCatalog()[key]
  if (typeof value !== 'object' || value === null || !('other' in value)) {
    throw new Error(`${key} is not a plural message`)
  }
  return String(value.other)
}

/** A foreign UI language a persistence pin runs under, and the dictionary it loads. */
export type ForeignLocale = { tag: string; catalog: LocaleCatalog }

/**
 * The languages a "these bytes never move" pin runs under: the full pseudo
 * catalog, which changes every message, and real German with no dictionary at
 * all, which changes everything routed through `Intl` (numbers, durations,
 * lists) — the half a synthetic tag that resolves to `en-US` cannot reach.
 */
export function foreignLocales(): ForeignLocale[] {
  return [
    { tag: 'en-XA', catalog: pseudoCatalog() },
    { tag: 'de', catalog: {} },
  ]
}

/**
 * Vacuity guard for a "same bytes in every language" pin: `locale` is the one in
 * force, and each probe renders differently in it than in English. The probes
 * are catalog messages holding an `Intl` list — one joined with "and", one a
 * `unit` list (what refusals offering accepted values use) — so they catch both
 * kinds of foreign locale {@link foreignLocales} supplies: the pseudo-locale
 * changes the catalog text, German with no dictionary changes how `Intl` joins
 * each list. Call it before a run and again after, so a run that reset the
 * locale part way cannot pass by comparing English with English.
 */
export function expectLocaleInForce(locale: LocaleTag): void {
  expect(currentLocale()).toBe(locale)
  const probes = [
    syncRef('domain.list.art.unknownKeys', { keys: syncList(['a', 'b', 'c'], 'and') }),
    syncRef('domain.export.problem.columnsEmpty', { columns: syncList(['a', 'b', 'c'], 'unit') }),
  ]
  for (const probe of probes) {
    expect(renderSyncParam(probe, locale)).not.toBe(renderSyncParam(probe, DEFAULT_LOCALE))
  }
}

/**
 * The message a promise rejects with — English plus its key and params — after
 * asserting it rejects at all, and with a {@link SyncMessageError}: an engine
 * error a route answers in English plus the key must be one.
 */
export async function rejectedSyncMessage(promise: Promise<unknown>): Promise<SyncMessage> {
  const error = await promise.then(
    () => new Error('expected the promise to reject'),
    (reason: unknown) => reason,
  )
  if (!(error instanceof SyncMessageError)) {
    throw new Error(`expected a SyncMessageError, got ${String(error)}`)
  }
  return error.syncMessage
}

/**
 * {@link withSyntheticLocaleAsync} with the vacuity guard on both sides: the
 * locale is in force (and renders differently from English) before `body` runs
 * and after it settles, so a run that reset the locale part way fails rather
 * than comparing English with English.
 */
export function withGuardedLocaleAsync<T>(
  tag: string,
  catalog: LocaleCatalog,
  body: (locale: LocaleTag) => Promise<T>,
): Promise<T> {
  return withSyntheticLocaleAsync(tag, catalog, async (locale) => {
    expectLocaleInForce(locale)
    const result = await body(locale)
    expectLocaleInForce(locale)
    return result
  })
}
