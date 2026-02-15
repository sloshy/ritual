import MoxfieldApi from 'moxfield-api'
import { type DeckData, type DeckSection } from '../types'
import { getLogger } from '../logger'

export async function fetchMoxfieldDeck(
  deckId: string,
  moxfieldClient?: MoxfieldApi,
): Promise<DeckData> {
  const moxfield = moxfieldClient || new MoxfieldApi()

  try {
    const deck = await moxfield.deckList.findById(deckId)

    const name = deck.name
    const sections: DeckSection[] = []

    // Structure is deck.boards.{boardName}.cards.{cardId}
    const boards = deck.boards
    if (!boards) {
      throw new Error("Invalid deck format: 'boards' missing.")
    }

    // Interface for internal use since library types might be incomplete
    interface MoxfieldBoard {
      cards: Record<string, { quantity: number; card: { name: string } }>
    }

    const processBoard = (boardName: string, targetSectionName: string) => {
      const board = (boards as unknown as Record<string, MoxfieldBoard>)[boardName]
      if (board && board.cards) {
        const cards: { quantity: number; name: string }[] = []

        for (const value of Object.values(board.cards)) {
          const quantity = value.quantity
          const cardName = value.card?.name

          if (cardName && quantity) {
            const existing = cards.find((c) => c.name === cardName)
            if (existing) {
              existing.quantity += quantity
            } else {
              cards.push({ quantity, name: cardName })
            }
          }
        }

        if (cards.length > 0) {
          sections.push({ name: targetSectionName, cards })
        }
      }
    }

    // Explicit mapping of known boards
    processBoard('commanders', 'Commander')
    processBoard('companions', 'Companion')
    processBoard('mainboard', 'Main')
    processBoard('sideboard', 'Sideboard')
    processBoard('maybeboard', 'Maybeboard')

    return {
      name,
      sourceId: deckId, // Moxfield public IDs are strings
      sourceUrl: `https://moxfield.com/decks/${deckId}`,
      description: deck.description || undefined,
      primer: (deck as any).primer || undefined,
      sections,
    }
  } catch (error) {
    getLogger().error('Moxfield Lib Error:', error)
    throw error
  }
}
