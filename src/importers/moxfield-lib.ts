import { MoxfieldClient } from './moxfield-client'
import { type DeckData, type DeckSection } from '../types'
import { parseDeckFormat } from '../deck-format'
import { getLogger } from '../logger'

type ImportedCard = { quantity: number; name: string }

export async function fetchMoxfieldDeck(
  deckId: string,
  client: MoxfieldClient = new MoxfieldClient(),
): Promise<DeckData> {
  try {
    const deck = await client.fetchDeck(deckId)

    const sections: DeckSection[] = []

    const processBoard = (boardName: string, targetSectionName: string) => {
      const board = deck.boards[boardName]
      if (board?.cards) {
        const cards: ImportedCard[] = []

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

    // Always attempt to fetch the primer — the v3 deck response may report hasPrimer: null
    // even when a primer exists, so we can't rely on that field as a guard.
    // fetchPrimer returns null gracefully on 404/401/403 or missing id.
    let primer: string | undefined = deck.primer ?? undefined
    const primerResponse = await client.fetchPrimer(deck.id)
    if (primerResponse?.content) {
      primer = primerResponse.content
    }

    return {
      name: deck.name,
      // Moxfield reports a format slug (`commander`, `duelCommander`, ...); an
      // unmodelled one (`custom`, `none`) resolves to null and is left unset.
      format: parseDeckFormat(deck.format) ?? undefined,
      sourceId: deckId,
      sourceUrl: `https://moxfield.com/decks/${deckId}`,
      description: deck.description || undefined,
      primer,
      sections,
    }
  } catch (error) {
    getLogger().error('Moxfield Lib Error:', error)
    throw error
  }
}
