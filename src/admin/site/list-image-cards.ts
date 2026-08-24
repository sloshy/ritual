import type { DeckData, ScryfallCard } from '../../types'
import { formatPrintingAnnotation } from '../../change-event'
import { getCardImageUrl } from '../../card-image'
import { printingKey } from '../../printing-key'

/**
 * The rows the cover-image dialog's card picker offers, built from an editor's
 * *load* body.
 *
 * Deliberately not built from the live editor session: a card added while
 * editing is given its `&N` client-side and has no line on disk until the card
 * save runs, while the cover write goes out immediately — so pointing a cover at
 * one would write a reference the route refuses (and, if it did land, one that
 * names whatever card later claims that id). Building the rows where the load
 * body is in hand is what keeps that impossible.
 */

/** One card the cover can point at: the `&N` it writes, how it reads, what it looks like. */
export type ListImageCardOption = {
  /** The card line's persistent `&N` id — the value written as `image: {card: N}`. */
  cardId: number
  /** Name plus the printing annotation, with the set code uppercased. */
  label: string
  /** The card's own image, for the dialog's preview; absent when unresolved. */
  image?: string
}

/** The fields a card line and a flat-list entry both carry, as the picker reads them. */
export type ListImageCardSource = {
  name: string
  set?: string
  collectorNumber?: string
  cardId?: number
}

/** One row, or nothing when the line carries no id and so cannot be referenced. */
function optionFor(
  entry: ListImageCardSource,
  card: ScryfallCard | null | undefined,
): ListImageCardOption | undefined {
  if (entry.cardId === undefined) return undefined
  const image = card ? (getCardImageUrl(card) ?? undefined) : undefined
  const label = `${entry.name}${formatPrintingAnnotation(entry)}`
  return image === undefined
    ? { cardId: entry.cardId, label }
    : { cardId: entry.cardId, label, image }
}

/**
 * Disambiguate rows that read identically — four copies of one printing in a
 * collection produce four identical labels, and which `&N` is chosen genuinely
 * matters (removing *that* copy is what clears the cover). The id is appended in
 * the same `&N` spelling the file uses, and only where it is needed.
 */
function disambiguated(options: ListImageCardOption[]): ListImageCardOption[] {
  const counts = new Map<string, number>()
  for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1)
  return options.map((option) =>
    (counts.get(option.label) ?? 0) > 1
      ? { ...option, label: `${option.label} &${option.cardId}` }
      : option,
  )
}

/**
 * Picker rows for a flat list's entries, in file order — the order they appear
 * in the file and in the editor, which is also how the CLI's picker lists them.
 * Cards are keyed by printing (`set:cn`), the same key the collection and wanted
 * load bodies use.
 */
export function flatListImageCardOptions(
  entries: readonly ListImageCardSource[],
  cards: Record<string, ScryfallCard | null>,
): ListImageCardOption[] {
  const options: ListImageCardOption[] = []
  for (const entry of entries) {
    const key =
      entry.set && entry.collectorNumber ? printingKey(entry.set, entry.collectorNumber) : undefined
    const option = optionFor(entry, key === undefined ? null : cards[key])
    if (option) options.push(option)
  }
  return disambiguated(options)
}

/**
 * Picker rows for a deck, its sections walked in order. A deck load body keys
 * its cards by *name* rather than by printing, so the lookup differs from the
 * flat-list one even though the rows read identically.
 */
export function deckImageCardOptions(
  deck: DeckData,
  cards: Record<string, ScryfallCard | null>,
): ListImageCardOption[] {
  const options: ListImageCardOption[] = []
  for (const section of deck.sections) {
    for (const card of section.cards) {
      const option = optionFor(card, cards[card.name])
      if (option) options.push(option)
    }
  }
  return disambiguated(options)
}
