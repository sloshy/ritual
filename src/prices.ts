import type { PriceCurrency } from './price-currency'

export type ParsePriceCacheKeyResult =
  | { ok: true; cardName: string; currency: PriceCurrency }
  | { ok: false; error: string }

/** Parse a stored price cache key (`<card name>:<currency>`) into card name and currency. */
export function parsePriceCacheKey(key: string): ParsePriceCacheKeyResult {
  const lastColon = key.lastIndexOf(':')
  if (lastColon === -1) return { ok: false, error: `Cache key '${key}' is missing currency suffix` }
  const suffix = key.slice(lastColon + 1)
  if (suffix === 'usd' || suffix === 'eur' || suffix === 'tix') {
    return { ok: true, cardName: key.slice(0, lastColon), currency: suffix }
  }
  return { ok: false, error: `Cache key '${key}' has unknown currency suffix '${suffix}'` }
}
