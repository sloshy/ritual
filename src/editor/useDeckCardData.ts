import { createStore, produce, reconcile } from 'solid-js/store'
import type { ScryfallCard } from '../types'
import { type AddCardToStore, seedNameRepresentative } from './card-data-utils'

export type DeckCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  lowestPriceCards: Record<string, ScryfallCard | null>
  lowestPriceCardsEur: Record<string, ScryfallCard | null>
  lowestPriceCardsTix: Record<string, ScryfallCard | null>
  symbolMap: Record<string, string>
}

export type DeckCardDataActions = {
  load: (data: DeckCardData) => void
  addCard: AddCardToStore
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
  // Literal, not a spread of a shared constant: the maps are mutated in place,
  // so two stores built from one object would share their contents.
  const [state, setState] = createStore<DeckCardData>({
    cards: {},
    printings: {},
    lowestPriceCards: {},
    lowestPriceCardsEur: {},
    lowestPriceCardsTix: {},
    symbolMap: {},
  })

  const actions: DeckCardDataActions = {
    load: (data) => setState(reconcile(data)),
    addCard: (cardName, card, printings) => {
      setState(
        produce((draft) => {
          if (printings && printings.length > 0) {
            draft.printings[cardName] = printings
          }
          if (card) {
            // Every by-name map at once: which one a tile reads depends on the
            // "Lowest Price" toggle, and a deck line that pins a printing resolves
            // it out of `printings` instead — so these slots are what the
            // *name-only* lines render, in whichever mode is live. Seeded rather
            // than assigned so a printing chosen for some copies of a card does
            // not repaint the copies that still pin nothing. The three price maps
            // hold the cheapest printing once `setPrices` has run; this is only
            // the placeholder that lets a just-added card render before then —
            // so a `null` in one of them is knowingly treated as an empty slot
            // rather than as "nothing in this currency has a price", which the
            // next price refresh restates anyway.
            for (const map of [
              draft.cards,
              draft.lowestPriceCards,
              draft.lowestPriceCardsEur,
              draft.lowestPriceCardsTix,
            ]) {
              seedNameRepresentative(map, cardName, card)
            }
            // A deck keys card objects by name only, so `printings` is the sole
            // place a *pinned* line can resolve one from. Now that the by-name
            // slot is seeded rather than assigned, a card handed over without a
            // printing list would otherwise be recorded nowhere at all.
            // Rebuilt, not pushed into: the stored array is the caller's by
            // reference (the session cache holds the same one), and replacing the
            // key also notifies a reader that reads `printings[name]` without
            // iterating it. Nothing depends on the array's identity.
            const known = draft.printings[cardName]
            if (known === undefined) draft.printings[cardName] = [card]
            else if (!known.some((p) => p.id === card.id))
              draft.printings[cardName] = [...known, card]
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
