import {
  isSamePrinting,
  type CardPrintingOptions,
  type PrintingTuple,
} from '../changes/change-event'
import type { CardContextInfo } from '../list-view/card-context'
import { printingOf } from '../list-view/printing-prompt'

/** The printing a change-printing action moves a tile from and to. */
export type PrintingRetarget = {
  /** The chosen printing. `language` rides along when the picker resolved one. */
  newPrinting: PrintingTuple
  /** The tile's printing as it stands, the fallback baseline for consolidation. */
  currentPrinting: PrintingTuple
}

/**
 * Whether a retarget reads the condition at all. A list whose lines carry no
 * condition (wanted lists) ignores it, so neither tuple names one.
 */
export type ConditionComparison = 'compare-condition' | 'ignore-condition'

/**
 * The prologue shared by the three `apply*ChangePrinting` implementations:
 * the two printings a retarget compares, or `null` when the chosen printing is
 * the one the tile already has — nothing to change.
 *
 * `language` rides along on the new printing when the picker resolved one (a
 * printing unavailable in the default language); absent, the set-printing
 * leaves the entry's language alone.
 */
export function printingRetarget(
  target: CardContextInfo,
  options: CardPrintingOptions,
  condition: ConditionComparison,
): PrintingRetarget | null {
  // `condition: undefined` rather than an omitted key: `createSetPrintingChange`
  // projects every field explicitly, so the change event reads the same either
  // way, and `isSamePrinting` folds an absent condition to `NM` on both sides.
  const withCondition = (printing: PrintingTuple): PrintingTuple =>
    condition === 'compare-condition' ? printing : { ...printing, condition: undefined }
  const newPrinting = withCondition({ ...printingOf(options), language: options.language })
  const currentPrinting = withCondition(printingOf(target))
  if (isSamePrinting(newPrinting, currentPrinting)) return null
  return { newPrinting, currentPrinting }
}
