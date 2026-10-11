/**
 * Shared helpers for asserting on sync messages (`src/sync/message.ts`): their
 * English rendering, change lines rendered to English, and a synthetic UI locale
 * to prove a message really renders in the reader's language.
 */

import { localeTag } from '../../src/i18n/locale-tag'
import { DEFAULT_LOCALE, loadDictionary, resetI18nRuntime, setLocale } from '../../src/i18n/runtime'
import type { LocaleCatalog, LocaleTag } from '../../src/i18n/types'
import type { ItemChangeLine } from '../../src/sync/describe'
import {
  renderSyncMessage,
  renderSyncParam,
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

/** Load a synthetic dictionary for `tag` without applying it; reset with `resetI18nRuntime`. */
export function loadSyntheticLocale(tag: string, catalog: LocaleCatalog): LocaleTag {
  const locale = localeTag(tag)
  loadDictionary(locale, catalog)
  return locale
}
