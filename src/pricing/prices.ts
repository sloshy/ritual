import { isPriceCurrency, type PriceCurrency } from './money-format'

/** A price cache key read into its card name and currency. */
export type PriceCacheKey = { ok: true; cardName: string; currency: PriceCurrency }

/** A key with no `:<currency>` suffix at all. */
export type PriceCacheKeyMissingCurrency = { ok: false; problem: 'missing-currency' }

/** A key whose suffix names no currency Ritual prices in (compared case-sensitively). */
export type PriceCacheKeyUnknownCurrency = {
  ok: false
  problem: 'unknown-currency'
  suffix: string
}

/**
 * A parsed price cache key, or why it could not be read. The refusal is a code,
 * not a sentence: the cache server only skips such a key (an entry it cannot
 * schedule or refresh) and never shows the refusal to anyone.
 */
export type ParsePriceCacheKeyResult =
  PriceCacheKey | PriceCacheKeyMissingCurrency | PriceCacheKeyUnknownCurrency

/** Parse a stored price cache key (`<card name>:<currency>`) into card name and currency. */
export function parsePriceCacheKey(key: string): ParsePriceCacheKeyResult {
  const lastColon = key.lastIndexOf(':')
  if (lastColon === -1) return { ok: false, problem: 'missing-currency' }
  const suffix = key.slice(lastColon + 1)
  if (isPriceCurrency(suffix)) {
    return { ok: true, cardName: key.slice(0, lastColon), currency: suffix }
  }
  return { ok: false, problem: 'unknown-currency', suffix }
}
