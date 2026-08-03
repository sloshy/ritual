import { MoxfieldClient, type MoxfieldFinish } from './moxfield-client'
import { type Card, type DeckData, type DeckSection, type Finish } from '../types'
import { parseDeckFormat } from '../deck-format'
import { getLogger } from '../logger'
import { resolvePrinting } from '../card-line'

/**
 * Map a Moxfield finish slug onto Ritual's finish. `nonFoil` and `glossy` (which
 * Ritual does not model) both fall back to the default finish, which serializes
 * as a bare line.
 */
function moxfieldFinish(finish: MoxfieldFinish | undefined): Finish | undefined {
  switch (finish) {
    case 'foil':
      return 'foil'
    case 'etched':
      return 'etched'
    default:
      return undefined
  }
}

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
        const cards: Card[] = []

        for (const value of Object.values(board.cards)) {
          const quantity = value.quantity
          const cardName = value.card?.name

          if (cardName && quantity) {
            // The printing Moxfield states is carried through as-is (set codes
            // lowercased internally, uppercased by the serializer) — the same
            // trust level as a CSV import, with no Scryfall verification. A
            // response naming only one half of a printing yields neither, since
            // a card line cannot express half of one.
            const printing = resolvePrinting(value.card.set, value.card.cn)
            const set = printing?.set
            const collectorNumber = printing?.collectorNumber
            const finish = moxfieldFinish(value.finish)
            // Same card AND same printing merge; a different printing is its own line.
            const existing = cards.find(
              (c) =>
                c.name === cardName &&
                c.set === set &&
                c.collectorNumber === collectorNumber &&
                c.finish === finish,
            )
            if (existing) {
              existing.quantity += quantity
            } else {
              cards.push({ quantity, name: cardName, set, collectorNumber, finish })
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
