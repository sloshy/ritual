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

export type DeckCardDataAction =
  | { type: 'LOAD'; data: DeckCardData }
  | { type: 'ADD_CARD'; cardName: string; card?: ScryfallCard; printings?: ScryfallCard[] }
  | {
      type: 'SET_PRICES'
      cardName: string
      representative?: ScryfallCard
      printings?: ScryfallCard[]
      lowestPriceCard: ScryfallCard | null
      lowestPriceCardEur: ScryfallCard | null
      lowestPriceCardTix: ScryfallCard | null
    }

export const initialDeckCardData: DeckCardData = {
  cards: {},
  printings: {},
  lowestPriceCards: {},
  lowestPriceCardsEur: {},
  lowestPriceCardsTix: {},
  symbolMap: {},
}

export function deckCardDataReducer(state: DeckCardData, action: DeckCardDataAction): DeckCardData {
  switch (action.type) {
    case 'LOAD':
      return action.data
    case 'ADD_CARD': {
      let { cards, printings, lowestPriceCards, lowestPriceCardsEur, lowestPriceCardsTix } = state
      if (action.card) {
        cards = { ...cards, [action.cardName]: action.card }
        // Use selected printing as immediate fallback for all price views
        lowestPriceCards = { ...lowestPriceCards, [action.cardName]: action.card }
        lowestPriceCardsEur = { ...lowestPriceCardsEur, [action.cardName]: action.card }
        lowestPriceCardsTix = { ...lowestPriceCardsTix, [action.cardName]: action.card }
      }
      if (action.printings && action.printings.length > 0) {
        printings = { ...printings, [action.cardName]: action.printings }
      }
      return {
        ...state,
        cards,
        printings,
        lowestPriceCards,
        lowestPriceCardsEur,
        lowestPriceCardsTix,
      }
    }
    case 'SET_PRICES': {
      let { cards, printings } = state
      if (action.representative) {
        cards = { ...cards, [action.cardName]: action.representative }
      }
      if (action.printings && action.printings.length > 0) {
        printings = { ...printings, [action.cardName]: action.printings }
      }
      return {
        ...state,
        cards,
        printings,
        lowestPriceCards: {
          ...state.lowestPriceCards,
          [action.cardName]: action.lowestPriceCard,
        },
        lowestPriceCardsEur: {
          ...state.lowestPriceCardsEur,
          [action.cardName]: action.lowestPriceCardEur,
        },
        lowestPriceCardsTix: {
          ...state.lowestPriceCardsTix,
          [action.cardName]: action.lowestPriceCardTix,
        },
      }
    }
  }
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
