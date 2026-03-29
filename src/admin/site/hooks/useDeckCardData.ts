import { useReducer } from 'preact/hooks'
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

export function useDeckCardData() {
  return useReducer(deckCardDataReducer, initialDeckCardData)
}
