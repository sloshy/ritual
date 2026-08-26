import type { Finish } from '../card/finish-condition'
import type { ScryfallCard } from '../scryfall/types'

export const FINISH_PRIORITY: readonly Finish[] = ['nonfoil', 'foil', 'etched']

export function asFinish(value: string | undefined): Finish | undefined {
  return value === 'nonfoil' || value === 'foil' || value === 'etched' ? value : undefined
}

/**
 * Pick the default finish for a printing in the order: nonfoil > foil > etched.
 * Falls back to the printing's first listed finish, then 'nonfoil' if no scryfall data is available.
 */
export function defaultFinishForCard(card: ScryfallCard | null): Finish {
  const finishes = card?.finishes ?? []
  for (const pref of FINISH_PRIORITY) {
    if (finishes.includes(pref)) return pref
  }
  return asFinish(finishes[0]) ?? 'nonfoil'
}

/**
 * Resolve a (possibly-missing or invalid) finish against a printing's available finishes.
 * Returns the requested finish if the printing supports it; otherwise the default per priority.
 */
export function resolveTradeFinish(card: ScryfallCard | null, requested?: string): Finish {
  const requestedFinish = asFinish(requested)
  const finishes = card?.finishes ?? []
  if (requestedFinish && finishes.includes(requestedFinish)) return requestedFinish
  if (requestedFinish && finishes.length === 0) return requestedFinish
  return defaultFinishForCard(card)
}
