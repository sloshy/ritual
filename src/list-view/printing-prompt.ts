import { createSignal, type Accessor } from 'solid-js'
import type { Finish } from '../card/finish-condition'
import type { ScryfallCard } from '../scryfall/types'
import type { ListRef, PrintingTuple } from '../changes/change-event'
import { scryfallCardLanguage, storedLanguage, type CardLanguage } from '../card/card-language'
import type { SelectedCard } from './useCardSelection'

/**
 * A sequential, one-at-a-time printing chooser shared by every flow that needs the
 * user to pin a name-only card to a specific printing: the bulk "Add to Trade"
 * ({@link import('../site/useSelectionTrade').addSelectionToTrade}) and moving a
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
 * The picked card object's language as a change-pipeline value: `undefined` for
 * English (or an unrecognized code), so a default-language pick never stamps a
 * token. The single translation from Scryfall's `lang` field on this path.
 */
export function pickedPrintingLanguage(printing: ScryfallCard): CardLanguage | undefined {
  return storedLanguage(scryfallCardLanguage(printing))
}

/**
 * Resolve the printing to record when moving a card into `dest`. Moving into a
 * collection requires a concrete printing, so a name-only card opens the picker
 * (above); every other destination keeps the card's current printing — language
 * included, so a `[ja]` line stays `[ja]` across the move. Returns null
 * when the user skips a required prompt — the caller should abort that card's move.
 *
 * Set codes are normalized to lowercase here, the single boundary where a picked
 * printing enters the change pipeline. A picked alternate-language object (one
 * only offered non-English, confirmed via the picker's notice) stamps its
 * language on the recorded printing.
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
    language: pickedPrintingLanguage(picked.printing),
  }
}

/** The four printing fields a tile or a selection snapshot carries. */
export type PrintingFields = Pick<PrintingTuple, 'set' | 'collectorNumber' | 'finish' | 'condition'>

/**
 * The printing a card currently has, as {@link printingForMove}'s `current`.
 * Deliberately without `language`: the move resolves each copy's language
 * from the live entry itself, so a snapshot's stale token never rides along.
 */
export function printingOf(card: PrintingFields): PrintingTuple {
  return {
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
  }
}

/**
 * Move a multi-select out to `dest` one card at a time, prompting for a
 * printing wherever {@link printingForMove} needs one and handing each
 * resolved card to `emit`. A skipped prompt drops that card and moves on.
 * Fire-and-forget: the prompts serialize themselves.
 */
export function bulkMoveToList(
  cards: SelectedCard[],
  dest: ListRef,
  emit: (card: SelectedCard, dest: ListRef, printing: PrintingTuple) => void,
): void {
  void (async () => {
    for (const c of cards) {
      const printing = await printingForMove(c.name, dest, printingOf(c), c.printings ?? [])
      if (printing) emit(c, dest, printing)
    }
  })()
}
