import { type JSX, createSignal, onMount, For, Show } from 'solid-js'
import type {
  AdminConfig,
  CacheSource,
  RitualConfig,
  SiteConfig,
} from '../../../config/ritual-config'
// Value imports here must stay browser-safe: ritual-config pulls in node:fs,
// so only its types may be imported into the admin SPA bundle.
import { DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS } from '../../../cache/constants'
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '../../../config/search-debounce'
import { CARD_LANGUAGES, isCardLanguage, languageDisplayName } from '../../../card/card-language'
import type { PriceCurrency } from '../../../pricing/price-currency'
import { VALID_PRICE_SOURCES } from '../../../pricing/price-source'
import { PRICE_SOURCE_LABELS, setEnabledPriceSources } from '../../../list-view/price-view'
import {
  INCLUDE_ALL,
  defaultSiteSelection,
  type SiteSelectionConfig,
} from '../../../config/list-selection'
import { fetchRitualConfig } from '../config-api'
import { refreshSellModeEnabled } from '../sell-enabled'
import { applyDefaultLanguage } from '../hooks/useDefaultLanguage'
import { adoptConfiguredLocale, availableLocales } from '../hooks/useAdminLocale'
import { localeEndonym } from '../../../site/LanguageSwitcher'
import { isLocaleTagError, parseLocaleTag } from '../../../i18n/locale-tag'
import type { LocaleTag, MessageSegment } from '../../../i18n/types'
import { useT, useTSegments } from '../../../ui/i18n'
import { apiMessage } from '../../../api/result'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'
import { TotpSettings } from '../components/TotpSettings'
import { PageHeading } from '../components/PageHeading'

function listToString(list: string[]): string {
  return list.join('\n')
}

function parseList(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * The `site` keys this page stores by presence: absent means the built-in
 * default, so the control's "off"/blank position deletes the key rather than
 * writing the default back as an explicit value.
 */
type OptionalSiteKey = 'apiBaseUrl' | 'sellMode'

/** Render a stored `set:collector` printing key with the set code uppercased for display. */
function displayBannedPrinting(key: string): string {
  const colon = key.indexOf(':')
  return colon > 0 ? `${key.slice(0, colon).toUpperCase()}:${key.slice(colon + 1)}` : key
}

export function Settings(): JSX.Element {
  const t = useT()
  const tSegments = useTSegments()
  const [config, setConfig] = createSignal<RitualConfig | null>(null)
  const { status, error, loading, run, setStatus, setError } = useApiAction()
  /** True from Save click until every post-save push (incl. the status re-read) lands. */
  const [syncing, setSyncing] = createSignal(false)

  /**
   * Render a hint's segments with every parameter wrapped in `<code>`. The
   * message is drawn as segments rather than split around the sample, so a
   * translator can put the code where their word order wants it.
   */
  const withCode = (segments: MessageSegment[]) => (
    <For each={segments}>
      {(segment) => (segment.kind === 'param' ? <code>{segment.value}</code> : segment.value)}
    </For>
  )

  const fetchConfig = async () => {
    const cfg = await fetchRitualConfig()
    if (cfg) setConfig(cfg)
    else setError(apiMessage('admin.settings.loadFailed'))
  }

  onMount(() => {
    void fetchConfig()
  })

  const handleSave = async () => {
    const saved = config()
    if (!saved) return
    // `run` clears its own loading flag before the post-save pushes below
    // finish, so this flag is what keeps the Save button disabled until the
    // status re-read lands — a second click mid-flip would interleave two
    // `GET /api/status` reads and let the older answer win.
    setSyncing(true)
    try {
      const ok = await run(
        '/api/config',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saved),
        },
        apiMessage('admin.settings.saveFailed'),
      )
      if (ok) {
        // The default-language holders are primed once at boot (no per-page
        // re-fetch), so a saved change must be pushed for an already-mounted
        // editor page to stamp the new language without a reload.
        applyDefaultLanguage(saved.defaultLanguage)
        // Same again for the price stores: the shared price-view store is
        // seeded at page mount, so a save must push the new list for already-
        // mounted editors to update their source selector and price reads.
        setEnabledPriceSources(saved.priceSources)
        // Same reasoning for the interface language: the admin resolves it once at
        // boot, so a saved change has to be pushed for the running app to adopt it
        // (it is the weakest tier, so an explicit choice still wins).
        adoptConfiguredLocale(saved.uiLocale)
        // Sell mode is the one of these the client cannot compute for itself: a
        // server started with `--sell-mode` stays on whatever was just stored, so
        // the effective value is re-read from `GET /api/status`.
        await refreshSellModeEnabled()
        // Last, so the "Settings saved" alert really is the point at which every
        // pushed change has landed: the editors' sell toggle, the Move Cards sell
        // controls and the Cache page's buylist card have appeared (or gone) by
        // the time it shows. Anything waiting on the save — a person, or the e2e
        // helper — can synchronize on the alert alone.
        setStatus(apiMessage('admin.settings.saved'))
      }
    } finally {
      setSyncing(false)
    }
  }

  const updateField = <K extends keyof RitualConfig>(field: K, value: RitualConfig[K]) => {
    setConfig((prev) => (prev ? { ...prev, [field]: value } : null))
  }

  // Admin settings live under the nested `admin` object; merge into it so the
  // other admin fields are preserved.
  const updateAdminField = (field: keyof AdminConfig, value: string | boolean | number) => {
    setConfig((prev) => (prev ? { ...prev, admin: { ...prev.admin, [field]: value } } : null))
  }

  const updateAdminListField = (field: keyof AdminConfig, value: string) => {
    setConfig((prev) =>
      prev ? { ...prev, admin: { ...prev.admin, [field]: parseList(value) } } : null,
    )
  }

  // The selection lists live under `site`; show the field's value or its default
  // (['*'] for include lists, [] for exclude lists) when absent.
  const siteList = (field: keyof SiteSelectionConfig, fallback: string[]): string[] =>
    config()?.site?.[field] ?? fallback

  const updateSiteListField = (field: keyof SiteSelectionConfig, value: string) => {
    setConfig((prev) => {
      if (!prev) return null
      // When the `site` object doesn't exist yet (init-site not run), seed all
      // three lists with the default so the untouched textareas keep showing '*'
      // and aren't dropped on save. An existing site keeps its other fields
      // (deployment settings and the other selection lists) via the spread.
      const site = prev.site ?? defaultSiteSelection()
      return { ...prev, site: { ...site, [field]: parseList(value) } }
    })
  }

  /**
   * Write one optional `site` key, or delete it when the value is `undefined`.
   *
   * The delete-means-unset contract is load-bearing and worth stating exactly
   * once: it only round-trips to a genuinely absent key because `PUT
   * /api/config` replaces `site` wholesale, and it is what keeps `config get
   * site.sellMode` exiting 3 (not_found) after an untick rather than reporting
   * an explicit `false` that reads like a standing decision the default already
   * makes. Seeding from `defaultSiteSelection()` keeps the untouched selection
   * textareas showing `*` when no `site` object exists yet (init-site not run).
   */
  const updateSiteKey = <K extends OptionalSiteKey>(key: K, value: SiteConfig[K] | undefined) => {
    setConfig((prev) => {
      if (!prev) return null
      const site: SiteConfig = { ...(prev.site ?? defaultSiteSelection()) }
      if (value === undefined) delete site[key]
      else site[key] = value
      return { ...prev, site }
    })
  }

  // Banned default printings live under `site`. Stored keys are lowercase
  // (`sld:123`) but shown with the set code uppercased; the server re-normalizes
  // whatever is submitted on save.
  const bannedPrintingsText = (): string =>
    (config()?.site?.bannedPrintings ?? []).map(displayBannedPrinting).join('\n')

  const updateBannedPrintings = (value: string) => {
    setConfig((prev) => {
      if (!prev) return null
      const site = prev.site ?? defaultSiteSelection()
      return { ...prev, site: { ...site, bannedPrintings: parseList(value) } }
    })
  }

  return (
    <Show
      when={config()}
      fallback={
        <div>
          <p class="text-muted">{t('admin.settings.loading')}</p>
        </div>
      }
    >
      <div>
        <PageHeading page="settings" />
        <StatusAlerts status={status()} error={error()} />
        <div class="form-container">
          {/* Directories */}
          <div>
            <label class="form-label">{t('admin.settings.decksDir')}</label>
            <input
              type="text"
              class="form-input"
              name="decksDir"
              placeholder={t('admin.settings.decksDirPlaceholder')}
              value={config()!.decksDir}
              onInput={(e) => updateField('decksDir', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.collectionsDir')}</label>
            <input
              type="text"
              class="form-input"
              name="collectionsDir"
              placeholder={t('admin.settings.collectionsDirPlaceholder')}
              value={config()!.collectionsDir}
              onInput={(e) => updateField('collectionsDir', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.wantedDir')}</label>
            <input
              type="text"
              class="form-input"
              name="wantedDir"
              placeholder={t('admin.settings.wantedDirPlaceholder')}
              value={config()!.wantedDir}
              onInput={(e) => updateField('wantedDir', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.artDir')}</label>
            <input
              type="text"
              class="form-input"
              name="artDir"
              placeholder={t('admin.settings.artDirPlaceholder')}
              value={config()!.artDir}
              onInput={(e) => updateField('artDir', e.currentTarget.value)}
            />
            <p class="form-hint">{t('admin.settings.artDirHint')}</p>
          </div>
          <div>
            <label class="form-label">{t('admin.settings.defaultCurrency')}</label>
            <select
              class="form-input"
              name="defaultCurrency"
              value={config()!.defaultCurrency}
              onChange={(e) =>
                updateField('defaultCurrency', e.currentTarget.value as PriceCurrency)
              }
            >
              <option value="usd">{t('admin.settings.currencyUsd')}</option>
              <option value="eur">{t('admin.settings.currencyEur')}</option>
              <option value="tix">{t('admin.settings.currencyTix')}</option>
            </select>
          </div>
          <div>
            <label class="form-label">{t('admin.settings.priceSources')}</label>
            <For each={VALID_PRICE_SOURCES}>
              {(source) => (
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    name={`priceSource-${source}`}
                    checked={config()!.priceSources.includes(source)}
                    onChange={(e) => {
                      // Keep canonical order rather than click order, so the
                      // persisted array is stable however the boxes are toggled.
                      const current = new Set(config()!.priceSources)
                      if (e.currentTarget.checked) current.add(source)
                      else current.delete(source)
                      updateField(
                        'priceSources',
                        VALID_PRICE_SOURCES.filter((s) => current.has(s)),
                      )
                    }}
                  />
                  {t(PRICE_SOURCE_LABELS[source])}
                </label>
              )}
            </For>
            <p class="form-hint form-hint-top">{t('admin.settings.priceSourcesHint')}</p>
          </div>
          <div>
            <label class="form-label">{t('admin.settings.defaultLanguage')}</label>
            <select
              class="form-input"
              name="defaultLanguage"
              value={config()!.defaultLanguage}
              onChange={(e) => {
                const value = e.currentTarget.value
                if (isCardLanguage(value)) updateField('defaultLanguage', value)
              }}
            >
              <For each={CARD_LANGUAGES}>
                {(code) => (
                  <option value={code}>
                    {t('admin.settings.languageOption', { name: languageDisplayName(code), code })}
                  </option>
                )}
              </For>
            </select>
            <p class="form-hint form-hint-top">{t('admin.settings.defaultLanguageHint')}</p>
          </div>
          {/* Deliberately below Default Language and worded against it: the two
              are orthogonal, and reading one as the other is the mistake the
              naming split exists to prevent. */}
          <div>
            <label class="form-label">{t('admin.settings.uiLocale')}</label>
            <select
              class="form-input"
              name="uiLocale"
              value={config()!.uiLocale}
              onChange={(e) => {
                // Validated at the edge like every other tag, so a hand-edited
                // option value can never reach an `Intl` constructor.
                const parsed = parseLocaleTag(e.currentTarget.value)
                if (isLocaleTagError(parsed)) return
                updateField('uiLocale', parsed)
              }}
            >
              <For each={availableLocales()}>
                {(tag: LocaleTag) => (
                  <option value={tag} selected={tag === config()!.uiLocale} lang={tag}>
                    {t('admin.settings.uiLocaleOption', { endonym: localeEndonym(tag), tag })}
                  </option>
                )}
              </For>
            </select>
            <p class="form-hint form-hint-top">{t('admin.settings.uiLocaleHint')}</p>
          </div>
          <div>
            <label class="form-label">{t('admin.settings.cacheSource')}</label>
            <select
              class="form-input"
              name="cacheSource"
              value={config()!.cacheSource}
              onChange={(e) => updateField('cacheSource', e.currentTarget.value as CacheSource)}
            >
              <option value="scryfall">{t('admin.settings.cacheSourceScryfall')}</option>
              <option value="feed">{t('admin.settings.cacheSourceFeed')}</option>
            </select>
          </div>
          <div>
            <label class="form-label">{t('admin.settings.cacheFeedUrl')}</label>
            <input
              type="text"
              class="form-input"
              name="cacheFeedUrl"
              placeholder={t('admin.settings.cacheFeedUrlPlaceholder')}
              value={config()!.cacheFeedUrl ?? ''}
              onInput={(e) => updateField('cacheFeedUrl', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.cacheLockTimeout')}</label>
            <input
              type="number"
              class="form-input"
              name="cacheLockTimeoutSeconds"
              min={1}
              step={1}
              placeholder={t('admin.settings.cacheLockTimeoutPlaceholder')}
              value={config()!.cacheLockTimeoutSeconds}
              onInput={(e) =>
                updateField(
                  'cacheLockTimeoutSeconds',
                  parseInt(e.currentTarget.value, 10) || DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS,
                )
              }
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.searchDebounce')}</label>
            <input
              type="number"
              class="form-input"
              name="searchDebounceMs"
              min={0}
              step={100}
              placeholder={t('admin.settings.searchDebouncePlaceholder')}
              value={config()!.searchDebounceMs}
              onInput={(e) => {
                const n = parseInt(e.currentTarget.value, 10)
                updateField(
                  'searchDebounceMs',
                  Number.isFinite(n) && n >= 0 ? n : DEFAULT_SEARCH_DEBOUNCE_MS,
                )
              }}
            />
            <p class="form-hint form-hint-top">{t('admin.settings.searchDebounceHint')}</p>
          </div>

          {/* Git settings */}
          <h3 class="section-subheading">{t('admin.settings.gitHeading')}</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.admin.gitEnabled}
              onChange={(e) => updateAdminField('gitEnabled', e.currentTarget.checked)}
            />
            {t('admin.settings.gitEnabled')}
          </label>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.admin.gitAutoCommit}
              onChange={(e) => updateAdminField('gitAutoCommit', e.currentTarget.checked)}
              disabled={!config()!.admin.gitEnabled}
            />
            {t('admin.settings.gitAutoCommit')}
          </label>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.admin.gitAutoPush}
              onChange={(e) => updateAdminField('gitAutoPush', e.currentTarget.checked)}
              disabled={!config()!.admin.gitEnabled || !config()!.admin.gitAutoCommit}
            />
            {t('admin.settings.gitAutoPush')}
          </label>
          <p class="form-hint">{t('admin.settings.gitHint')}</p>

          {/* Proxy & Cookie Security */}
          <h3 class="section-subheading">{t('admin.settings.networkHeading')}</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.admin.trustProxy}
              onChange={(e) => updateAdminField('trustProxy', e.currentTarget.checked)}
            />
            {t('admin.settings.trustProxy')}
          </label>
          <p class="form-hint">{t('admin.settings.trustProxyHint')}</p>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.admin.secureCookies}
              onChange={(e) => updateAdminField('secureCookies', e.currentTarget.checked)}
            />
            {t('admin.settings.secureCookies')}
          </label>
          <p class="form-hint">{t('admin.settings.secureCookiesHint')}</p>

          {/* Two-Factor Authentication */}
          <h3 class="section-subheading">{t('admin.settings.totpHeading')}</h3>
          <TotpSettings />

          {/* Rate Limiting */}
          <h3 class="section-subheading">{t('admin.settings.rateLimitHeading')}</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={config()!.admin.rateLimitEnabled}
              onChange={(e) => updateAdminField('rateLimitEnabled', e.currentTarget.checked)}
            />
            {t('admin.settings.rateLimitEnabled')}
          </label>

          <Show when={config()!.admin.rateLimitEnabled}>
            <div class="form-grid-2col">
              <div>
                <label class="form-label">{t('admin.settings.rateLimitMax')}</label>
                <input
                  type="number"
                  min={1}
                  class="form-input"
                  value={config()!.admin.rateLimitMaxAttempts}
                  onInput={(e) =>
                    updateAdminField(
                      'rateLimitMaxAttempts',
                      parseInt(e.currentTarget.value, 10) || 5,
                    )
                  }
                />
              </div>
              <div>
                <label class="form-label">{t('admin.settings.rateLimitWindow')}</label>
                <input
                  type="number"
                  min={1}
                  class="form-input"
                  value={config()!.admin.rateLimitWindowMinutes}
                  onInput={(e) =>
                    updateAdminField(
                      'rateLimitWindowMinutes',
                      parseInt(e.currentTarget.value, 10) || 5,
                    )
                  }
                />
              </div>
            </div>
          </Show>

          <div>
            <label class="form-label">{t('admin.settings.failedAuthDelay')}</label>
            <input
              type="number"
              min={0}
              step={500}
              class="form-input"
              value={config()!.admin.failedAuthDelayMs}
              onInput={(e) =>
                updateAdminField('failedAuthDelayMs', parseInt(e.currentTarget.value, 10) || 0)
              }
            />
            <p class="form-hint form-hint-top">{t('admin.settings.failedAuthDelayHint')}</p>
          </div>

          {/* IP Allow/Deny Lists */}
          <h3 class="section-subheading">{t('admin.settings.ipHeading')}</h3>
          <p class="form-hint form-hint-gap">{t('admin.settings.ipHint')}</p>

          <div>
            <label class="form-label">{t('admin.settings.ipAllow')}</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.admin.ipAllowList)}
              onInput={(e) => updateAdminListField('ipAllowList', e.currentTarget.value)}
              placeholder={t('admin.settings.ipAllowPlaceholder')}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.ipDeny')}</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.admin.ipDenyList)}
              onInput={(e) => updateAdminListField('ipDenyList', e.currentTarget.value)}
              placeholder={t('admin.settings.ipDenyPlaceholder')}
            />
          </div>

          {/* User-Agent Allow/Deny Lists */}
          <h3 class="section-subheading">{t('admin.settings.uaHeading')}</h3>
          <p class="form-hint form-hint-gap">{t('admin.settings.uaHint')}</p>

          <div>
            <label class="form-label">{t('admin.settings.uaAllow')}</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.admin.userAgentAllowList)}
              onInput={(e) => updateAdminListField('userAgentAllowList', e.currentTarget.value)}
              placeholder={t('admin.settings.uaAllowPlaceholder')}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.uaDeny')}</label>
            <textarea
              class="form-input form-input-monospace"
              value={listToString(config()!.admin.userAgentDenyList)}
              onInput={(e) => updateAdminListField('userAgentDenyList', e.currentTarget.value)}
              placeholder={t('admin.settings.uaDenyPlaceholder')}
            />
          </div>

          {/* Public Site lists */}
          <h3 class="section-subheading">{t('admin.settings.publicSiteHeading')}</h3>
          <p class="form-hint form-hint-gap">
            {withCode(tSegments('admin.settings.publishHint', { all: INCLUDE_ALL }))}
          </p>

          <div>
            <label class="form-label">{t('admin.settings.includeDecks')}</label>
            <textarea
              class="form-input form-input-monospace"
              name="includeDecks"
              value={listToString(siteList('includeDecks', [INCLUDE_ALL]))}
              onInput={(e) => updateSiteListField('includeDecks', e.currentTarget.value)}
              placeholder={INCLUDE_ALL}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.includeCollections')}</label>
            <textarea
              class="form-input form-input-monospace"
              name="includeCollections"
              value={listToString(siteList('includeCollections', [INCLUDE_ALL]))}
              onInput={(e) => updateSiteListField('includeCollections', e.currentTarget.value)}
              placeholder={INCLUDE_ALL}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.includeWanted')}</label>
            <textarea
              class="form-input form-input-monospace"
              name="includeWantedLists"
              value={listToString(siteList('includeWantedLists', [INCLUDE_ALL]))}
              onInput={(e) => updateSiteListField('includeWantedLists', e.currentTarget.value)}
              placeholder={INCLUDE_ALL}
            />
          </div>

          <p class="form-hint form-hint-gap">{t('admin.settings.excludeHint')}</p>

          <div>
            <label class="form-label">{t('admin.settings.excludeDecks')}</label>
            <textarea
              class="form-input form-input-monospace"
              name="excludeDecks"
              value={listToString(siteList('excludeDecks', []))}
              onInput={(e) => updateSiteListField('excludeDecks', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.excludeCollections')}</label>
            <textarea
              class="form-input form-input-monospace"
              name="excludeCollections"
              value={listToString(siteList('excludeCollections', []))}
              onInput={(e) => updateSiteListField('excludeCollections', e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="form-label">{t('admin.settings.excludeWanted')}</label>
            <textarea
              class="form-input form-input-monospace"
              name="excludeWantedLists"
              value={listToString(siteList('excludeWantedLists', []))}
              onInput={(e) => updateSiteListField('excludeWantedLists', e.currentTarget.value)}
            />
          </div>

          <p class="form-hint form-hint-gap">
            {withCode(
              tSegments('admin.settings.apiBaseUrlHint', {
                command: t('admin.settings.apiBaseUrlCommand'),
              }),
            )}
          </p>
          {/* The live-backend base URL for split deployments (static site +
              separately hosted `serve --api`). A blank input means "fully
              static" and removes the key; the same-origin empty-string variant
              (a reverse proxy) is a `config set` niche this input doesn't
              express. */}
          <div>
            <label class="form-label">{t('admin.settings.apiBaseUrl')}</label>
            <input
              type="text"
              class="form-input"
              name="apiBaseUrl"
              value={config()?.site?.apiBaseUrl ?? ''}
              onInput={(e) =>
                updateSiteKey('apiBaseUrl', e.currentTarget.value.trim() || undefined)
              }
              placeholder={t('admin.settings.apiBaseUrlPlaceholder')}
            />
          </div>

          {/* Sell mode. Saving this takes effect immediately on both sides: the
              server gates its sell routes on a per-request config read, and the
              save handler re-reads the effective value so this admin's own sell
              surfaces appear or disappear without a reload. Unticking deletes
              the key rather than storing `false` — see `updateSiteKey`. */}
          <label class="checkbox-label">
            <input
              type="checkbox"
              name="sellMode"
              checked={config()!.site?.sellMode === true}
              onChange={(e) => updateSiteKey('sellMode', e.currentTarget.checked || undefined)}
            />
            {t('admin.settings.sellMode')}
          </label>
          <p class="form-hint">
            {withCode(
              tSegments('admin.settings.sellModeHint', {
                flag: t('admin.settings.sellModeFlag'),
              }),
            )}
          </p>

          {/* Banned default printings */}
          <h3 class="section-subheading">{t('admin.settings.printingsHeading')}</h3>
          <p class="form-hint form-hint-gap">
            {withCode(
              tSegments('admin.settings.printingsHint', {
                format: t('admin.settings.printingsFormat'),
                example: t('admin.settings.printingsExample'),
              }),
            )}
          </p>

          <div>
            <label class="form-label">{t('admin.settings.bannedPrintings')}</label>
            <textarea
              class="form-input form-input-monospace"
              name="bannedPrintings"
              value={bannedPrintingsText()}
              onInput={(e) => updateBannedPrintings(e.currentTarget.value)}
              placeholder={t('admin.settings.bannedPrintingsPlaceholder')}
            />
          </div>

          {/* Save */}
          <button
            class="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={loading() || syncing()}
          >
            {loading() || syncing() ? t('admin.settings.saving') : t('admin.settings.save')}
          </button>
        </div>
      </div>
    </Show>
  )
}
