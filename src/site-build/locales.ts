/**
 * Which UI locale a site is baked in and which dictionaries ship with it: the
 * `--locale` / `--locales` / `--locale-file` semantics of `build-site` and
 * `serve --build`, decided here so the flag rules are unit-testable. (Reading
 * `--locale` off the command tree is `resolveBuildLocale` in `src/cli/options.ts`.)
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { isCatalogEntryError, parseCatalogEntry } from '../i18n/catalog'
import { describeCatalogEntryError } from '../i18n/catalog-message'
import { en } from '../i18n/messages/en'
import { isLocaleTagError } from '../i18n/locale-tag'
import { describeLocaleTagError } from '../i18n/locale-tag-message'
import { DEFAULT_LOCALE, localeFileName, localeTagFromFileName, LOCALES_DIR } from '../i18n/runtime'
import { t } from '../i18n/t'
import type { LocaleCatalog, LocaleTag } from '../i18n/types'
import { isConfigParseError, parseUiLocale } from '../config/ritual-config'
import { getErrorMessage } from '../util/errors'
import { renderSyncMessage } from '../sync/message'

/** One dictionary this build can publish, ready to write. */
export type BuildLocale = {
  tag: LocaleTag
  catalog: LocaleCatalog
}

/**
 * Parse a `--locale-file` document into a dictionary, or explain why it is not
 * one. Tolerant about *coverage* — keys English does not have are dropped, and
 * `t()` falls back per missing key — and strict about *shape*: a value
 * {@link parseCatalogEntry} refuses fails the build. The shape parser is the
 * browser's own, so the two can never disagree about what `t()` can render.
 */
export function parseLocaleFile(raw: string): LocaleCatalog | string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return t('cli.buildSite.localeFileNotJson', { reason: getErrorMessage(err) })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return t('cli.buildSite.localeFileNotObject')
  }
  const catalog: LocaleCatalog = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in en)) continue
    const entry = parseCatalogEntry(value)
    if (isCatalogEntryError(entry)) {
      return t('cli.buildSite.localeFileBadValue', {
        key,
        reason: describeCatalogEntryError(entry),
      })
    }
    catalog[key] = entry
  }
  return catalog
}

/**
 * Load every `--locale-file`. The file *name* is the locale tag (`de-AT.json`),
 * the `locales/<tag>.json` layout translators work in. Returns an error message
 * string on the first failure.
 */
export async function loadLocaleFiles(paths: readonly string[]): Promise<BuildLocale[] | string> {
  const locales: BuildLocale[] = []
  for (const filePath of paths) {
    const tag = localeTagFromFileName(path.basename(filePath))
    if (isLocaleTagError(tag)) {
      return t('cli.buildSite.localeFileBadTag', {
        path: filePath,
        reason: describeLocaleTagError(tag),
      })
    }
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      return t('cli.buildSite.localeFileUnreadable', {
        path: filePath,
        reason: getErrorMessage(err),
      })
    }
    const parsed = parseLocaleFile(raw)
    if (typeof parsed === 'string') {
      return t('cli.buildSite.localeFileInvalid', { path: filePath, reason: parsed })
    }
    locales.push({ tag, catalog: parsed })
  }
  return locales
}

/** What {@link planLocales} decides from. Nothing is read ambiently. */
export type LocalePlanInput = {
  /** The `--locale` value as typed, or undefined to fall back to the configured one. */
  locale: string | undefined
  /** The `--locales` values as typed, or undefined for the default (English only). */
  locales: readonly string[] | undefined
  /** The configured `uiLocale` — the baked default when no flag names one. */
  configured: LocaleTag
  /** Every dictionary this build could publish. English is implicit and never listed. */
  available: readonly BuildLocale[]
}

/** The locale decisions a build acts on. */
export type LocaleBuildPlan = {
  /** The baked default: `<html lang>`/`dir` and `index.json.uiLocale`. */
  locale: LocaleTag
  /** The dictionaries to publish into `dist/locales/`, English first. */
  emitted: BuildLocale[]
  /** Non-fatal notes to print — a baked locale with no dictionary, so far. */
  warnings: string[]
}

/**
 * Decide which locale this site is baked in and which dictionaries ship with
 * it; an error message string for a usage error. A baked locale with no
 * dictionary is a *warning* (zero coverage is the degenerate partial catalog,
 * which must stay shippable); a `--locales` tag with no dictionary is an error,
 * because that flag's whole job is to name files to emit.
 */
export function planLocales(input: LocalePlanInput): LocaleBuildPlan | string {
  const bakedRaw = input.locale ?? input.configured
  const baked = parseUiLocale(bakedRaw)
  if (isConfigParseError(baked)) {
    return t('cli.buildSite.localeInvalid', {
      value: bakedRaw,
      reason: renderSyncMessage(baked.error),
    })
  }

  const byTag = new Map<string, BuildLocale>()
  for (const entry of input.available) byTag.set(entry.tag.toLowerCase(), entry)

  const wanted: LocaleTag[] = [DEFAULT_LOCALE]
  const addTag = (tag: LocaleTag): void => {
    if (!wanted.some((existing) => existing.toLowerCase() === tag.toLowerCase())) wanted.push(tag)
  }

  for (const requested of input.locales ?? []) {
    if (requested.trim().toLowerCase() === 'all') {
      for (const entry of input.available) addTag(entry.tag)
      continue
    }
    const tag = parseUiLocale(requested)
    if (isConfigParseError(tag)) {
      return t('cli.buildSite.localesInvalid', {
        value: requested,
        reason: renderSyncMessage(tag.error),
      })
    }
    if (tag !== DEFAULT_LOCALE && !byTag.has(tag.toLowerCase())) {
      return t('cli.buildSite.localesUnknown', { tag })
    }
    addTag(tag)
  }

  const warnings: string[] = []
  // The baked default is always emitted: a site whose shell says `lang="de"`
  // must be able to fetch the German dictionary it names.
  if (baked !== DEFAULT_LOCALE) {
    if (byTag.has(baked.toLowerCase())) addTag(baked)
    else {
      warnings.push(t('cli.buildSite.bakedLocaleUndictionaried', { tag: baked }))
    }
  }

  const emitted: BuildLocale[] = wanted.map(
    (tag) => byTag.get(tag.toLowerCase()) ?? { tag, catalog: en },
  )
  return { locale: baked, emitted, warnings }
}

/**
 * Publish dictionaries into `<distDir>/locales/`, one `<tag>.json` each — the
 * layout `ensureLocaleLoaded` fetches from and `serve` serves. Shared by the
 * site build and the admin's boot assets.
 */
export async function writeDictionaries(
  distDir: string,
  entries: readonly BuildLocale[],
): Promise<void> {
  const dir = path.join(distDir, LOCALES_DIR)
  await fs.mkdir(dir, { recursive: true })
  for (const { tag, catalog } of entries) {
    await Bun.write(path.join(dir, localeFileName(tag)), JSON.stringify(catalog))
  }
}
