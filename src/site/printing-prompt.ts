import { createSignal, type Accessor } from 'solid-js'
import type { Finish, ScryfallCard } from '../types'
import type { ListRef, PrintingTuple } from '../change-event'

/**
 * A sequential, one-at-a-time printing chooser shared by every flow that needs the
 * user to pin a name-only card to a specific printing: the bulk "Add to Trade"
 * ({@link import('./useSelectionTrade').addSelectionToTrade}) and moving a
 * printing-less card into a printing-required list (a collection). The app renders
 * a single picker bound to {@link pendingPrintingPrompt}; callers await
 * {@link promptForPrinting}.
 */
export interface SelectionPrintingPrompt {
  cardName: string
  printings: ScryfallCard[]
  /** Apply the user's chosen printing/finish and advance the queue. */
  onSelect: (printing: ScryfallCard, finish: Finish) => void
  /** Skip this card (closing the picker) and advance the queue. */
  onSkip: () => void
}

const [pendingPrompt, setPendingPrompt] = createSignal<SelectionPrintingPrompt | null>(null)

/** The card currently awaiting a printing choice, or null. */
export const pendingPrintingPrompt: Accessor<SelectionPrintingPrompt | null> = pendingPrompt

export type PickedPrinting = { printing: ScryfallCard; finish: Finish }

/**
 * Open the shared printing picker for one card and resolve with the chosen
 * printing/finish, or null if the user skipped/closed it. Awaiting this serializes
 * prompts so several name-only cards are resolved one at a time.
 */
export function promptForPrinting(
  cardName: string,
  printings: ScryfallCard[],
): Promise<PickedPrinting | null> {
  return new Promise((resolve) => {
    setPendingPrompt({
      cardName,
      printings,
      onSelect: (printing, finish) => {
        setPendingPrompt(null)
        resolve({ printing, finish })
      },
      onSkip: () => {
        setPendingPrompt(null)
        resolve(null)
      },
    })
  })
}

/**
 * Resolve the printing to record when moving a card into `dest`. Moving into a
 * collection requires a concrete printing, so a name-only card opens the picker
 * (above); every other destination keeps the card's current printing. Returns null
 * when the user skips a required prompt — the caller should abort that card's move.
 *
 * Set codes are normalized to lowercase here, the single boundary where a picked
 * printing enters the change pipeline.
 */
export async function printingForMove(
  cardName: string,
  dest: ListRef,
  current: PrintingTuple,
  printings: ScryfallCard[],
): Promise<PrintingTuple | null> {
  const hasPrinting = Boolean(current.set && current.collectorNumber)
  if (dest.type !== 'collection' || hasPrinting) return current
  const picked = await promptForPrinting(cardName, printings)
  if (!picked) return null
  return {
    set: picked.printing.set.toLowerCase(),
    collectorNumber: picked.printing.collector_number,
    finish: picked.finish,
    condition: current.condition,
  }
}
