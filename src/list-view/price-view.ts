/**
 * The client's price-view store: which stores this deployment offers prices
 * from, which store the user is looking at, and the one price-read helper
 * every source-aware surface goes through.
 *
 * Module-level (like `sell-mode` and `buylist-quotes`) rather than per-page:
 * the same printing must price the same everywhere, and the chosen store
 * survives in-SPA navigation. Both SPAs share it — the public site seeds it
 * from `index.json`, the admin site from `/api/config` ({@link seedPriceView}).
 *
 * The store is the one choice: every store has exactly one currency, so the
 * currency in view is always derived ({@link activeCurrency}), never held.
 */

import { batch, createSignal, type Accessor } from 'solid-js'
import { displayFinish, type Finish } from '../card/finish-condition'
import { getCardPrice, getCardPriceForFinish, type PriceCurrency } from '../pricing/price-currency'
import {
  DEFAULT_PRICE_SOURCE,
  DEFAULT_PRICE_SOURCES,
  USD_PRICE_SOURCES,
  isUsdPriceSource,
  orderedPriceSources,
  sourceCurrency,
  type PriceSource,
  type UsdPriceSource,
} from '../pricing/price-source'
import { isNonEnglishCard, quoteFor } from './buylist-quotes'
import { sellModeActive } from './sell-mode'
import type { ScryfallCard } from '../scryfall/types'

// Re-exported so the site modules keep one import home for the choice axis.
export type { UsdPriceSource } from '../pricing/price-source'

const [enabled, setEnabled] = createSignal<readonly PriceSource[]>([...DEFAULT_PRICE_SOURCES])

/** The deployment's configured default store (`defaultPriceSource`). */
const [defaultSource, setDefaultSource] = createSignal<PriceSource>(DEFAULT_PRICE_SOURCE)

/**
 * The store the user (or a shared URL) picked on purpose this session; null
 * until then, when the view follows the configured default. The one "user
 * picked" fact both SPAs read: a re-seed never overrides it, and sell mode's
 * courtesy default yields to it.
 */
const [pickedStore, setPickedStore] = createSignal<PriceSource | null>(null)

/**
 * Whether the site displays prices at all. False when the `priceSources`
 * config key is an explicit empty array — every price surface (per-card
 * prices, totals, price sort/filter/grouping, the header's store picker) hides
 * itself on this one answer.
 */
export function pricesEnabled(): boolean {
  return enabled().length > 0
}

/** Element-wise equality; the seed runs on every live index refetch. */
function sameSources(a: readonly PriceSource[], b: readonly PriceSource[]): boolean {
  return a.length === b.length && a.every((source, i) => source === b[i])
}

/**
 * Seed the enabled stores. `undefined` reads as the default. Identity-guarded:
 * the seed re-runs on every live index refetch (tab refocus, navigation), and
 * an unchanged list must not invalidate every price memo on the page.
 */
function setEnabledPriceSources(sources: readonly PriceSource[] | undefined): void {
  const next = sources ? [...sources] : [...DEFAULT_PRICE_SOURCES]
  if (!sameSources(next, enabled())) setEnabled(next)
}

/** What a deployment offers: its stores and the one it opens on. */
export type PriceViewSeed = {
  stores: readonly PriceSource[]
  defaultSource: PriceSource
}

/**
 * Seed the view from the deployment's config (`index.json` on the public site,
 * `/api/config` on the admin). Safe to re-run on every fetch: it only ever
 * moves the view when nothing was picked, and a pick survives it.
 */
export function seedPriceView(seed: PriceViewSeed): void {
  batch(() => {
    setEnabledPriceSources(seed.stores)
    setDefaultSource(seed.defaultSource)
  })
}

/** The stores the header's picker offers: every enabled store, in picker order. */
export function offeredPriceSources(): PriceSource[] {
  return orderedPriceSources(enabled())
}

/**
 * The store every price in view comes from:
 *
 * - the user's pick, while it is offered — or, when a changed store list took
 *   it away, another offered store in the same currency;
 * - otherwise the configured default when offered, else the first offered
 *   store — except that sell mode switches a USD default to Card Kingdom
 *   retail (when offered), so the offer sits beside what CK charges. A
 *   non-USD view is left alone: sell mode never changes the currency.
 */
export const activeStore: Accessor<PriceSource> = () => {
  const offered = offeredPriceSources()
  const picked = offeredPick(offered)
  if (picked !== null) return picked
  const configured = defaultSource()
  const opening = offered.includes(configured) ? configured : (offered[0] ?? configured)
  // Read straight off the global mode, not relayed through a page effect, so
  // the store switches in the same pass as the mode — one rebuild, not two.
  if (sellModeActive() && isUsdPriceSource(opening) && offered.includes('cardkingdom')) {
    return 'cardkingdom'
  }
  return opening
}

/**
 * The user's pick as this deployment can honour it: the pick when offered,
 * else an offered store in the same currency, else null. A pick for a store
 * with no offered sibling (a link built for another deployment) is no pick at
 * all — it neither suppresses sell mode's courtesy default nor makes the view
 * explicit, so the URL sync never bakes the fallback into the link.
 */
function offeredPick(offered: readonly PriceSource[]): PriceSource | null {
  const picked = pickedStore()
  if (picked === null || offered.includes(picked)) return picked
  return offered.find((source) => sourceCurrency(source) === sourceCurrency(picked)) ?? null
}

/** The currency in view: the active store's one currency. */
export const activeCurrency: Accessor<PriceCurrency> = () => sourceCurrency(activeStore())

/**
 * The USD store in force: the active store when it is a USD one, else the USD
 * store a dollar comparison (sell mode's spread) reads while EUR or tix is in
 * view — the configured default when it is an offered USD store, else the
 * first offered one, else TCGplayer.
 */
export const activeUsdSource: Accessor<UsdPriceSource> = () => {
  const store = activeStore()
  if (isUsdPriceSource(store)) return store
  const configured = defaultSource()
  if (isUsdPriceSource(configured) && enabled().includes(configured)) return configured
  return usdSourceChoices()[0] ?? 'tcgplayer'
}

/**
 * Whether the store in view is an explicit choice (the header's picker, a
 * dialog's selector, a shared URL) rather than the default or sell mode's
 * courtesy default. The URL sync writes the store only then — a default must
 * not be baked into a shared link and promoted to a pick when it is opened.
 */
export const storeIsExplicit: Accessor<boolean> = () => offeredPick(offeredPriceSources()) !== null

/**
 * Pick a store on purpose. The caller owns the currency-epoch bump for a user
 * click (see `pickPriceStore`); a shared URL's pick does not bump it.
 */
export function selectStore(source: PriceSource): void {
  setPickedStore(source)
}

/** The USD stores a dialog's USD-store selector offers, in canonical order. */
export function usdSourceChoices(): UsdPriceSource[] {
  const current = enabled()
  return USD_PRICE_SOURCES.filter((source) => current.includes(source))
}

/**
 * Whether a dialog offers a USD-store choice at all: only while USD is in
 * view, and only when more than one USD store is enabled.
 */
export function offersUsdSourceChoice(currency: PriceCurrency): boolean {
  return currency === 'usd' && usdSourceChoices().length > 1
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
 * The printing pickers and the card modal's other-printings grid *do* go
 * through this, and are the reason quotes exist for printings no list displays:
 * a build with the CK source enabled bakes every printing a list carries, and a
 * live backend quotes the rest on demand (`printing-quotes.ts`). A printing the
 * buyer has no product for still reads 0 — an honest N/A beside the finishes
 * they do stock.
 *
 * Surfaces that do not go through this helper: the trade board's own
 * valuations and the deck page's lowest-price printing selection stay Scryfall
 * (baked per currency), and the index page's summary totals read figures baked
 * per store instead (`getSummaryTotalPrice` at {@link activeStore}).
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
  // A buyer's feed is English-only and keyed by `set:cn`, which an
  // alternate-language object *shares* with its English twin — so reading a
  // quote for one would price a Japanese card at the English offer. The write
  // side (`buylistRequestFor`) has always refused to ask for them; the read side
  // must refuse to answer, now that the printing grid and the pickers render one
  // row per language and would otherwise show the twin's money on every one.
  if (isNonEnglishCard(card)) return 0
  const retail =
    quoteFor(card.set, card.collector_number, displayFinish(card, finish))?.priceRetail ?? 0
  return retail > 0 ? retail : 0
}

/** Reset to the default state. Intended for tests. */
export function resetPriceView(): void {
  batch(() => {
    setEnabled([...DEFAULT_PRICE_SOURCES])
    setDefaultSource(DEFAULT_PRICE_SOURCE)
    setPickedStore(null)
  })
}
