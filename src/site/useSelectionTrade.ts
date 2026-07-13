import type { ScryfallCard } from '../types'
import type { PriceCurrency } from '../price-currency'
import type { SelectedCard } from './useCardSelection'
import type { TradeSearchEntry } from './useTradeData'
import { normalizeCardName } from '../term-match'
import { addEntryToLeft, addEntryToRight, showTradeToast } from './useTradeState'
import { resolveCardThumbnailUrl } from './image-sources'
import { promptForPrinting } from './printing-prompt'

/**
 * Bulk "Add to Trade" for a card selection, shared by the per-list toolbar menu
 * and the cross-list navbar menu. Cards pinned to a specific printing are added
 * straight away; name-only cards (deck/wanted entries that accept any printing)
 * are prompted one at a time via the shared {@link promptForPrinting} picker, just
 * like the single-card flow.
 */

const sideAdder = (kind: SelectedCard['sourceKind']) =>
  kind === 'wanted' ? addEntryToRight : addEntryToLeft

const cardHasPrinting = (card: SelectedCard): boolean => Boolean(card.set && card.collectorNumber)

function baseEntry(card: SelectedCard): TradeSearchEntry {
  return {
    name: card.name,
    nameKey: normalizeCardName(card.name),
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
    note: card.note,
    price: card.price,
    scryfallCard: card.scryfallCard,
    sourceName: card.sourceName,
    sourceKind: card.sourceKind,
    maxQty: card.maxQty,
    cardIds: card.cardIds,
  }
}

/** Add up to `qty` copies of `entry` to its trade side, stopping when capped. Returns the count added. */
function addCopies(entry: TradeSearchEntry, qty: number, currency: PriceCurrency): number {
  const add = sideAdder(entry.sourceKind)
  let added = 0
  for (let i = 0; i < qty; i++) {
    if (!add(entry, currency)) break
    added += 1
  }
  return added
}

/**
 * Add a selection to the active trade, prompting for a printing on each name-only
 * card in sequence. Returns the number of copies actually added. Shows a single
 * summary toast.
 */
export async function addSelectionToTrade(
  cards: SelectedCard[],
  currency: PriceCurrency,
  useScryfallImgUrls: boolean,
): Promise<number> {
  let added = 0
  let firstAddedCard: ScryfallCard | null = null

  const noteAdd = (count: number, card: ScryfallCard | null) => {
    if (count > 0 && firstAddedCard === null) firstAddedCard = card
    added += count
  }

  for (const card of cards) {
    if (cardHasPrinting(card)) {
      noteAdd(addCopies(baseEntry(card), card.quantity, currency), card.scryfallCard)
      continue
    }
    const picked = await promptForPrinting(card.name, card.printings ?? [])
    if (!picked) continue
    const entry: TradeSearchEntry = {
      ...baseEntry(card),
      set: picked.printing.set.toLowerCase(),
      collectorNumber: picked.printing.collector_number,
      finish: picked.finish,
      scryfallCard: picked.printing,
    }
    noteAdd(addCopies(entry, card.quantity, currency), picked.printing)
  }

  if (added > 0) {
    showTradeToast(
      `Added ${added} card${added > 1 ? 's' : ''} to trade`,
      resolveCardThumbnailUrl(firstAddedCard, useScryfallImgUrls),
    )
  }
  return added
}
