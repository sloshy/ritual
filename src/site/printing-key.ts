/**
 * The canonical `set:collectorNumber` key for one printing, lowercased so keys
 * built from a card entry (which stores set codes lowercase) and from a
 * `ScryfallCard` compare equal.
 */
export function printingKey(set: string, collectorNumber: string): string {
  return `${set.toLowerCase()}:${collectorNumber}`
}
