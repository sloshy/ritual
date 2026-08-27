/**
 * The change-printing step machine, as a pure reducer over one state value:
 * the flow currently on screen (quantity prompt → printing picker) and the
 * cards still waiting their turn in a bulk run. `useEditor` holds the state in
 * a single signal and applies these transitions to it.
 */

import type { CardContextInfo } from '../list-view/card-context'
import type { ChangePrintingFlow } from './editor-config'

/** The flow on screen (null when inactive) plus the bulk-run queue behind it. */
export type PrintingFlowState = {
  readonly flow: ChangePrintingFlow | null
  /**
   * Remaining cards awaiting their turn in a bulk change-printing run. Each
   * card's flow (quantity → printing) is driven one at a time; completing or
   * skipping one advances to the next. Empty for the single-card menu flow.
   */
  readonly queue: readonly CardContextInfo[]
}

export const IDLE_PRINTING_FLOW: PrintingFlowState = Object.freeze({ flow: null, queue: [] })

/** The flow a targeted tile opens on: the quantity prompt when it holds several copies, else the picker. */
export function openPrintingFlow(target: CardContextInfo): ChangePrintingFlow {
  // Named rather than inline: `x > 1 ? 'a' : 'b'` reads as plural morphology
  // both to a human and to `ritual/no-inline-plural`, and this is a step
  // token, not user-facing text.
  const asksForCount = target.quantity > 1
  return {
    target,
    step: asksForCount ? 'quantity' : 'printing',
    count: asksForCount ? target.quantity : 1,
  }
}

/**
 * Open the single-card menu flow on `target`. An in-flight bulk queue is kept,
 * not dropped: the menu flow only replaces what is on screen, and the queued
 * cards still get their turn once it closes — the same as skipping one.
 */
export function startPrintingFlow(
  state: PrintingFlowState,
  target: CardContextInfo,
): PrintingFlowState {
  return { ...state, flow: openPrintingFlow(target) }
}

/**
 * Begin a sequential run over `targets` (bulk multi-select): the first opens
 * now and the rest queue behind it, replacing any earlier queue. No targets
 * means nothing to do.
 */
export function startBulkPrintingFlow(
  state: PrintingFlowState,
  targets: readonly CardContextInfo[],
): PrintingFlowState {
  const [first, ...rest] = targets
  if (!first) return state
  return { flow: openPrintingFlow(first), queue: rest }
}

/** Advance from the quantity prompt to the printing picker with the chosen count. */
export function confirmPrintingCount(state: PrintingFlowState, count: number): PrintingFlowState {
  if (!state.flow) return state
  return { ...state, flow: { ...state.flow, step: 'printing', count } }
}

/**
 * Close the current flow and open the next queued card's, if any. With an
 * empty queue this just closes the flow — cancelling means "skip this card and
 * continue" while a bulk run is active (mirrors the per-card skip in the bulk
 * Add-to-Trade flow); for the single-card menu flow the queue is empty.
 */
export function advancePrintingFlow(state: PrintingFlowState): PrintingFlowState {
  const [next, ...rest] = state.queue
  if (!next) return state.flow === null ? state : IDLE_PRINTING_FLOW
  return { flow: openPrintingFlow(next), queue: rest }
}
