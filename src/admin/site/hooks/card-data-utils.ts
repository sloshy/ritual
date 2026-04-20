import type { ScryfallCard } from '../../../types'

/** Builds a set:collectorNumber → ScryfallCard lookup from a printings array. */
export function buildPrintingKeys(items: ScryfallCard[]): Record<string, ScryfallCard> {
  const result: Record<string, ScryfallCard> = {}
  for (const p of items) {
    result[`${p.set}:${p.collector_number}`] = p
  }
  return result
}
