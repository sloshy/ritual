import { createStore, produce, reconcile } from 'solid-js/store'
import type { ScryfallCard } from '../../../types'

export type DeckCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  lowestPriceCards: Record<string, ScryfallCard | null>
  lowestPriceCardsEur: Record<string, ScryfallCard | null>
  lowestPriceCardsTix: Record<string, ScryfallCard | null>
  symbolMap: Record<string, string>
}

export const initialDeckCardData: DeckCardData = {
  cards: {},
  printings: {},
  lowestPriceCards: {},
  lowestPriceCardsEur: {},
  lowestPriceCardsTix: {},
  symbolMap: {},
}

export type DeckCardDataActions = {
  load: (data: DeckCardData) => void
  addCard: (cardName: string, card?: ScryfallCard, printings?: ScryfallCard[]) => void
  setPrices: (
    cardName: string,
    lowestPriceCard: ScryfallCard | null,
    lowestPriceCardEur: ScryfallCard | null,
    lowestPriceCardTix: ScryfallCard | null,
    representative?: ScryfallCard,
    printings?: ScryfallCard[],
  ) => void
}

export function useDeckCardData(): [DeckCardData, DeckCardDataActions] {
  const [state, setState] = createStore<DeckCardData>({ ...initialDeckCardData })

  const actions: DeckCardDataActions = {
    load: (data) => setState(reconcile(data)),
    addCard: (cardName, card, printings) => {
      setState(
        produce((draft) => {
          if (card) {
            draft.cards[cardName] = card
            draft.lowestPriceCards[cardName] = card
            draft.lowestPriceCardsEur[cardName] = card
            draft.lowestPriceCardsTix[cardName] = card
          }
          if (printings && printings.length > 0) {
            draft.printings[cardName] = printings
          }
        }),
      )
    },
    setPrices: (
      cardName,
      lowestPriceCard,
      lowestPriceCardEur,
      lowestPriceCardTix,
      representative,
      printings,
    ) => {
      setState(
        produce((draft) => {
          if (representative) {
            draft.cards[cardName] = representative
          }
          if (printings && printings.length > 0) {
            draft.printings[cardName] = printings
          }
          draft.lowestPriceCards[cardName] = lowestPriceCard
          draft.lowestPriceCardsEur[cardName] = lowestPriceCardEur
          draft.lowestPriceCardsTix[cardName] = lowestPriceCardTix
        }),
      )
    },
  }

  return [state, actions]
}
