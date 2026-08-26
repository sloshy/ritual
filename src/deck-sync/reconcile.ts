/**
 * Printing identity and the pairing rules a deck sync reconciles two sides with.
 *
 * A card name can hold several printings at once — `2 Sol Ring (LEA:1)` beside
 * `1 Sol Ring (MKM:5)` locally, and on Archidekt several deck-card relations of
 * the same oracle card, one per edition/finish (and per category). Syncing such
 * a card is therefore not "one printing to copy across" but a *pairing* problem:
 * which of the destination's holdings does each of the source's holdings speak
 * to, which are re-pinned to a new printing, and which are outright additions or
 * removals.
 *
 * Everything here is pure and side-effect free, so both directions and both
 * appliers (the local file writer and the Archidekt upload planner) share one
 * answer rather than each re-deriving it.
 */

import { resolvePrinting } from '../card/card-line'
import { hasSpecificPrinting, type PrintingFields } from '../card/card-printing'
import { printingKey } from '../card/printing-key'
import type { PrintingTuple } from '../changes/change-event'
import type { Finish } from '../card/finish-condition'

/**
 * The set/collector-number/finish a card line states — the canonical
 * {@link PrintingTuple} minus condition and language, which are deliberately
 * absent: Archidekt deck entries carry neither, so a sync must never touch
 * them. Every field optional: a bare line states nothing, and a `[foil]`-only
 * line states just a finish.
 */
export type DeckPrintingRef = Pick<PrintingTuple, 'set' | 'collectorNumber' | 'finish'>

/** The three fields a printing ref is read from — all a caller needs to supply. */
export type PrintingSource = PrintingFields & {
  finish?: Finish
}

/**
 * The printing a card line states, with the set normalized the way lookups
 * need it. Accepts an absent card (a lookup that missed) and returns the
 * bare ref that states nothing.
 */
export function printingRefOf(card: PrintingSource | undefined): DeckPrintingRef {
  // Both halves of the printing or neither, same as every other consumer of a
  // card line: a set without a collector number cannot be expressed or synced.
  const printing = resolvePrinting(card?.set, card?.collectorNumber)
  return {
    set: printing?.set,
    collectorNumber: printing?.collectorNumber,
    finish: card?.finish,
  }
}

/** Identity key for a printing ref: absent finish folds to its `nonfoil` default. */
export function printingRefKey(ref: DeckPrintingRef): string {
  const halves = hasSpecificPrinting(ref) ? printingKey(ref.set, ref.collectorNumber) : ':'
  return `${halves}|${ref.finish ?? 'nonfoil'}`
}

/** Whether a printing ref states anything at all — a bare line does not. */
export function statesPrinting(ref: DeckPrintingRef): boolean {
  return ref.set !== undefined || ref.finish !== undefined
}

/**
 * Whether the destination's printing already satisfies the source's. Only the
 * dimensions the source *states* are compared: a source line with no set keeps
 * the destination's printing and speaks only to the finish, and an absent
 * finish on either side means `nonfoil` (the bare-line default).
 */
export function printingSatisfies(from: DeckPrintingRef, to: DeckPrintingRef): boolean {
  const setMatches =
    to.set === undefined ||
    ((from.set ?? '').toLowerCase() === to.set.toLowerCase() &&
      (from.collectorNumber ?? '').toLowerCase() === (to.collectorNumber ?? '').toLowerCase())
  const finishMatches = (from.finish ?? 'nonfoil') === (to.finish ?? 'nonfoil')
  return setMatches && finishMatches
}

/**
 * Whether two printing refs name the same printing. Both halves fold case, via
 * the one key the project identifies printings by, and an absent finish folds
 * to `nonfoil` — so this is the identity a sync groups copies on.
 */
export function samePrintingRef(a: DeckPrintingRef, b: DeckPrintingRef): boolean {
  return printingRefKey(a) === printingRefKey(b)
}

/** Anything a side of the sync holds at one printing: local lines, remote relations. */
export type PrintingHolder = {
  printing: DeckPrintingRef
  quantity: number
}

/**
 * The holdings a diff entry addresses. **An absent printing addresses all of
 * them** — that is what makes a name-keyed diff (one that is not syncing
 * printings) still able to spread a quantity change over a card held at
 * several printings, rather than matching none of them.
 *
 * The one answer to "which of this card's holdings does this change touch",
 * shared by the local-file applier and the Archidekt upload planner so the two
 * can never disagree about it.
 */
export function holdingsAt<T extends PrintingHolder>(
  holdings: readonly T[],
  printing: DeckPrintingRef | undefined,
): T[] {
  if (!printing) return [...holdings]
  return holdings.filter((holding) => samePrintingRef(holding.printing, printing))
}

/** One holding of the destination matched to the source holding that speaks to it. */
export type PrintingPair<From extends PrintingHolder, To extends PrintingHolder> = {
  /** What the destination holds today. */
  from: From
  /** What the source says it should hold. */
  to: To
}

/**
 * How one card name's holdings line up across the two sides. `from`/`old` is
 * always the sync destination and `to`/`new` the source, the same orientation
 * the diff itself uses.
 */
export type PrintingPairing<From extends PrintingHolder, To extends PrintingHolder> = {
  /** Paired and already on the printing the source asks for — quantities may still differ. */
  kept: PrintingPair<From, To>[]
  /** Paired across a printing difference: the destination holding moves to the source's printing. */
  repinned: PrintingPair<From, To>[]
  /** Source holdings with no destination counterpart — new lines/relations. */
  added: To[]
  /** Destination holdings with no source counterpart — lines/relations to drop. */
  removed: From[]
}

/**
 * Pair the destination's holdings of a card against the source's, printing by
 * printing.
 *
 * Three passes, most-certain first, so a card that merely gained a copy is
 * never mistaken for one that changed printing:
 *
 * 1. **Exact.** Identical printing keys pair up. `3 LEA` beside `1 MKM` on both
 *    sides pairs LEA↔LEA and MKM↔MKM regardless of the order they appear in.
 * 2. **Satisfied.** A source holding that states nothing (a bare line), or whose
 *    stated dimensions the destination already meets, pairs with the first
 *    leftover destination holding and leaves its printing alone — a bare line
 *    must never strip a printing.
 * 3. **Re-pin.** Whatever is still unpaired is zipped in order: those are the
 *    holdings that genuinely changed printing, and re-using the destination's
 *    existing holding keeps its identity (a local line's `&N`, an Archidekt
 *    relation's categories) rather than dropping and recreating it.
 *
 * Anything left over after all three is a real addition or removal.
 */
export function pairPrintings<From extends PrintingHolder, To extends PrintingHolder>(
  oldHoldings: readonly From[],
  newHoldings: readonly To[],
): PrintingPairing<From, To> {
  const remaining: (From | undefined)[] = [...oldHoldings]
  const kept: PrintingPair<From, To>[] = []
  const repinned: PrintingPair<From, To>[] = []

  /** Claim the first leftover destination holding the predicate accepts. */
  const claim = (accepts: (holding: From) => boolean): From | undefined => {
    const index = remaining.findIndex(
      (holding): holding is From => holding !== undefined && accepts(holding),
    )
    if (index === -1) return undefined
    const holding = remaining[index]
    remaining[index] = undefined
    return holding
  }

  const unpairedNew: To[] = []
  for (const holding of newHoldings) {
    const match = claim((candidate) => samePrintingRef(candidate.printing, holding.printing))
    if (match) kept.push({ from: match, to: holding })
    else unpairedNew.push(holding)
  }

  const stillUnpaired: To[] = []
  for (const holding of unpairedNew) {
    // A source that states nothing has nothing to say about the destination's
    // printing, and one the destination already satisfies has nothing to change.
    const bare = !statesPrinting(holding.printing)
    const match = claim(
      (candidate) => bare || printingSatisfies(candidate.printing, holding.printing),
    )
    if (match) kept.push({ from: match, to: holding })
    else stillUnpaired.push(holding)
  }

  const leftoverOld = remaining.filter((holding): holding is From => holding !== undefined)
  const pairs = Math.min(leftoverOld.length, stillUnpaired.length)
  for (let i = 0; i < pairs; i++) {
    repinned.push({ from: leftoverOld[i]!, to: stillUnpaired[i]! })
  }

  return {
    kept,
    repinned,
    added: stillUnpaired.slice(pairs),
    removed: leftoverOld.slice(pairs),
  }
}

/**
 * Whether the two sides' printings of a card can be reconciled by quantity
 * alone. False means one side holds a printing the other has no counterpart for
 * at all, so squaring them up would mean **adding or removing copies** — which
 * is exactly what `--sync-printings` opts into, and what a run without it must
 * not do behind the user's back. That is the case worth advising about.
 *
 * A card the two sides merely hold at *different* printings is not a mismatch
 * here: one holding pairs with the other and `--sync-printings` would simply
 * re-pin it, adding and removing nothing. Reporting that would mean warning
 * about every card of any deck whose printings are not already in sync — which
 * is most decks, on every ordinary run.
 *
 * A source that states no printing at all agrees with anything: a bare local
 * file is the common case and must not be reported as a mismatch.
 */
export function printingsAlign(
  oldHoldings: readonly PrintingHolder[],
  newHoldings: readonly PrintingHolder[],
): boolean {
  if (!newHoldings.some((holding) => statesPrinting(holding.printing))) return true
  const pairing = pairPrintings(oldHoldings, newHoldings)
  return pairing.added.length === 0 && pairing.removed.length === 0
}

/**
 * Spread a target total across the holdings a card already has, returning the
 * new quantity for each in the same order.
 *
 * A surplus lands on the first holding and a shortfall drains from the last one
 * backwards, so extra copies are taken from the trailing holdings before the
 * primary one is touched. Nothing is invented: an empty input stays empty, and
 * no holding goes negative. This is what keeps a card split across several
 * lines (or several Archidekt relations) from being collapsed into one whenever
 * its quantity changes.
 */
export function distributeQuantity(current: readonly number[], target: number): number[] {
  const result = [...current]
  if (result.length === 0) return result

  let delta = target - result.reduce((sum, quantity) => sum + quantity, 0)
  if (delta === 0) return result
  if (delta > 0) {
    result[0] = result[0]! + delta
    return result
  }

  for (let i = result.length - 1; i >= 0 && delta < 0; i--) {
    const taken = Math.min(result[i]!, -delta)
    result[i] = result[i]! - taken
    delta += taken
  }
  return result
}
