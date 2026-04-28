import { createSignal } from 'solid-js'
import type { TradeCardEntry } from './data-types'
import type { PriceCurrency } from '../price-currency'
import type { TradeSearchEntry } from './useTradeData'
import { getCardPriceForFinish } from '../price-currency'
import { resolveTradeFinish } from './trade-finish'

// Module-level signals survive page navigation within the same tab.
const [leftCards, setLeftCards] = createSignal<TradeCardEntry[]>([])
const [rightCards, setRightCards] = createSignal<TradeCardEntry[]>([])

type TradeToast = { name: string; imageUrl: string | null; id: number }
const [tradeToast, setTradeToast] = createSignal<TradeToast | null>(null)
let _toastTimer: ReturnType<typeof setTimeout> | null = null
let _toastId = 0

export function showTradeToast(name: string, imageUrl: string | null): void {
  if (_toastTimer !== null) clearTimeout(_toastTimer)
  setTradeToast({ name, imageUrl, id: ++_toastId })
  _toastTimer = setTimeout(() => {
    setTradeToast(null)
    _toastTimer = null
  }, 2500)
}

/**
 * Returns the total qty already in `cards` that share at least one source card ID with `entry`.
 * Returns -1 when neither side has card IDs (no reliable identity to compare).
 */
function totalQtyByCardIds(cards: TradeCardEntry[], entry: TradeSearchEntry): number {
  if (entry.cardIds.length === 0) return -1
  return cards
    .filter(
      (c) =>
        c.source === entry.sourceKind &&
        c.sourceName === entry.sourceName &&
        c.sourceCardIds !== undefined &&
        c.sourceCardIds.some((id) => entry.cardIds.includes(id)),
    )
    .reduce((sum, c) => sum + c.qty, 0)
}

function matchesTradeEntry(c: TradeCardEntry, entry: TradeSearchEntry): boolean {
  return (
    c.name === entry.name &&
    c.set === entry.set &&
    c.collectorNumber === entry.collectorNumber &&
    c.finish === resolveTradeFinish(entry.scryfallCard, entry.finish) &&
    c.condition === entry.condition &&
    c.note === entry.note &&
    c.source === entry.sourceKind &&
    c.sourceName === entry.sourceName
  )
}

function tradeCardFromEntry(entry: TradeSearchEntry, currency: PriceCurrency): TradeCardEntry {
  const finish = resolveTradeFinish(entry.scryfallCard, entry.finish)
  const price = entry.scryfallCard
    ? getCardPriceForFinish(entry.scryfallCard, finish, currency)
    : (entry.price ?? 0)
  return {
    name: entry.name,
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish,
    condition: entry.condition,
    note: entry.note,
    price,
    scryfallCard: entry.scryfallCard,
    source: entry.sourceKind,
    sourceName: entry.sourceName,
    qty: 1,
    maxQty: entry.sourceKind === 'wanted' ? undefined : entry.maxQty,
    editable: entry.editable,
    sourceCardIds: entry.cardIds,
  }
}

export function canAddMoreToLeft(entry: TradeSearchEntry): boolean {
  const existing = leftCards().find((c) => matchesTradeEntry(c, entry))
  if (existing) {
    if (existing.maxQty === undefined) return true
    return existing.qty < existing.maxQty
  }
  if (entry.maxQty !== undefined) {
    const byId = totalQtyByCardIds(leftCards(), entry)
    if (byId >= 0 && byId >= entry.maxQty) return false
  }
  return true
}

export function canAddMoreToRight(entry: TradeSearchEntry): boolean {
  const existing = rightCards().find((c) => matchesTradeEntry(c, entry))
  if (existing) {
    if (existing.maxQty === undefined) return true
    return existing.qty < existing.maxQty
  }
  if (entry.maxQty !== undefined) {
    const byId = totalQtyByCardIds(rightCards(), entry)
    if (byId >= 0 && byId >= entry.maxQty) return false
  }
  return true
}

function isAlreadyInList(cards: TradeCardEntry[], entry: TradeSearchEntry): boolean {
  if (cards.some((c) => matchesTradeEntry(c, entry))) return true
  if (entry.cardIds.length > 0) {
    return cards.some(
      (c) =>
        c.source === entry.sourceKind &&
        c.sourceName === entry.sourceName &&
        c.sourceCardIds !== undefined &&
        c.sourceCardIds.some((id) => entry.cardIds.includes(id)),
    )
  }
  return false
}

export function isAlreadyInLeftList(entry: TradeSearchEntry): boolean {
  return isAlreadyInList(leftCards(), entry)
}

export function isAlreadyInRightList(entry: TradeSearchEntry): boolean {
  return isAlreadyInList(rightCards(), entry)
}

/** Attempts to add an entry to the left (offering) side. Returns true if added or incremented. */
export function addEntryToLeft(entry: TradeSearchEntry, currency: PriceCurrency): boolean {
  let added = false
  setLeftCards((prev) => {
    const existing = prev.find((c) => matchesTradeEntry(c, entry))
    if (existing) {
      const cap = existing.maxQty ?? Infinity
      if (existing.qty >= cap) return prev
      added = true
      return prev.map((c) => (c === existing ? { ...c, qty: Math.min(cap, c.qty + 1) } : c))
    }
    if (entry.maxQty !== undefined) {
      const byId = totalQtyByCardIds(prev, entry)
      if (byId >= 0 && byId >= entry.maxQty) return prev
    }
    added = true
    return [...prev, tradeCardFromEntry(entry, currency)]
  })
  return added
}

/** Attempts to add an entry to the right (receiving) side. Returns true if added or incremented. */
export function addEntryToRight(entry: TradeSearchEntry, currency: PriceCurrency): boolean {
  let added = false
  setRightCards((prev) => {
    const existing = prev.find((c) => matchesTradeEntry(c, entry))
    if (existing) {
      const cap = existing.maxQty ?? Infinity
      if (existing.qty >= cap) return prev
      added = true
      return prev.map((c) => (c === existing ? { ...c, qty: Math.min(cap, c.qty + 1) } : c))
    }
    if (entry.maxQty !== undefined) {
      const byId = totalQtyByCardIds(prev, entry)
      if (byId >= 0 && byId >= entry.maxQty) return prev
    }
    added = true
    return [...prev, tradeCardFromEntry(entry, currency)]
  })
  return added
}

export { leftCards, setLeftCards, rightCards, setRightCards, tradeToast }
