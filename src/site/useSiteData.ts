import { batch, createEffect, createSignal, onMount, onCleanup } from 'solid-js'
import type { Accessor, Setter } from 'solid-js'
import type { DeckSummary, CollectionSummary, WantedListSummary, SiteIndex } from './data-types'
import type { PriceCurrency } from '../pricing/price-currency'
import { setSearchDebounceMs } from '../editor/search-debounce'
import { setDefaultLanguage } from '../editor/default-language'
import { apiActive, apiBase, dataUrl, reportDataFetchError, setApiBase } from './api-base'
import { setBuylistQuotesOnline } from './buylist-quotes'
import { setEnabledPriceSources } from './price-view'
import { isAbortError } from './utils'
import {
  currentLocale,
  DEFAULT_LOCALE,
  ensureLocaleLoaded,
  resolveBrowserLocale,
  setLocale as setRuntimeLocale,
  writeStoredLocale,
  readStoredLocale,
  type LocaleOverride,
} from '../i18n/runtime'
import type { LocaleTag } from '../i18n/types'
import { localeDirection } from './html-shell'

export type UseSiteDataResult = {
  deckList: Accessor<DeckSummary[] | null>
  collectionList: Accessor<CollectionSummary[] | null>
  wantedListList: Accessor<WantedListSummary[] | null>
  useScryfallImgUrls: Accessor<boolean>
  currency: Accessor<PriceCurrency>
  setCurrency: Setter<PriceCurrency>
  availableCurrencies: Accessor<PriceCurrency[]>
  pricesDate: Accessor<string | null>
  /**
   * Whether sell mode is offered: the site was built with `site.sellMode` on.
   * A live API is not a prerequisite — quotes ride along in each list's detail
   * JSON, so a static host offers sell mode exactly as a served one does.
   */
  sellMode: Accessor<boolean>
  /**
   * The UI locale in force — the one a dictionary is actually loaded for, which
   * is not always the one that was asked for (an unreachable dictionary
   * degrades to English rather than failing the boot).
   */
  uiLocale: Accessor<LocaleTag>
  /**
   * Every locale this deployment publishes a dictionary for, English first. The
   * language switcher shows itself only when there is more than one.
   */
  availableLocales: Accessor<LocaleTag[]>
  /**
   * Switch the UI language: fetch the dictionary if it is not loaded yet, apply
   * it, remember the choice, and restamp `<html lang dir>`. Resolves with the
   * locale actually applied.
   */
  switchLocale: (tag: LocaleTag) => Promise<LocaleTag>
  /** Refetch the index from the live backend. No-op in static mode. */
  refetch: () => void
}

/** The `?locale=` value from the hash query, or undefined when there is none. */
function localeFromHashQuery(): string | undefined {
  const hash = window.location.hash
  const start = hash.indexOf('?')
  if (start < 0) return undefined
  return new URLSearchParams(hash.slice(start + 1)).get('locale') ?? undefined
}

/**
 * Stamp the resolved locale onto the document, matching what the shell's
 * `boot.js` did before first paint so a runtime switch leaves no stale `lang`
 * behind for screen readers, hyphenation, or a future RTL stylesheet.
 */
function applyDocumentLocale(tag: LocaleTag): void {
  const element = document.documentElement
  element.lang = tag
  element.dir = localeDirection(tag)
}

export function useSiteData(): UseSiteDataResult {
  const [deckList, setDeckList] = createSignal<DeckSummary[] | null>(null)
  const [collectionList, setCollectionList] = createSignal<CollectionSummary[] | null>(null)
  const [wantedListList, setWantedListList] = createSignal<WantedListSummary[] | null>(null)
  const [useScryfallImgUrls, setUseScryfallImgUrls] = createSignal(true)
  const [currency, setCurrency] = createSignal<PriceCurrency>('usd')
  const [availableCurrencies, setAvailableCurrencies] = createSignal<PriceCurrency[]>([
    'usd',
    'eur',
    'tix',
  ])
  const [pricesDate, setPricesDate] = createSignal<string | null>(null)
  const [sellModeConfigured, setSellModeConfigured] = createSignal(false)
  const [uiLocale, setUiLocale] = createSignal<LocaleTag>(currentLocale())
  const [availableLocales, setAvailableLocales] = createSignal<LocaleTag[]>([DEFAULT_LOCALE])

  // The configured default currency is applied once; live refetches must not
  // clobber a currency the user has since picked.
  let currencyApplied = false
  // Same for the language: the index carries the site's baked default, and a
  // refetch must not undo a switch the user made since.
  let localeApplied = false

  const applyIndex = (data: SiteIndex): void => {
    // Batched: this runs from async contexts (no auto-batching), and consumers
    // deriving from several of these signals must never observe a half-applied
    // index between the individual writes.
    batch(() => {
      setDeckList(data.decks)
      setCollectionList(data.collections ?? [])
      setWantedListList(data.wantedLists ?? [])
      setUseScryfallImgUrls(data.useScryfallImgUrls)
      if (data.defaultCurrency && !currencyApplied) {
        setCurrency(data.defaultCurrency)
        currencyApplied = true
      }
      if (data.availableCurrencies) setAvailableCurrencies(data.availableCurrencies)
      if (data.pricesDate) setPricesDate(data.pricesDate)
      if (typeof data.searchDebounceMs === 'number') setSearchDebounceMs(data.searchDebounceMs)
      if (data.defaultLanguage) setDefaultLanguage(data.defaultLanguage)
      // Absent on sites built before locales existed, which reads as English-only.
      if (data.availableLocales && data.availableLocales.length > 0) {
        setAvailableLocales(data.availableLocales)
      }
      // Absent on sites built before sell mode existed, which reads as off.
      setSellModeConfigured(data.sellMode === true)
      // Absent on sites built before price sources existed, which reads as the
      // default (TCGplayer only). An explicit empty array hides all price UI.
      setEnabledPriceSources(data.priceSources)
    })
  }

  /**
   * Apply a locale to the runtime, the document, and the exposed signal, having
   * first made sure its dictionary is loaded.
   */
  const applyLocale = async (tag: LocaleTag, signal?: AbortSignal): Promise<LocaleTag> => {
    const usable = await ensureLocaleLoaded(tag, signal ? { signal } : undefined)
    setRuntimeLocale(usable)
    applyDocumentLocale(usable)
    setUiLocale(usable)
    return usable
  }

  /**
   * Resolve the boot locale from the index and the browser, and load its
   * dictionary — in the same batch as the index fetch, so there is no second
   * round trip before the first paint of translated text. English is inline in
   * the bundle and costs nothing here.
   */
  const bootLocale = async (data: SiteIndex, signal: AbortSignal): Promise<void> => {
    if (localeApplied) return
    localeApplied = true
    const resolved = resolveBrowserLocale({
      override: (globalThis as unknown as LocaleOverride).__ritualLocale__,
      query: localeFromHashQuery(),
      stored: readStoredLocale(),
      preferred: navigator.languages,
      configured: data.uiLocale,
      available: data.availableLocales ?? [DEFAULT_LOCALE],
    })
    await applyLocale(resolved, signal)
  }

  const switchLocale = async (tag: LocaleTag): Promise<LocaleTag> => {
    const applied = await applyLocale(tag)
    // What was applied, not what was asked for: if the dictionary could not be
    // fetched this remembers English, so the next load does not re-run a fetch
    // that just failed.
    writeStoredLocale(applied)
    return applied
  }

  const fetchIndex = async (url: string, signal?: AbortSignal): Promise<SiteIndex> => {
    const response = await fetch(url, signal ? { signal } : undefined)
    if (!response.ok) throw new Error(`Failed to load site data: HTTP ${response.status}`)
    return (await response.json()) as SiteIndex
  }

  const loadInitial = async (signal: AbortSignal): Promise<void> => {
    try {
      // The origin's own index: live when served by `serve --api` (which emits
      // apiBaseUrl: ''), baked on a static host.
      const data = await fetchIndex('index.json', signal)
      setApiBase(data.apiBaseUrl ?? null)
      if (data.apiBaseUrl) {
        // Split deployment: prefer the remote live index, keeping the baked
        // copy (and degrading to static behavior) when it is unreachable.
        try {
          const live = await fetchIndex(dataUrl('index.json'), signal)
          applyIndex(live)
          // Dictionaries are static assets of *this* origin even in a split
          // deployment, so only the locale *choice* comes from the live index.
          await bootLocale(live, signal)
          return
        } catch (e) {
          reportDataFetchError(e)
        }
      }
      applyIndex(data)
      await bootLocale(data, signal)
    } catch (e) {
      if (isAbortError(e)) return
      console.error('Failed to load index:', e)
      setDeckList([])
      setCollectionList([])
    }
  }

  // Monotonic token: overlapping refetches (route change + tab focus) must not
  // let a stale response overwrite a fresher one.
  let refetchToken = 0

  const refetch = (): void => {
    if (!apiActive()) return
    const token = ++refetchToken
    void fetchIndex(dataUrl('index.json'))
      .then((data) => {
        if (token === refetchToken) applyIndex(data)
      })
      .catch((e: unknown) => {
        if (token !== refetchToken) return
        // A dead remote backend degrades the whole app to the baked data; a
        // same-origin hiccup just keeps the data we already have.
        reportDataFetchError(e)
        if (apiBase() === '') console.error('Failed to refresh index:', e)
      })
  }

  // The printing pickers may quote printings on demand exactly while a live
  // backend is in use. Derived rather than set once at boot, so a configured
  // backend that later proves unreachable takes the pickers back to the baked
  // quotes with it instead of firing requests at a static host.
  createEffect(() => setBuylistQuotesOnline(apiActive()))

  onMount(() => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    void loadInitial(controller.signal)

    // Live mode: returning to a long-idle tab refreshes the summaries.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVisibility)
    onCleanup(() => document.removeEventListener('visibilitychange', onVisibility))
  })

  return {
    deckList,
    collectionList,
    wantedListList,
    useScryfallImgUrls,
    currency,
    setCurrency,
    availableCurrencies,
    pricesDate,
    // The configured flag alone: each list's detail carries its own baked
    // quotes, so sell mode needs no backend to answer for them.
    sellMode: sellModeConfigured,
    uiLocale,
    availableLocales,
    switchLocale,
    refetch,
  }
}
