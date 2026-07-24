import type { ScryfallCard } from '../types'
import type { CacheManager } from '../interfaces'
import { cardCache } from './instances'

/**
 * Scryfall-ID lookups over the card cache.
 *
 * The cache is keyed by card *name* and holds every printing under it, so there
 * is no direct path from a Scryfall ID to a card. This module keeps a lazily
 * built `id → card` index over the cached printings and memoizes it: building
 * costs one pass over the cache's values, which the file backend already holds
 * in memory (and the cache-server backend answers in one request), so a
 * per-request rebuild would be pure waste.
 *
 * The memo goes stale whenever a name is cached after it was built — most often
 * because `/api/card-printings` just fetched one. A lookup that misses therefore
 * rebuilds and retries, but at most once per {@link REBUILD_COOLDOWN_MS}, so a
 * caller asking repeatedly for an ID the cache genuinely doesn't hold can't turn
 * an unauthenticated endpoint into a rebuild loop. A rebuild already in flight
 * is shared rather than duplicated. Callers that replace the cache's contents
 * wholesale (the live site server, when the cache file changes on disk) should
 * {@link ScryfallIdIndex.reset} so the next lookup sees the new cards.
 *
 * Note this is a *Scryfall* ID (`ScryfallCard.id`), unrelated to the `&N` card
 * IDs that identify entries within a list file.
 */

const REBUILD_COOLDOWN_MS = 30_000

/** The slice of a cache this index reads — every cached name's printings. */
export type CardPrintingsSource = Pick<CacheManager<ScryfallCard[]>, 'values'>

export type ScryfallIdIndex = {
  /**
   * Resolve Scryfall IDs to cached cards. IDs the cache doesn't hold are simply
   * absent from the result — the caller decides whether that's an error.
   */
  lookup(ids: readonly string[]): Promise<Map<string, ScryfallCard>>
  /** Drop the memo so the next lookup rebuilds from the cache. */
  reset(): void
}

/**
 * An index over one cache. Each has its own memo, so an injected cache (tests)
 * can never be answered from another one's index.
 */
export function createScryfallIdIndex(
  cache: CardPrintingsSource,
  now: () => number = Date.now,
): ScryfallIdIndex {
  let index: Map<string, ScryfallCard> | null = null
  let builtAt = 0
  let building: Promise<Map<string, ScryfallCard>> | null = null

  const build = (): Promise<Map<string, ScryfallCard>> => {
    building ??= (async () => {
      const next = new Map<string, ScryfallCard>()
      for (const printings of await cache.values()) {
        for (const card of printings) next.set(card.id, card)
      }
      index = next
      // Stamped on completion, so a slow scan doesn't shorten the next cooldown.
      builtAt = now()
      return next
    })().finally(() => {
      building = null
    })
    return building
  }

  return {
    async lookup(ids: readonly string[]): Promise<Map<string, ScryfallCard>> {
      const found = new Map<string, ScryfallCard>()
      if (ids.length === 0) return found

      let current = index ?? (await build())
      const missing: string[] = []
      for (const id of ids) {
        const card = current.get(id)
        if (card) found.set(id, card)
        else missing.push(id)
      }
      if (missing.length === 0 || now() - builtAt < REBUILD_COOLDOWN_MS) return found

      // Something was cached after the index was built, or the IDs are unknown.
      current = await build()
      for (const id of missing) {
        const card = current.get(id)
        if (card) found.set(id, card)
      }
      return found
    },
    reset(): void {
      index = null
      builtAt = 0
    },
  }
}

/** The process-wide index over the shared card cache. */
export const scryfallIdIndex: ScryfallIdIndex = createScryfallIdIndex(cardCache)
