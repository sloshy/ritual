import { createStore, produce, reconcile } from 'solid-js/store'
import type { ScryfallCard } from '../../../types'
import { buildPrintingKeys } from './card-data-utils'

export type EntryCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
}

export const initialEntryCardData: EntryCardData = {
  cards: {},
  printings: {},
  symbolMap: {},
}

export type EntryCardDataActions = {
  load: (data: EntryCardData) => void
  addCard: (cardName: string, card?: ScryfallCard, printings?: ScryfallCard[]) => void
  setPrices: (cardName: string, representative?: ScryfallCard, printings?: ScryfallCard[]) => void
}

export function useEntryCardData(): [EntryCardData, EntryCardDataActions] {
  const [state, setState] = createStore<EntryCardData>({ ...initialEntryCardData })

  const actions: EntryCardDataActions = {
    load: (data) => setState(reconcile(data)),
    addCard: (cardName, card, printings) => {
      setState(
        produce((draft) => {
          if (card) {
            const key = `${card.set}:${card.collector_number}`
            draft.cards[cardName] = card
            draft.cards[key] = card
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
