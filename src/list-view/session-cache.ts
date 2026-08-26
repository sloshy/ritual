import { createSignal, type Accessor } from 'solid-js'
import type { ScryfallCard } from '../scryfall/types'

/**
 * In-memory, per-tab Scryfall cache for the serverless public site.
 *
 * Two jobs:
 *  - **Avoid redundant network calls.** Card data already shipped in the baked
 *    deck/collection/wanted JSON (seeded here) is preferred over a fresh Scryfall
 *    request, and anything fetched during the session is reused afterwards — by the
 *    list editors' card search and by the trade page's browser search alike.
 *  - **Track price freshness.** Seeded cards carry `updatedAt: null` (their prices
 *    are as old as the static build); cards re-fetched via "Update Prices" carry the
 *    epoch-ms time of that fetch. The staleness disclaimer reads these to point out
 *    cards whose prices predate the latest in-session refresh.
 *
 * State is module-level (one cache per loaded tab) and never persisted. A reactive
 * {@link sessionCacheVersion} bumps on every session fetch so consumers re-derive
 * prices. The cache holds no effects/memos, so module-scope signals are safe.
 */
type CacheEntry = {
  card: ScryfallCard
  /** null = from the static build; number = epoch-ms of an in-session refresh. */
  updatedAt: number | null
}

const byId = new Map<string, CacheEntry>()
const printingsByName = new Map<string, ScryfallCard[]>()
const [version, setVersion] = createSignal(0)

/** Reactive counter that increments whenever fresh data is fetched this session. */
export const sessionCacheVersion: Accessor<number> = version

/** Seed a single baked card (does not overwrite a fresher session-fetched entry). */
export function seedCard(card: ScryfallCard | null | undefined): void {
  if (!card) return
  if (!byId.has(card.id)) byId.set(card.id, { card, updatedAt: null })
}

/** Seed the baked `cards` map shipped with a list's JSON. */
export function seedCards(cards: Record<string, ScryfallCard | null>): void {
  for (const card of Object.values(cards)) seedCard(card)
}

/** Seed the baked `printings` map (and each printing as a card). */
export function seedPrintings(printings: Record<string, ScryfallCard[]>): void {
  for (const [name, list] of Object.entries(printings)) {
    if (list.length > 0 && !printingsByName.has(name)) printingsByName.set(name, list)
    for (const card of list) seedCard(card)
  }
}

/** The cached card for a Scryfall id, preferring session-fetched over baked data. */
export function getCardById(id: string): ScryfallCard | undefined {
  return byId.get(id)?.card
}

/** When the cached card was last refreshed: a timestamp, `null` (baked), or `undefined` (absent). */
export function getUpdatedAt(id: string): number | null | undefined {
  const entry = byId.get(id)
  return entry ? entry.updatedAt : undefined
}

/** Cached printings for an exact card name, if known this session. */
export function getPrintingsByName(name: string): ScryfallCard[] | undefined {
  return printingsByName.get(name)
}

/**
 * Replace a card with its fresher session-cached version (matched by Scryfall id),
 * if one exists. Null/undefined pass through. NOT reactive on its own — read
 * {@link sessionCacheVersion} in the surrounding memo to re-overlay after a refresh.
 */
export function overlayCard<T extends ScryfallCard | null | undefined>(card: T): T {
  if (!card) return card
  return (getCardById(card.id) ?? card) as T
}

/** Record session-fetched cards (fresh prices) at time `at`, overwriting baked entries. */
export function putFetchedCards(cards: Iterable<ScryfallCard>, at: number): void {
  let changed = false
  for (const card of cards) {
    byId.set(card.id, { card, updatedAt: at })
    changed = true
  }
  if (changed) setVersion((v) => v + 1)
}

/** Record session-fetched printings for a name (and the cards), bumping the version. */
export function putFetchedPrintings(name: string, cards: ScryfallCard[], at: number): void {
  if (cards.length > 0) printingsByName.set(name, cards)
  putFetchedCards(cards, at)
}

/** Clear all cached data. Test-only — production never resets within a session. */
export function resetSessionCache(): void {
  byId.clear()
  printingsByName.clear()
  setVersion(0)
}
