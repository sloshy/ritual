import type { ScryfallCard } from '../types'
import { cardPrintingKey } from '../printing-key'

/** Builds a set:collectorNumber → ScryfallCard lookup from a printings array. */
export function buildPrintingKeys(items: ScryfallCard[]): Record<string, ScryfallCard> {
  const result: Record<string, ScryfallCard> = {}
  for (const p of items) {
    result[cardPrintingKey(p)] = p
  }
  return result
}
