import { createSignal, type Accessor } from 'solid-js'
import type { Finish, Condition } from '../card/finish-condition'
import type { ScryfallCard } from '../scryfall/types'
import type { CardLabel } from '../card/card-labels'
import { isPricelessCard } from './priceless'
import type { CardLanguage } from '../card/card-language'
import { getCardPriceForFinish, type PriceCurrency } from '../pricing/price-currency'

/**
 * A single card chosen via the list-page multi-select. Carries everything the
 * selection actions need: text/CSV serialization (name, printing, finish,
 * condition, quantity) and trade insertion (scryfall card, source identity,
 * card IDs, max quantity, and — for name-only entries — the printings to prompt
 * from). Set codes are stored lowercase, like everywhere internally; the export
 * formatters uppercase them.
 */
export interface SelectedCard {
  /** Globally-unique key (list identity + per-tile id) — see {@link useCardSelection}. */
  key: string
  name: string
  /** Lowercase set code, when the tile resolves to a specific printing. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The source line's language token, when present. Absent means `en`. */
  language?: CardLanguage
  /**
   * The tile's effective labels (collection and deck tiles; wanted lists carry
   * none). Read by the trade keep-guard and by the selection's own valuation,
   * where a `proxy` copy counts as worth nothing.
   */
  labels?: CardLabel[]
  /**
   * The tile's baked custom art, when it has any. Carried for the valuation and
   * the sell quote, both of which refuse a copy that is not its printing.
   */
  customArt?: string
  /**
   * Whether the tile's entry has custom art at all. The valuation and the quote
   * read this rather than the URL beside it: a reference whose file the build
   * could not deploy shows the real printing and is still worth nothing.
   */
  hasCustomArt?: boolean
  note?: string
  /** Copies currently selected from this tile (1..groupSize). Removing copies lowers it. */
  quantity: number
  /** Total copies the tile represents (deck quantity, grouped-duplicate count, or 1). */
  groupSize: number
  price?: number
  scryfallCard: ScryfallCard | null
  /** Front-image URL for the hover preview (resolved with the source list's image setting). */
  image?: string
  /** Whether the card art is sideways (rotated preview), e.g. battles / some tokens. */
  sideways?: boolean
  /** Printings to choose from when adding a name-only card to a trade. */
  printings?: ScryfallCard[]
  sourceName: string
  /** Slug of the source list, used to target cross-list edits (remove) unambiguously. */
  sourceSlug?: string
  sourceKind: SelectionSourceKind
  /** Trade cap for this tile (mirrors the single-card "Add to Trade" maxQty). */
  maxQty: number
  cardIds: number[]
}

export type SelectionSourceKind = 'deck' | 'collection' | 'wanted'

/** Identifies the list a selection belongs to. */
export interface SelectionListId {
  kind: SelectionSourceKind
  name: string
}

/** A tile's selection state: no copies, some copies (a quantity group), or all copies. */
export type SelectionState = 'none' | 'partial' | 'all'

export interface CardSelectionControl {
  /** Reactive list of currently selected cards (one entry per tile), in selection order. */
  selected: Accessor<SelectedCard[]>
  /** Total selected copies (sums each tile's quantity), so a 4× group counts as 4. */
  count: Accessor<number>
  /**
   * Retail value of the selection in the given currency, quantity-weighted.
   * Re-derived from each tile's resolved card rather than read back from the
   * `price` captured at selection time, so switching currency re-prices the
   * selection instead of showing the currency it was made in.
   */
  value: (currency: PriceCurrency) => number
  state: (localKey: string) => SelectionState
  /** Tri-state group toggle: select every copy, or clear the group if already fully selected. */
  toggle: (card: SelectedCard) => void
  /** Remove a single copy from a tile's group (removing the tile when its last copy goes). */
  removeOne: (card: SelectedCard) => void
  clear: () => void
}

/** A run of selected cards sharing one source list, for the "by source" grouping. */
export interface SelectionSourceGroup {
  kind: SelectionSourceKind
  name: string
  /** Slug of the source list (from the cards), when known — used to target cross-list edits. */
  slug?: string
  cards: SelectedCard[]
}

/** Group selected cards by their source list, preserving first-seen source order. */
export function groupSelectionsBySource(cards: SelectedCard[]): SelectionSourceGroup[] {
  const groups: SelectionSourceGroup[] = []
  const index = new Map<string, SelectionSourceGroup>()
  for (const card of cards) {
    const key = `${card.sourceKind} ${card.sourceName}`
    let group = index.get(key)
    if (!group) {
      group = { kind: card.sourceKind, name: card.sourceName, slug: card.sourceSlug, cards: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.cards.push(card)
  }
  return groups
}

// ----- Module-level store -----
//
// Selections are global so they survive navigation between lists. Each card's
// `key` is namespaced by its list identity, so the same per-tile id on two
// different lists never collides.

const [selectedCards, setSelectedCards] = createSignal<SelectedCard[]>([])

const listKeyPrefix = (list: SelectionListId): string => `${list.kind}\0${list.name}\0`

/** Every selected card across every list, in selection order. */
export const allSelectedCards: Accessor<SelectedCard[]> = selectedCards

const sumQuantities = (cards: SelectedCard[]): number =>
  cards.reduce((sum, c) => sum + c.quantity, 0)

/**
 * A selected tile's per-copy price in the given currency. Prefers the tile's
 * resolved card so a currency switch re-prices the selection; falls back to the
 * price captured at selection time for tiles whose card never resolved.
 *
 * A proxy — and a copy wearing custom art — prices at nothing in every currency,
 * the same rule the bake, the price report and the pages apply, so re-deriving
 * from the Scryfall card is skipped outright: it is the printing's price, and
 * this copy is not that printing.
 */
const unitPrice = (card: SelectedCard, currency: PriceCurrency): number => {
  if (isPricelessCard(card)) return 0
  return card.scryfallCard
    ? getCardPriceForFinish(card.scryfallCard, card.finish ?? 'nonfoil', currency)
    : (card.price ?? 0)
}

const sumValue = (cards: SelectedCard[], currency: PriceCurrency): number =>
  cards.reduce((sum, c) => sum + unitPrice(c, currency) * c.quantity, 0)

/** Total value of every selection across all lists, in the given currency. */
export function totalSelectedValue(currency: PriceCurrency): number {
  return sumValue(selectedCards(), currency)
}

/**
 * Tri-state group toggle. `card.key` is the global key and `card.groupSize` the
 * tile's total copies: if the group is already fully selected it is cleared,
 * otherwise every copy is selected (filling a partial group up to full).
 */
function toggleGroup(card: SelectedCard): void {
  setSelectedCards((prev) => {
    const existing = prev.find((c) => c.key === card.key)
    if (existing && existing.quantity >= existing.groupSize) {
      return prev.filter((c) => c.key !== card.key)
    }
    const full: SelectedCard = { ...card, quantity: card.groupSize }
    if (existing) return prev.map((c) => (c.key === card.key ? full : c))
    return [...prev, full]
  })
}

/** Remove one selected copy from a group, dropping the tile when its last copy goes. */
function removeUnit(globalKey: string): void {
  setSelectedCards((prev) => {
    const existing = prev.find((c) => c.key === globalKey)
    if (!existing) return prev
    if (existing.quantity <= 1) return prev.filter((c) => c.key !== globalKey)
    return prev.map((c) => (c.key === globalKey ? { ...c, quantity: c.quantity - 1 } : c))
  })
}

function stateForKey(globalKey: string): SelectionState {
  const existing = selectedCards().find((c) => c.key === globalKey)
  if (!existing) return 'none'
  return existing.quantity >= existing.groupSize ? 'all' : 'partial'
}

/** Total selected copies across all lists (sums each tile's quantity). */
export function totalSelectedCount(): number {
  return sumQuantities(selectedCards())
}

/** Selected cards belonging to the given list. */
export function selectedCardsForList(list: SelectionListId): SelectedCard[] {
  return selectedCards().filter((c) => c.sourceKind === list.kind && c.sourceName === list.name)
}

/** Remove every selection across all lists. */
export function clearAllSelections(): void {
  setSelectedCards([])
}

/** Remove the selections belonging to one list. */
export function clearListSelections(list: SelectionListId): void {
  setSelectedCards((prev) =>
    prev.filter((c) => !(c.sourceKind === list.kind && c.sourceName === list.name)),
  )
}

/**
 * Multi-select state scoped to one list, backed by the global store. Selection
 * persists across grouping, sorting, view-mode changes, *and* navigation to
 * other lists. `localKey` is unique within the list; this hook namespaces it by
 * the list identity before touching the shared store.
 */
export function useCardSelection(list: SelectionListId): CardSelectionControl {
  const prefix = listKeyPrefix(list)

  return {
    selected: () => selectedCardsForList(list),
    count: () => sumQuantities(selectedCardsForList(list)),
    value: (currency) => sumValue(selectedCardsForList(list), currency),
    state: (localKey) => stateForKey(prefix + localKey),
    toggle: (card) => toggleGroup({ ...card, key: prefix + card.key }),
    removeOne: (card) => removeUnit(prefix + card.key),
    clear: () => clearListSelections(list),
  }
}

/**
 * A {@link CardSelectionControl} scoped to a set of lists — backs the combined
 * multi-list view's toolbar selection menu. `selected`/`count`/`clear` are limited
 * to cards whose source list is in `lists`, but `toggle`/`state`/`removeOne` take
 * an already-global key, since the combined view builds tiles with global keys
 * directly (matching each source list's own key namespace).
 */
export function useCombinedSelection(lists: Accessor<SelectionListId[]>): CardSelectionControl {
  const inScope = (c: SelectedCard): boolean =>
    lists().some((l) => l.kind === c.sourceKind && l.name === c.sourceName)
  const scoped = (): SelectedCard[] => selectedCards().filter(inScope)
  return {
    selected: scoped,
    count: () => sumQuantities(scoped()),
    value: (currency) => sumValue(scoped(), currency),
    state: (key) => stateForKey(key),
    toggle: (card) => toggleGroup(card),
    removeOne: (card) => removeUnit(card.key),
    clear: () => setSelectedCards((prev) => prev.filter((c) => !inScope(c))),
  }
}

/**
 * A {@link CardSelectionControl} spanning every list — backs the cross-list navbar
 * button. Unlike the per-list hook, its `toggle`/`state`/`removeOne` take the card's
 * already-global key (the store only ever holds globally-keyed cards), so this is
 * meant to act on cards read back out of the store, not freshly-built tiles.
 */
export function useAllSelections(): CardSelectionControl {
  return {
    selected: allSelectedCards,
    count: totalSelectedCount,
    value: totalSelectedValue,
    state: (key) => stateForKey(key),
    toggle: (card) => toggleGroup(card),
    removeOne: (card) => removeUnit(card.key),
    clear: clearAllSelections,
  }
}

/**
 * A confirmed cross-list removal, snapshotted when the dialog opens: the exact
 * cards it will remove and the copy count its title names. Holding only the
 * count would let the two disagree, since the dialog does not block the tab.
 */
export type RemoveAllTarget = {
  cards: SelectedCard[]
  count: number
}
