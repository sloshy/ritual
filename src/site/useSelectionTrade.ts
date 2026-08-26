import type { ScryfallCard } from '../scryfall/types'
import type { PriceCurrency } from '../pricing/price-currency'
import type { SelectedCard, SelectionSourceKind } from '../list-view/useCardSelection'
import type { TradeSearchEntry } from './useTradeData'
import { normalizeCardName } from '../card/term-match'
import { t } from '../i18n/t'
import {
  addEntryToLeft,
  addEntryToRight,
  canAddMoreToLeft,
  canAddMoreToRight,
  showTradeToast,
} from './useTradeState'
import { resolveCardThumbnailUrl } from '../card/image-sources'
import { pickedPrintingLanguage, promptForPrinting } from '../list-view/printing-prompt'
import { confirmKeepAdd } from './keep-trade-prompt'

/**
 * Bulk "Add to Trade" for a card selection, shared by the per-list toolbar menu
 * and the cross-list navbar menu. Cards pinned to a specific printing are added
 * straight away; name-only cards (deck/wanted entries that accept any printing)
 * are prompted one at a time via the shared {@link promptForPrinting} picker, just
 * like the single-card flow.
 */

/** The board column a source kind trades on: how to add to it, and whether one more fits. */
type TradeSide = {
  add: (entry: TradeSearchEntry, currency: PriceCurrency) => boolean
  canAdd: (entry: TradeSearchEntry) => boolean
}

/**
 * Which side of the board each source kind lands on: a wanted card is being
 * *received*, everything else is being offered. A table rather than a
 * `=== 'wanted'` ternary so the add path and the availability check cannot
 * disagree, and so a fourth source kind is a compile error here instead of
 * silently defaulting to the offering column.
 */
const TRADE_SIDES = {
  collection: { add: addEntryToLeft, canAdd: canAddMoreToLeft },
  deck: { add: addEntryToLeft, canAdd: canAddMoreToLeft },
  wanted: { add: addEntryToRight, canAdd: canAddMoreToRight },
} as const satisfies Record<SelectionSourceKind, TradeSide>

const cardHasPrinting = (card: SelectedCard): boolean => Boolean(card.set && card.collectorNumber)

/**
 * The trade row a selected tile becomes. Exported so a caller holding a
 * {@link SelectedCard} — the combined/search views' per-tile "+" button — can ask
 * whether another copy still fits before offering the action.
 */
export function tradeEntryFor(card: SelectedCard): TradeSearchEntry {
  return {
    name: card.name,
    nameKey: normalizeCardName(card.name),
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
    language: card.language,
    labels: card.labels,
    // The board shows the real printing either way — it is the card being handed
    // over — but a proxy and a custom-art copy carry no price, and the rule has
    // to travel with them or the row is valued at the printing's retail.
    customArt: card.customArt,
    hasCustomArt: card.hasCustomArt,
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
  const { add } = TRADE_SIDES[entry.sourceKind]
  let added = 0
  for (let i = 0; i < qty; i++) {
    if (!add(entry, currency)) break
    added += 1
  }
  return added
}

/** Everything an add needs beyond the cards themselves. */
export type TradeAddOptions = {
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Toast this name instead of the copy count — the single-card add. */
  toastName?: string
}

/**
 * Add a selection to the active trade, prompting for a printing on each name-only
 * card in sequence. Returns the number of copies actually added. Shows a single
 * summary toast — or, when `toastName` is given (the single-card add), that name
 * instead of the count.
 */
export async function addSelectionToTrade(
  cards: SelectedCard[],
  { currency, useScryfallImgUrls, toastName }: TradeAddOptions,
): Promise<number> {
  let added = 0
  let firstAddedCard: ScryfallCard | null = null

  const noteAdd = (count: number, card: ScryfallCard | null) => {
    if (count > 0 && firstAddedCard === null) firstAddedCard = card
    added += count
  }

  for (const card of cards) {
    // Keep-labeled cards confirm before their first-ever trade add. The prompt
    // serializes with the printing prompts below, and the first confirmation in
    // a batch acknowledges the dialog for the rest (the decided semantics).
    // Wanted cards go to the *receiving* side and never carry labels.
    if (card.sourceKind !== 'wanted' && !(await confirmKeepAdd(card.name, card.labels))) continue
    if (cardHasPrinting(card)) {
      noteAdd(addCopies(tradeEntryFor(card), card.quantity, currency), card.scryfallCard)
      continue
    }
    const picked = await promptForPrinting(card.name, card.printings ?? [])
    if (!picked) continue
    const entry: TradeSearchEntry = {
      ...tradeEntryFor(card),
      set: picked.printing.set.toLowerCase(),
      collectorNumber: picked.printing.collector_number,
      finish: picked.finish,
      // A picked alternate-language object stamps its language on the row.
      language: pickedPrintingLanguage(picked.printing),
      scryfallCard: picked.printing,
    }
    noteAdd(addCopies(entry, card.quantity, currency), picked.printing)
  }

  if (added > 0) {
    showTradeToast(
      toastName ?? t('site.trade.added', { count: added }),
      resolveCardThumbnailUrl(firstAddedCard, useScryfallImgUrls),
    )
  }
  return added
}

/**
 * Whether another copy of a selected tile still fits on its trade side. Asks
 * about the very entry {@link addSelectedCardToTrade} would add, through the
 * same {@link TRADE_SIDES} row, so the disabled state and the add outcome
 * cannot disagree.
 */
export function canAddSelectedCardToTrade(card: SelectedCard): boolean {
  const entry = tradeEntryFor(card)
  return TRADE_SIDES[entry.sourceKind].canAdd(entry)
}

/**
 * Add a single copy of one selected tile to the trade — the per-tile "+" button
 * on the combined and search-results views, where the tile is a
 * {@link SelectedCard} rather than a list-specific entry. Reuses the selection
 * path so the keep-guard and the name-only printing prompt behave identically,
 * and toasts the card name like the single-list pages do.
 */
export function addSelectedCardToTrade(
  card: SelectedCard,
  options: Omit<TradeAddOptions, 'toastName'>,
): Promise<number> {
  return addSelectionToTrade([{ ...card, quantity: 1 }], { ...options, toastName: card.name })
}
