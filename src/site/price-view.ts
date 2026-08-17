/**
 * The client's price-view store: which stores this deployment offers prices
 * from, which USD source the user is looking at, and the one price-read helper
 * every source-aware surface goes through.
 *
 * Module-level (like `sell-mode` and `buylist-quotes`) rather than per-page:
 * the same printing must price the same everywhere, and the chosen source
 * survives in-SPA navigation. Both SPAs share it — the public site seeds
 * {@link setEnabledPriceSources} from `index.json`, the admin site from
 * `/api/config`.
 *
 * Only USD has a real choice (TCGplayer vs Card Kingdom retail); EUR is always
 * Cardmarket and tix is always Scryfall, so the store models exactly the one
 * axis that exists: {@link usdPriceSource}.
 */

import { batch, createSignal, type Accessor } from 'solid-js'
import { displayFinish } from '../finish-condition'
import { getCardPrice, getCardPriceForFinish, type PriceCurrency } from '../price-currency'
import {
  DEFAULT_PRICE_SOURCES,
  USD_PRICE_SOURCES,
  sourcesForCurrency,
  type PriceSource,
  type UsdPriceSource,
} from '../price-source'
import type { MessageKey } from '../i18n/messages/en'
import { quoteFor } from './buylist-quotes'
import type { Finish, ScryfallCard } from '../types'

// Re-exported so the site modules keep one import home for the choice axis.
export type { UsdPriceSource } from '../price-source'

/**
 * The store display names, as catalog keys — one table for the toolbar's
 * source selector and the admin Settings checkboxes, so a renamed key cannot
 * strand one of them on a dead entry.
 */
export const PRICE_SOURCE_LABELS = {
  tcgplayer: 'site.priceSource.tcgplayer',
  cardmarket: 'site.priceSource.cardmarket',
  cardkingdom: 'site.priceSource.cardkingdom',
} as const satisfies Record<PriceSource, MessageKey>

const [enabled, setEnabled] = createSignal<readonly PriceSource[]>([...DEFAULT_PRICE_SOURCES])

const [usdSource, setUsdSource] = createSignal<UsdPriceSource>('tcgplayer')

/**
 * Whether the user (or a shared URL) explicitly picked a USD source this
 * session. Sell mode's courtesy default (see {@link maybeDefaultSellSource} /
 * {@link maybeRestoreDefaultSource}) yields to an explicit choice and never
 * overrides one. A signal, not a plain flag: the URL-mirroring effect branches
 * on it before reading the source, so the flag itself must be able to re-run
 * that effect when a pick makes the source shareable.
 */
const [userPickedSource, setUserPickedSource] = createSignal(false)

/** The stores this deployment offers prices from. */
export const enabledPriceSources: Accessor<readonly PriceSource[]> = enabled

/**
 * Whether the site displays prices at all. False when the `priceSources`
 * config key is an explicit empty array — every price surface (per-card
 * prices, totals, price sort/filter/grouping, the currency selector) hides
 * itself on this one answer.
 */
export function pricesEnabled(): boolean {
  return enabled().length > 0
}

/**
 * The USD source a deployment falls back to: the first *enabled* USD store,
 * or TCGplayer when none is (prices are then read from Scryfall exactly as
 * before the feature existed). Resolving against what is enabled is what
 * makes a `priceSources: ['cardkingdom']` deployment actually read Card
 * Kingdom rather than silently pricing from a store it never enabled.
 */
function defaultUsdSource(): UsdPriceSource {
  return usdSourceChoices()[0] ?? 'tcgplayer'
}

/** Element-wise equality; the seed runs on every live index refetch. */
function sameSources(a: readonly PriceSource[], b: readonly PriceSource[]): boolean {
  return a.length === b.length && a.every((source, i) => source === b[i])
}

/**
 * Seed the enabled sources from the deployment's config (`index.json` on the
 * public site, `/api/config` on the admin). `undefined` — an index baked
 * before the feature existed — reads as the default. Identity-guarded: the
 * seed re-runs on every live index refetch (tab refocus, navigation), and an
 * unchanged list must not invalidate every price memo on the page. A
 * previously chosen USD source that is no longer enabled falls back to the
 * first enabled one.
 */
export function setEnabledPriceSources(sources: readonly PriceSource[] | undefined): void {
  const next = sources ? [...sources] : [...DEFAULT_PRICE_SOURCES]
  batch(() => {
    if (!sameSources(next, enabled())) setEnabled(next)
    // Resolved against `next` directly rather than re-reading the signal just
    // written, which is only sound because `batch` exposes pending writes.
    if (!next.includes(usdSource())) {
      setUsdSource(USD_PRICE_SOURCES.find((source) => next.includes(source)) ?? 'tcgplayer')
    }
  })
}

/** The USD source in force: the chosen one when it is enabled, else the deployment's default. */
export const activeUsdSource: Accessor<UsdPriceSource> = () => {
  const chosen = usdSource()
  return enabled().includes(chosen) ? chosen : defaultUsdSource()
}

/**
 * Whether the current USD source is an explicit choice (toolbar, shared URL)
 * rather than sell mode's courtesy default. The URL sync writes the source
 * only when this is true — a courtesy default must not be baked into a shared
 * link and then promoted to an explicit pick when the link is opened.
 */
export const usdSourceIsExplicit: Accessor<boolean> = userPickedSource

/** The USD sources the selector offers, in canonical order. */
export function usdSourceChoices(): UsdPriceSource[] {
  const current = enabled()
  return USD_PRICE_SOURCES.filter((source) => current.includes(source))
}

/**
 * Whether a currency has anywhere to read prices from under the enabled
 * sources: USD needs TCGplayer or Card Kingdom, EUR needs Cardmarket, and tix
 * (storeless by design) needs only prices to be on at all.
 */
export function currencyHasSource(currency: PriceCurrency): boolean {
  if (currency === 'tix') return pricesEnabled()
  return sourcesForCurrency(currency, enabled()).length > 0
}

/** The site's available currencies narrowed to the ones a source can answer for. */
export function offeredCurrencies(available: readonly PriceCurrency[]): PriceCurrency[] {
  return available.filter(currencyHasSource)
}

/**
 * Whether the toolbar offers a source choice at all: only USD has one, and
 * only when more than one USD store is enabled.
 */
export function offersUsdSourceChoice(currency: PriceCurrency): boolean {
  return currency === 'usd' && usdSourceChoices().length > 1
}

/**
 * Pick a USD source. `explicit` marks a deliberate choice (the toolbar
 * selector, a shared URL's param) that sell mode's courtesy default must not
 * override; the caller owns the epoch bump for a user click, exactly like the
 * currency selector.
 */
export function selectUsdSource(source: UsdPriceSource, explicit = true): void {
  batch(() => {
    if (explicit) setUserPickedSource(true)
    setUsdSource(source)
  })
}

/**
 * Entering sell mode defaults the USD view to Card Kingdom retail when it is
 * enabled — appraising what CK pays reads most naturally against what CK
 * charges — unless the user already picked a source, whose choice stands.
 */
export function maybeDefaultSellSource(): void {
  if (userPickedSource()) return
  if (enabled().includes('cardkingdom')) setUsdSource('cardkingdom')
}

/** Leaving sell mode undoes {@link maybeDefaultSellSource}, never a user's own pick. */
export function maybeRestoreDefaultSource(): void {
  if (userPickedSource()) return
  setUsdSource(defaultUsdSource())
}

/**
 * The price a source-aware surface displays for a printing+finish in a
 * currency.
 *
 * USD under the Card Kingdom source reads the buylist quote store's
 * `priceRetail` (0 when CK has no product for the printing — an honest N/A,
 * never a TCGplayer fallback; an out-of-stock product keeps its listed
 * price). Everything else reads Scryfall exactly as before. Reactive: it
 * reads the source signal and (on the CK path) the quote store, so a memo
 * calling it re-runs on a source switch and as quotes arrive.
 *
 * Deliberately Scryfall-only surfaces (do not "fix" them onto this helper):
 * the trade board, the printing pickers and the card modal's other-printings
 * grid (quotes exist only for the printings a list displays, so CK would read
 * 0 for nearly every row), the index page's baked summary totals, and the
 * deck page's lowest-price printing selection (baked per currency).
 */
export function sitePriceForFinish(
  card: ScryfallCard,
  finish: Finish,
  currency: PriceCurrency,
): number {
  if (currency === 'usd' && activeUsdSource() === 'cardkingdom') {
    return cardKingdomRetailFromQuotes(card, finish)
  }
  return getCardPriceForFinish(card, finish, currency)
}

/**
 * {@link sitePriceForFinish} for a card displayed with no finish token: the
 * Scryfall path reads {@link getCardPrice}'s base (nonfoil) quote exactly as
 * the pages did before sources existed, and the CK path quotes the printing's
 * default finish — the finish the bake requested for the same entry.
 */
export function sitePrice(card: ScryfallCard, currency: PriceCurrency): number {
  if (currency === 'usd' && activeUsdSource() === 'cardkingdom') {
    return cardKingdomRetailFromQuotes(card, undefined)
  }
  return getCardPrice(card, currency)
}

/**
 * Card Kingdom's NM retail for the printing at the finish a tile displays it,
 * read off the *quote store* — the client-side twin of `cardKingdomRetail` in
 * `src/cardkingdom/retail.ts`, which answers the same question against the feed
 * on the server. The two must agree; keep any change to one in step with the
 * other. The finish resolves through `displayFinish`, the
 * same rule `buylistRequestFor` applied when the quote was baked or requested
 * — the two must agree or the lookup misses a quote that is sitting there.
 */
function cardKingdomRetailFromQuotes(card: ScryfallCard, finish: Finish | undefined): number {
  const retail =
    quoteFor(card.set, card.collector_number, displayFinish(card, finish))?.priceRetail ?? 0
  return retail > 0 ? retail : 0
}

/** Reset to the default state. Intended for tests. */
export function resetPriceView(): void {
  batch(() => {
    setEnabled([...DEFAULT_PRICE_SOURCES])
    setUsdSource('tcgplayer')
    setUserPickedSource(false)
  })
}
