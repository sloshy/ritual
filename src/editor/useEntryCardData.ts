import { createStore, produce, reconcile } from 'solid-js/store'
import type { ScryfallCard } from '../scryfall/types'
import {
  type AddCardToStore,
  buildPrintingKeys,
  indexPrintingCard,
  seedNameRepresentative,
} from './card-data-utils'

export type EntryCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
}

export type EntryCardDataActions = {
  load: (data: EntryCardData) => void
  addCard: AddCardToStore
  setPrices: (cardName: string, representative?: ScryfallCard, printings?: ScryfallCard[]) => void
}

export function useEntryCardData(): [EntryCardData, EntryCardDataActions] {
  // Literal, not a spread of a shared constant: the maps are mutated in place,
  // so two stores built from one object would share their contents.
  const [state, setState] = createStore<EntryCardData>({ cards: {}, printings: {}, symbolMap: {} })

  const actions: EntryCardDataActions = {
    load: (data) => setState(reconcile(data)),
    addCard: (cardName, card, printings) => {
      setState(
        produce((draft) => {
          if (card) {
            // Fill the by-name slot only when nothing holds it: this card may be
            // one specific printing chosen for *some* copies, and the copies that
            // pin no printing read that slot.
            seedNameRepresentative(draft.cards, cardName, card)
            // Foreign-language objects key under `set:cn@lang`; the plain slot
            // keeps (or falls back to) the default-language object.
            indexPrintingCard(draft.cards, card)
          }
          if (printings && printings.length > 0) {
            Object.assign(draft.cards, buildPrintingKeys(printings))
            draft.printings[cardName] = printings
          }
        }),
      )
    },
    setPrices: (cardName, representative, printings) => {
      setState(
        produce((draft) => {
          if (representative) {
            draft.cards[cardName] = representative
          }
          if (printings && printings.length > 0) {
            Object.assign(draft.cards, buildPrintingKeys(printings))
            draft.printings[cardName] = printings
          }
        }),
      )
    },
  }

  return [state, actions]
}
