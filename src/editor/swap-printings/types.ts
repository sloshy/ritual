/**
 * Types for the "Swap Printings" planner — the pure engine behind the batch
 * swap wizard (design record: `research/swap-printings-plan-2026-08-21.md` §4).
 *
 * The planner never touches a list file, the network, or the UI: a provider
 * hands it the saved contents of the other lists ({@link SwapSourceList}), it
 * groups them into {@link SwapCandidate}s per target card, allocates copies
 * (manually, or by price in the auto modes) into a {@link CardSwapPlan}, and
 * expresses the result as cross-list {@link SwapMove}s that the editors turn
 * into change events. Everything here is plain data so each step can be
 * unit-tested and re-run as the user changes options.
 */

import type { ScryfallCard, Finish, Condition } from '../../types'
import type { CardLanguage } from '../../card-language'
import type { CardPrintingsLookup } from '../../card-printing'
import type { PrintingRef } from '../../printing-key'
import type { NamedListRef } from '../../site/combined-list'

/** How the wizard chooses replacements: by hand per card, or by price. */
export type SwapMode = 'manual' | 'most-expensive' | 'least-expensive'

/** The price-driven modes — everything but `manual`. */
export type SwapAutoMode = Exclude<SwapMode, 'manual'>

/**
 * What an auto mode does with a card that has an unpriced candidate (or whose
 * current printing is unpriced). `skip` leaves the card unchanged and flags it;
 * `ignore` ranks among priced options only; `force` hands the card to the
 * manual picker. Unpriced means "no declared market value", never "worthless".
 */
export type UnpricedPolicy = 'skip' | 'ignore' | 'force'

/**
 * Restricts candidates by finish. `foil` means any foil treatment — `foil` or
 * `etched` — since the three-way control offers no separate etched choice;
 * `nonfoil` is plain copies only.
 */
export type FinishFilter = 'any' | 'foil' | 'nonfoil'

/**
 * Where displaced copies of the current printing go: back to the list each
 * replacement came from (`swap`), or to one chosen list for every displaced copy.
 */
export type DisplacedPolicy = { kind: 'swap' } | { kind: 'override'; to: NamedListRef }

/**
 * One line of a source list as the provider reports it. A deck line carries
 * its quantity; flat lists (collections, wanted lists) are one entry per copy.
 * The printing half is a {@link PrintingRef} (set codes lowercase, as every
 * in-memory set code is; the planner folds case when comparing regardless).
 */
export type SwapSourceEntry = PrintingRef & {
  finish?: Finish
  condition?: Condition
  quantity: number
  cardId?: number
  /** Deck section the line lives in. */
  section?: string
}

/**
 * A source list's saved contents plus the card data needed to resolve and
 * price its entries: `cards` is the list's printing-keyed card map (see
 * `lookupPrintingCard`), `printings` every cached printing per card name.
 */
export type SwapSourceList = {
  ref: NamedListRef
  entries: SwapSourceEntry[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
}

/**
 * What a provider's load returns: the lists it could read, and the refs it
 * could not. A list that fails to load is reported rather than dropped, so the
 * wizard can say that its copies are not on offer instead of silently
 * planning without them.
 */
export type SwapSourceLoad = { lists: SwapSourceList[]; failed: NamedListRef[] }

/** The seam through which the wizard reads other lists (public site and admin each implement it). */
export type SwapSourceProvider = {
  lists: () => NamedListRef[]
  load: (refs: readonly NamedListRef[], signal: AbortSignal) => Promise<SwapSourceLoad>
  /** Every Scryfall printing of a card — for choosing a printing for a printingless candidate. */
  printings: CardPrintingsLookup
}

/**
 * A line of the edited list the wizard may swap: one that pins a printing (re-
 * picked from copies owned elsewhere), or a name-only line (given a printing
 * from a copy owned elsewhere — nothing is displaced). `cardIds` is the line's
 * ids: one for a deck line (shared by all its copies), one per copy for a flat
 * list.
 */
export type SwapTarget = {
  cardName: string
  cardIds: number[]
  /**
   * Whether every copy shares one line (a deck line: `cardIds` holds its
   * single id, repeated for each copy) or each copy is its own line (a flat
   * list: one id per copy, in order; a copy past the end has none).
   */
  sharedLine: boolean
  quantity: number
  /** Lowercase, as every in-memory set code is. Absent (with `collectorNumber`) on a name-only line. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** Omitted means English (the bare-line default). */
  language?: CardLanguage
  condition?: Condition
  /** Deck section the line lives in; replacement copies are added to the same section. */
  section?: string
  /** The resolved current printing, or null when it is not in the cache. */
  card: ScryfallCard | null
}

/**
 * One physical copy a candidate can supply. Deck lines are expanded per copy,
 * repeating the line's id; flat-list copies each carry their own id. `cardId`
 * is absent for a legacy line that never received an `&N` id.
 */
export type SwapCandidateCopy = { cardId?: number; section?: string }

/**
 * A group of interchangeable copies in one source list that could replace the
 * target's current printing. `printing` candidates pin a printing; a
 * `printingless` candidate stands for every name-only line of the card in one
 * source list (a wanted line, or a name-only deck line), whose printing the
 * user chooses later ({@link ChosenPrinting}).
 */
export type SwapCandidate = {
  /**
   * Stable identity, target-independent for a printing candidate (the same
   * physical group yields the same key whichever card is being planned):
   * `${listRefKey(source)}|${printingKey}|${finish}|${language}|${condition}`
   * (language resolved, `en` when absent; condition `NM` when absent), or
   * `${listRefKey(source)}|printingless|${findMatchKey(cardName)}`.
   */
  key: string
  kind: 'printing' | 'printingless'
  source: NamedListRef
  /** The resolved printing; null for a printingless candidate or an uncached printing. */
  card: ScryfallCard | null
  set?: string
  collectorNumber?: string
  /** Resolved via `displayFinish` for a printing candidate; undefined for printingless. */
  finish?: Finish
  /** Omitted means English (the bare-line default). */
  language?: CardLanguage
  condition?: Condition
  /** Copies on offer — always `copies.length`. */
  available: number
  copies: SwapCandidateCopy[]
  /** Market value per copy; null when unpriced (always null for printingless). */
  price: number | null
}

/** A printing picked in the full printing dialog for a printingless candidate. */
export type ChosenPrinting = {
  card: ScryfallCard
  set: string
  collectorNumber: string
  finish: Finish
  /** Omitted means English (the bare-line default). */
  language?: CardLanguage
}

/** `count` copies taken from `candidate`; `printing` is required for a printingless candidate. */
export type SwapAllocation = { candidate: SwapCandidate; count: number; printing?: ChosenPrinting }

/**
 * Why a card needs the user's attention:
 * - `no-candidates`: nothing to swap to under the current filters.
 * - `unpriced-candidates`: an unpriced option took part (or was skipped/dropped).
 * - `needs-manual`: the auto mode handed the card to the manual picker.
 * - `partial`: some copies were swapped but supply ran out before the rest.
 * - `needs-displaced-destination`: a displaced copy would go to a wanted list.
 */
export type SwapFlag =
  | 'no-candidates'
  | 'unpriced-candidates'
  | 'needs-manual'
  | 'partial'
  | 'needs-displaced-destination'

/** The plan for one target card: its candidates, what was allocated, and how many copies stay. */
export type CardSwapPlan = {
  target: SwapTarget
  candidates: SwapCandidate[]
  allocations: SwapAllocation[]
  /** Copies that keep the current printing. `keep + Σ allocations.count === target.quantity`. */
  keep: number
  flags: SwapFlag[]
}

/** `in`: replacement copies arriving in the edited list; `out`: displaced copies leaving it. */
export type SwapMoveDirection = 'in' | 'out'

/** A target that pins a printing — the narrowing `targetPinsPrinting` (printing-fields.ts) produces. */
export type PinnedSwapTarget = SwapTarget & { set: string; collectorNumber: string }

/** One planned cross-list move of `count` copies of one printing. */
export type SwapMove = {
  direction: SwapMoveDirection
  cardName: string
  count: number
  set: string
  collectorNumber: string
  finish?: Finish
  /** Omitted means English (the bare-line default). */
  language?: CardLanguage
  condition?: Condition
  from: NamedListRef
  to: NamedListRef
  /**
   * The source list's line id per moved copy — always `count` long. Deck
   * sources repeat the line's id; a legacy line without an id yields
   * `undefined` in its slot (the writer falls back to a printing match).
   */
  sourceCardIds: Array<number | undefined>
  /** Destination deck section (set on `in` moves from the target's section). */
  section?: string
  /**
   * On an `in` move filling a NAME-ONLY target: the edited list's line id each
   * arriving copy pins (`count` long, like `sourceCardIds`) — a deck line's id
   * repeated, a flat copy's own. Such a move displaces nothing, so no `out`
   * move accompanies it.
   */
  pinsCardIds?: Array<number | undefined>
  /**
   * On an `in` move filling a name-only target: the printing the source list
   * receives back for the copies taken (the "replace taken copies" option),
   * `count` copies of it. Chosen after planning, per source list and printing.
   */
  replacement?: ChosenPrinting
  card: ScryfallCard | null
}

/** Copies arriving in (`in`) and leaving (`out`) one list across a set of moves. */
export type SwapListTotals = { list: NamedListRef } & Record<SwapMoveDirection, number>

/**
 * A card's priced value before and after its swap; null when any contributing
 * price is unknown. `card` is the target's current printing, which the summary
 * previews on hover.
 */
export type SwapCardDelta = Pick<SwapTarget, 'cardName' | 'card'> & {
  before: number | null
  after: number | null
}

/** The summary step's data: every move, per-list traffic, and the edited list's value before/after. */
export type SwapSummary = {
  moves: SwapMove[]
  lists: SwapListTotals[]
  before: number | null
  after: number | null
  deltas: SwapCardDelta[]
}

/** Prices one printing at one finish (and language); null when no market value is known. */
export type PriceOf = (
  card: ScryfallCard | null,
  finish: Finish | undefined,
  language?: CardLanguage,
) => number | null

/** Options for the auto modes — see `autoAllocate`. */
export type SwapAutoOptions = {
  mode: SwapAutoMode
  unpriced: UnpricedPolicy
  finish: FinishFilter
}

/**
 * One option in the auto ranking: a candidate, or `null` for keeping the
 * current printing (which offers exactly the target's quantity).
 */
export type SwapRankedOption = {
  candidate: SwapCandidate | null
  price: number | null
  available: number
}

/**
 * Copies already handed out per {@link SwapCandidate.key} across the plans
 * planned so far — `planMoves` reads and advances it so two cards (or two
 * allocations of one card) drawing on the same physical group never name the
 * same source line twice. Keys are target-independent, so one ledger spans a
 * whole wizard run.
 */
export type SwapCopyLedger = Map<string, number>

/** The moves planning produces, plus the flags raised while planning them. */
export type PlannedMoves = { moves: SwapMove[]; flags: SwapFlag[] }
