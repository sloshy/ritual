import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { applyConfigGet, applyConfigSet, applyConfigUnset } from '../../src/config/config-fields'
import { parseBaseDir } from '../../src/config/base-dir'
import {
  getDefaultRitualConfig,
  isConfigParseError,
  normalizeBannedPrintings,
  parseAdminConfig,
  parseBannedPrinting,
  parseCacheFeedUrl,
  parseCacheLockTimeoutSeconds,
  parseCacheSource,
  parseCollectionSyncConfig,
  parseDefaultLanguage,
  parseManagedConfig,
  parseRitualConfig,
  parseSearchDebounceMs,
  parseSiteApiBaseUrl,
  parseSiteConfig,
  parseUiLocale,
  parseUpdateCheck,
  RitualConfigParseError,
} from '../../src/config/ritual-config'
import { parseDefaultPriceSource, parsePriceSources } from '../../src/pricing/price-source'
import {
  isMessageParseError,
  renderSyncMessage,
  syncRef,
  type SyncMessage,
} from '../../src/sync/message'
import { keyedMessage } from '../helpers/api-message'
import {
  expectLocaleInForce,
  foreignLocales,
  pseudoCatalog,
  withSyntheticLocale,
} from '../helpers/sync-text'
import { refusalError } from '../../src/migrate/runner'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import { tIn } from '../../src/i18n/t'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'

/**
 * Every refusal the config validator, `config set`/`get`/`unset` and the
 * `--base-dir` gate word is a catalog message: keyed, and English byte for byte
 * what it was as a literal. The English is what the admin API and MCP send
 * whatever the server's language; the key is what the CLI and the admin page
 * render in theirs.
 */

/** A refusal a producer returns, or a test failure saying what came back instead. */
function refusalOf(result: unknown): SyncMessage {
  if (isConfigParseError(result)) return result.error
  throw new Error(`expected a refusal, got ${JSON.stringify(result)}`)
}

const base = getDefaultRitualConfig()

/** Each refusal, and the English it has always been. */
const REFUSALS: readonly (readonly [string, () => unknown, string])[] = [
  ['a boolean', () => parseUpdateCheck('no'), '"updateCheck" must be a boolean'],
  [
    'a positive integer',
    () => parseCacheLockTimeoutSeconds(0),
    '"cacheLockTimeoutSeconds" must be a positive integer',
  ],
  [
    'a non-negative integer',
    () => parseSearchDebounceMs(-1),
    '"searchDebounceMs" must be a non-negative integer',
  ],
  [
    'one of a list',
    () => parseCacheSource('torrent'),
    '"cacheSource" must be one of: scryfall, feed',
  ],
  [
    'defaultPriceSource',
    () => parseDefaultPriceSource('usd'),
    '"defaultPriceSource" must be one of: tcgplayer, cardmarket, cardkingdom, cardhoarder',
  ],
  [
    'a priceSources list',
    () => parsePriceSources('tcgplayer'),
    '"priceSources" must be an array of strings',
  ],
  [
    'a priceSources store',
    () => parsePriceSources(['tcgplayer', 'StarCity']),
    '"priceSources" contains unknown store "StarCity". Must be any of: tcgplayer, cardmarket, cardkingdom, cardhoarder',
  ],
  ['an http(s) URL', () => parseCacheFeedUrl('ftp://x'), '"cacheFeedUrl" must be an http(s) URL'],
  [
    'a banned printing',
    () => parseBannedPrinting('sld123'),
    'banned printing "sld123" must be in "SET:COLLECTOR" form (e.g. "sld:123")',
  ],
  [
    'a banned printing inside the site block',
    () => normalizeBannedPrintings([':1']),
    'site config: banned printing ":1" must be in "SET:COLLECTOR" form (e.g. "sld:123")',
  ],
  [
    'a banned-printings list',
    () => normalizeBannedPrintings('x'),
    'site config: "bannedPrintings" must be an array of strings',
  ],
  ['a site block', () => parseSiteConfig(4), 'site config must be a JSON object'],
  [
    'a site selection list',
    () => parseSiteConfig({ includeDecks: 'x' }),
    'site config: "includeDecks" must be an array of strings',
  ],
  [
    'site.sellMode',
    () => parseSiteConfig({ sellMode: 'on' }),
    'site config: "sellMode" must be a boolean',
  ],
  [
    'site.ciSystem',
    () => parseSiteConfig({ ciSystem: 'gitlab' }),
    'site config: "ciSystem" must be "github-actions" or "manual"',
  ],
  [
    'site.deployMode',
    () => parseSiteConfig({ ciSystem: 'github-actions', deployMode: 'x' }),
    'site config: "deployMode" must be "publish-for-me" or "local-build"',
  ],
  [
    'site.distDir',
    () => parseSiteConfig({ ciSystem: 'github-actions', deployMode: 'local-build', distDir: 1 }),
    'site config: "distDir" must be a string',
  ],
  [
    'site.detectChanges',
    () =>
      parseSiteConfig({ ciSystem: 'github-actions', deployMode: 'local-build', distDir: 'dist' }),
    'site config: "detectChanges" must be a boolean',
  ],
  [
    'site.apiBaseUrl type',
    () => parseSiteApiBaseUrl(1),
    'site config: "apiBaseUrl" must be a string',
  ],
  [
    'site.apiBaseUrl',
    () => parseSiteApiBaseUrl('ftp://x'),
    'site config: "apiBaseUrl" must be an http(s) URL or an empty string',
  ],
  ['an admin block', () => parseAdminConfig(4), 'admin config must be a JSON object'],
  [
    'an admin boolean',
    () => parseAdminConfig({ gitEnabled: 'yes' }),
    'admin config: "gitEnabled" must be a boolean',
  ],
  [
    'an admin number',
    () => parseAdminConfig({ rateLimitMaxAttempts: 'x' }),
    'admin config: "rateLimitMaxAttempts" must be a number',
  ],
  [
    'an admin list',
    () => parseAdminConfig({ ipAllowList: 'x' }),
    'admin config: "ipAllowList" must be an array of strings',
  ],
  [
    'a collectionSync block',
    () => parseCollectionSyncConfig(4),
    'collectionSync config must be a JSON object',
  ],
  [
    'collectionSync.pullTarget',
    () => parseCollectionSyncConfig({ pullTarget: ' ' }),
    'collectionSync config: "pullTarget" must be a non-empty list name',
  ],
  ['a managed block', () => parseManagedConfig(4), 'managed config must be a JSON object'],
  [
    'managed.migration',
    () => parseManagedConfig({ migration: -1 }),
    'managed config: "migration" must be a non-negative integer',
  ],
  [
    'managed.version',
    () => parseManagedConfig({ version: 'v1' }),
    'managed config: "version" must be a semver string',
  ],
  [
    'managed.output',
    () => parseManagedConfig({ output: 'md5:x' }),
    'managed config: "output" must be a "sha256:" hash string',
  ],
  [
    'defaultLanguage',
    () => parseDefaultLanguage('jp'),
    'Invalid language "jp" for "defaultLanguage". Valid languages: en, es, fr, de, it, pt, ja, ko, ru, zhs, zht, he, la, grc, ar, sa, ph',
  ],
  [
    'a malformed UI locale',
    () => parseUiLocale('de_DE'),
    'invalid UI locale: invalid locale tag: de_DE',
  ],
  [
    'an unknown UI locale',
    () => parseUiLocale('zz-ZZ'),
    'invalid UI locale "zz-ZZ": no such language is known (expected a BCP-47 tag such as "en" or "de-AT")',
  ],
  [
    'the strict parse of a block',
    () => parseRitualConfig({ admin: 4 }),
    'admin config must be a JSON object',
  ],
  [
    'the strict parse of a field',
    () => parseRitualConfig({ updateCheck: 1 }),
    'updateCheck: "updateCheck" must be a boolean',
  ],
  [
    'config get, an unknown property',
    () => applyConfigGet(base, 'nope'),
    expect.stringMatching(
      /^Unknown property: "nope"\. Available properties: decksDir, .*, exportPresets$/,
    ),
  ],
  [
    'config set, no value',
    () => applyConfigSet(base, 'decksDir', [], 'replace'),
    'At least one value must be provided.',
  ],
  [
    'config set, --add on a scalar',
    () => applyConfigSet(base, 'updateCheck', ['true'], 'add'),
    '--add and --remove can only be used with array properties. "updateCheck" is a boolean.',
  ],
  [
    'config set, two values for one',
    () => applyConfigSet(base, 'decksDir', ['a', 'b'], 'replace'),
    '"decksDir" is a string and only accepts one value, but 2 were provided.',
  ],
  [
    'config set, a boolean',
    () => applyConfigSet(base, 'updateCheck', ['off'], 'replace'),
    '"updateCheck" expects a boolean. Use "true" or "false", got "off".',
  ],
  [
    'config set, an empty number',
    () => applyConfigSet(base, 'searchDebounceMs', [' '], 'replace'),
    '"searchDebounceMs" expects a number, got an empty string.',
  ],
  [
    'config set, not a number',
    () => applyConfigSet(base, 'searchDebounceMs', ['abc'], 'replace'),
    '"searchDebounceMs" expects a number, got "abc".',
  ],
  [
    'config set, a fraction',
    () => applyConfigSet(base, 'searchDebounceMs', ['1.5'], 'replace'),
    '"searchDebounceMs" expects an integer, got "1.5".',
  ],
  [
    'config set, a negative number',
    () => applyConfigSet(base, 'searchDebounceMs', ['-1'], 'replace'),
    '"searchDebounceMs" expects a non-negative integer, got "-1".',
  ],
  [
    'config set, a card language alias it cannot resolve',
    () => applyConfigSet(base, 'defaultLanguage', ['klingon'], 'replace'),
    'Invalid language "klingon" for "defaultLanguage". Valid languages: en, es, fr, de, it, pt, ja, ko, ru, zhs, zht, he, la, grc, ar, sa, ph',
  ],
  [
    'config unset, the managed block',
    () => applyConfigUnset(base, 'managed'),
    'The "managed" property is owned by Ritual and cannot be unset with "config unset"; "ritual init-site" and "ritual migrate" keep it up to date.',
  ],
  [
    'config unset, the site deployment',
    () => applyConfigUnset(base, 'site.ciSystem'),
    'The "site" property is managed by "ritual init-site" and cannot be unset with "config unset", except for the public-site selection lists: site.includeDecks, site.includeCollections, site.includeWantedLists, site.excludeDecks, site.excludeCollections, site.excludeWantedLists, site.bannedPrintings, site.apiBaseUrl, site.sellMode.',
  ],
]

describe('config refusals are keyed, and their English is unchanged', () => {
  test.each(REFUSALS)('%s', (_label, produce, english) => {
    expect(keyedMessage(refusalOf(produce()))).toEqual(english)
  })

  test.each(foreignLocales())(
    'a refusal stays English under $tag, and renders in it',
    ({ tag, catalog }) => {
      withSyntheticLocale(tag, catalog, (locale) => {
        expectLocaleInForce(locale)
        for (const [label, produce, english] of REFUSALS) {
          const refusal = refusalOf(produce())
          expect({ label, message: refusal.message }).toEqual({ label, message: english })
          // The pseudo-locale changes every message; German with no dictionary
          // changes only the lists of three or more it joins with "und".
          if (tag === 'en-XA') {
            expect({ label, rendered: renderSyncMessage(refusal) }).not.toEqual({
              label,
              rendered: refusal.message,
            })
          }
        }
        if (tag === 'de') {
          // A list of four stores, joined by German's list format.
          expect(renderSyncMessage(refusalOf(parseDefaultPriceSource('usd')))).toBe(
            '"defaultPriceSource" must be one of: tcgplayer, cardmarket, cardkingdom und cardhoarder',
          )
        }
      })
    },
  )

  test('a migration that would leave the config invalid refuses with the reason nested', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const parsed = parseRitualConfig({ cacheSource: 'torrent' })
      if (!isConfigParseError(parsed)) throw new Error('expected a refusal')
      const error = refusalError({ kind: 'invalid', error: parsed.error })
      // The envelope's params are English, flattened, whatever the CLI's language…
      expect(error.messageRef).toEqual({
        key: 'cli.migrate.invalid',
        params: { error: 'cacheSource: "cacheSource" must be one of: scryfall, feed' },
      })
      // …while the message the CLI prints is worded in it, nested part included.
      const english = tIn(DEFAULT_LOCALE, 'cli.migrate.invalid', {
        error: 'cacheSource: "cacheSource" must be one of: scryfall, feed',
      })
      expect(error.message).not.toBe(english)
      expect(error.message).not.toContain('must be one of')
    })
  })

  test('a malformed UI locale nests the tag parser’s reason, so no English is glued in', () => {
    const refusal = refusalOf(parseUiLocale('de_DE'))
    expect(refusal).toMatchObject({
      messageKey: 'domain.config.uiLocaleMalformed',
      messageParams: {
        reason: syncRef('errors.i18n.localeTag.invalid', { value: 'de_DE' }),
      },
    })
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const rendered = renderSyncMessage(refusal)
      // The English half stays English…
      expect(refusal.message).toBe('invalid UI locale: invalid locale tag: de_DE')
      // …while the rendering is the reader's language throughout: the frame and
      // the nested reason, with only the typed value left as it was.
      expect(rendered).toBe(
        tIn(locale, 'domain.config.uiLocaleMalformed', {
          reason: tIn(locale, 'errors.i18n.localeTag.invalid', { value: 'de_DE' }),
        }),
      )
      expect(rendered).not.toContain('invalid locale tag')
      expect(rendered).toContain('de_DE')
    })
  })

  test('a section refusal nests the field refusal it is about', () => {
    expect(refusalOf(parseAdminConfig({ gitEnabled: 'yes' }))).toMatchObject({
      messageKey: 'domain.config.inSection',
      messageParams: {
        section: 'admin',
        reason: syncRef('domain.config.mustBeBoolean', { field: 'gitEnabled' }),
      },
    })
  })

  test('a malformed file throws English plus its key, worded for the reader', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const error = new RitualConfigParseError('/w/ritual.config.json', 'Unexpected end')
      expect(keyedMessage(error.syncMessage)).toBe(
        'ritual.config.json is not valid JSON: /w/ritual.config.json\n  Unexpected end\n' +
          'Fix the file (or delete it to fall back to defaults) and try again.',
      )
      // `Error.message` is display text, in the language in force.
      expect(error.message).toBe(renderSyncMessage(error.syncMessage))
      expect(error.message).not.toBe(error.syncMessage.message)
    })
  })
})

describe('--base-dir refusals', () => {
  test('are keyed, with their English unchanged', async () => {
    const dir = await createWorkspace({ dirs: [], config: false })
    try {
      const missing = path.join(dir, 'nope')
      const result = await parseBaseDir(missing)
      if (!isMessageParseError(result)) throw new Error(`expected a refusal, got ${result}`)
      expect(keyedMessage(result.error)).toBe(`base directory does not exist: ${missing}`)
      expect(result.error.messageKey).toBe('cli.baseDir.missing')
    } finally {
      await removeWorkspace(dir)
    }
  })
})
