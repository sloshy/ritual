import { createStore, produce, reconcile } from 'solid-js/store'
import type { ScryfallCard } from '../../../types'

export type EntryCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
}

export type EntryCardDataAction =
  | { type: 'LOAD'; data: EntryCardData }
  | { type: 'ADD_CARD'; cardName: string; card?: ScryfallCard; printings?: ScryfallCard[] }
  | {
      type: 'SET_PRICES'
      cardName: string
      representative?: ScryfallCard
      printings?: ScryfallCard[]
    }

export const initialEntryCardData: EntryCardData = {
  cards: {},
  printings: {},
  symbolMap: {},
}

/** Builds a set:collectorNumber → ScryfallCard lookup from a printings array. */
function buildPrintingKeys(items: ScryfallCard[]): Record<string, ScryfallCard> {
  const result: Record<string, ScryfallCard> = {}
  for (const p of items) {
    result[`${p.set}:${p.collector_number}`] = p
  }
  return result
}

export function entryCardDataReducer(
  state: EntryCardData,
  action: EntryCardDataAction,
): EntryCardData {
  switch (action.type) {
    case 'LOAD':
      return action.data
    case 'ADD_CARD': {
      let cards = state.cards
      if (action.card) {
        const key = `${action.card.set}:${action.card.collector_number}`
        cards = { ...cards, [action.cardName]: action.card, [key]: action.card }
      }
      let printings = state.printings
      if (action.printings && action.printings.length > 0) {
        cards = { ...cards, ...buildPrintingKeys(action.printings) }
        printings = { ...printings, [action.cardName]: action.printings }
      }
      return { ...state, cards, printings }
    }
    case 'SET_PRICES': {
      let cards = state.cards
      if (action.representative) {
        cards = { ...cards, [action.cardName]: action.representative }
      }
      let printings = state.printings
      if (action.printings && action.printings.length > 0) {
        cards = { ...cards, ...buildPrintingKeys(action.printings) }
        printings = { ...printings, [action.cardName]: action.printings }
      }
      return { ...state, cards, printings }
    }
  }
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
