import type { ScryfallCard } from '../types'
import { scryfallCardLanguage } from '../card-language'
import { cardPrintingKey, printingLanguageKey } from '../printing-key'

/**
 * Index one card object into a printing-keyed `cards` map. English objects own
 * the plain `set:cn` slot; a foreign-language object goes under its
 * {@link printingLanguageKey} (`set:cn@lang`) and only claims the plain slot
 * when nothing holds it yet (a printing that exists in no other language must
 * still resolve art and price by its plain key). An English object always wins
 * the plain slot back from such a fallback, whatever order the list arrived in.
 */
export function indexPrintingCard(
  result: Record<string, ScryfallCard | null>,
  card: ScryfallCard,
): void {
  const plainKey = cardPrintingKey(card)
  const language = scryfallCardLanguage(card)
  if (language === 'en') {
    result[plainKey] = card
    return
  }
  result[printingLanguageKey(card.set, card.collector_number, language)] = card
  if (!Object.hasOwn(result, plainKey)) result[plainKey] = card
}

/** Builds a set:collectorNumber(@lang) → ScryfallCard lookup from a printings array. */
export function buildPrintingKeys(items: ScryfallCard[]): Record<string, ScryfallCard> {
  const result: Record<string, ScryfallCard> = {}
  for (const p of items) {
    indexPrintingCard(result, p)
  }
  return result
}
