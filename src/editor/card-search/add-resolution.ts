/**
 * The add dialog's pure decisions: which printing to commit when none is
 * picked, how the set-code default narrows the grid, and whether the
 * finish/condition step can be skipped for a picked printing.
 */

import {
  type Condition,
  type Finish,
  defaultPrintingFinish,
  printingFinishes,
} from '../../card/finish-condition'
import type { ScryfallCard } from '../../scryfall/types'
import { getCardPriceForFinish, type PriceCurrency } from '../../pricing/price-currency'
import { selectCheapestPrinting } from '../../card/printing-select'
import type { TranslateFn } from '../../i18n/t'
import { printingPriceText } from '../../list-view/printing-prices'
import { sitePriceForFinish } from '../../list-view/price-view'

/**
 * The currency this dialog quotes in. Every price it renders — the grid tiles and
 * the finish radios alike — goes through this, so the two can never disagree on
 * how a number is written. The currency sweep (plan §6.4 / Phase 3) is what gives
 * the picker a currency of its own.
 */
export const PICKER_CURRENCY = 'usd' as const satisfies PriceCurrency

/** A printing with the finish and condition an add commits it under. */
export type AutoOptionsInput = {
  printing: ScryfallCard
  finish: Finish
  condition: Condition | undefined
}

/** What the set-code default left of the grid, and whether it had to give up. */
export type SetFilterResult = {
  printings: ScryfallCard[]
  /** True when the filter excluded everything and the unfiltered list is shown instead. */
  fellBack: boolean
}

/** What {@link resolveAutoOptions} reads off the dialog's defaults and list kind. */
export type AutoOptionsContext = {
  defaultFinish: Finish | undefined
  defaultCondition: Condition | undefined
  /** Whether this list type tracks card condition (wanted lists do not). */
  usesCondition: boolean
  requirePrinting: boolean
}

/**
 * The cheapest printing, for the flow that commits one without the user picking
 * (adding a card with "No specific printing").
 *
 * Scryfall prices deliberately, unlike everything else this dialog renders. The
 * choice is made synchronously the moment the printings land, and a Card Kingdom
 * quote for a printing nobody has looked at yet is still in flight then — under
 * the CK view every candidate would read 0 and this would degrade to "the first
 * printing returned". A price that is knowable now beats a store-correct one
 * that is not.
 *
 * An unpriced printing sorts last rather than first: 0 is "no price on record",
 * not "free".
 */
export function getCheapestPrinting(printings: readonly ScryfallCard[]): ScryfallCard | undefined {
  const priceOf = (card: ScryfallCard): number =>
    getCardPriceForFinish(card, defaultPrintingFinish(card), PICKER_CURRENCY)
  return selectCheapestPrinting(printings, priceOf) ?? printings[0]
}

/**
 * What the picked printing costs in one of its finishes, shown beside that
 * finish's radio so the choice is priced before it is made. Source-aware, and
 * written the same way `PrintingPrices` writes the tiles' figures.
 */
export function finishPrice(t: TranslateFn, printing: ScryfallCard, finish: Finish): string {
  return printingPriceText(
    t,
    sitePriceForFinish(printing, finish, PICKER_CURRENCY),
    PICKER_CURRENCY,
  )
}

/**
 * Apply the set-code default to a list of printings. If the filter excludes
 * everything, fall back to the unfiltered list and say so, so the dialog can
 * surface a hint.
 */
export function applySetFilter(
  allPrintings: ScryfallCard[],
  filterSets: readonly string[],
): SetFilterResult {
  if (filterSets.length === 0) return { printings: allPrintings, fellBack: false }
  const filtered = allPrintings.filter((p) => filterSets.includes(p.set.toLowerCase()))
  if (filtered.length === 0) return { printings: allPrintings, fellBack: true }
  return { printings: filtered, fellBack: false }
}

/**
 * Decide whether the finish/condition step can be skipped given the printing
 * and the active defaults. Returns the resolved options when skip is safe.
 *
 * Skip rules:
 * - Finish answered when the user's default applies, or the printing has exactly
 *   one nonfoil-only finish (matching the legacy auto-skip behavior).
 * - Condition answered when the user's default applies, or this list type
 *   doesn't track condition (wanted lists), or the legacy "no specific printing
 *   required" path supplies the NM default for decks.
 */
export function resolveAutoOptions(
  printing: ScryfallCard,
  context: AutoOptionsContext,
): AutoOptionsInput | null {
  // The same list the finish step would offer, so "can this step be skipped?"
  // and "what does it show?" can never disagree.
  const availableFinishes = printingFinishes(printing)

  let finish: Finish | undefined
  if (context.defaultFinish && availableFinishes.includes(context.defaultFinish)) {
    finish = context.defaultFinish
  } else if (
    availableFinishes.length === 1 &&
    !availableFinishes.some((f) => f === 'foil' || f === 'etched')
  ) {
    finish = availableFinishes[0]
  }

  if (finish === undefined) return null

  let condition: Condition | undefined
  if (context.defaultCondition !== undefined) {
    condition = context.defaultCondition
  } else if (!context.usesCondition) {
    condition = undefined
  } else if (!context.requirePrinting) {
    // Legacy path for decks: condition is optional and defaults to NM.
    condition = 'NM'
  } else {
    // Collections require an explicit condition; without a default we cannot skip.
    return null
  }

  return { printing, finish, condition }
}
