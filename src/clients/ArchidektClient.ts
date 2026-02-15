import { defaultHttpClient } from '../http'
import type { HttpClient } from '../interfaces'
import type { DeckData, DeckSection } from '../types'

export interface ArchidektDeckSimple {
  id: number
  name: string
  updatedAt: string
  deckFormat: number
  owner: {
    username: string
  }
}

export const ARCHIDEKT_FORMATS: Record<number, string> = {
  1: 'Standard',
  2: 'Modern',
  3: 'Commander / EDH',
  4: 'Legacy',
  5: 'Vintage',
  6: 'Pauper',
  7: 'Custom',
  8: 'Frontier',
  9: 'Future Standard',
  10: 'Penny Dreadful',
  11: '1v1 Commander',
  12: 'Dual Commander',
  13: 'Brawl',
  14: 'Pioneer',
  15: 'Oathbreaker',
  16: 'Historic',
  17: 'Alchemy',
  18: 'Explorer',
  19: 'Timeless',
}

export function getArchidektFormat(formatId: number): string {
  return ARCHIDEKT_FORMATS[formatId] || 'Unknown'
}

interface ArchidektListResponse<T> {
  results: T[]
  count: number
}

interface ArchidektDeckFull {
  id: number
  name: string
  updatedAt: string
  deckFormat: number
  owner: { username: string }
  categories?: { id: number; name: string }[]
  cards?: {
    quantity: number
    card?: { name: string; oracleCard?: { name: string } }
    categories?: number[]
  }[]
  description?: string
}

export class ArchidektClient {
  private httpClient: HttpClient = defaultHttpClient

  constructor(httpClient?: HttpClient) {
    if (httpClient) {
      this.httpClient = httpClient
    }
  }

  async fetchPublicDecks(username: string): Promise<ArchidektDeckSimple[]> {
    const url = `https://archidekt.com/api/decks/v3/?ownerUsername=${username}`
    const response = await this.httpClient.fetch(url)

    if (!response.ok) {
      throw new Error(`Failed to fetch public decks: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as ArchidektListResponse<ArchidektDeckSimple>
    return (data.results || []).map((d) => this.mapDeck(d))
  }

  async fetchOwnDecks(token: string): Promise<ArchidektDeckSimple[]> {
    const url = 'https://archidekt.com/api/decks/curated/self/'
    const response = await this.httpClient.fetch(url, {
      headers: {
        Authorization: `JWT ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch own decks: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as ArchidektListResponse<ArchidektDeckSimple>
    return (data.results || []).map((d) => this.mapDeck(d))
  }

  async fetchDeck(deckId: string, token?: string): Promise<DeckData> {
    const url = `https://archidekt.com/api/decks/${deckId}/`
    const headers: Record<string, string> = {}

    if (token) {
      headers['Authorization'] = `JWT ${token}`
    }

    const response = await this.httpClient.fetch(url, { headers })

    if (!response.ok) {
      throw new Error(`Failed to fetch deck ${deckId}: ${response.status} ${response.statusText}`)
    }

    const json = (await response.json()) as ArchidektDeckFull
    return this.parseDeckData(json, deckId)
  }

  private mapDeck(d: ArchidektDeckSimple): ArchidektDeckSimple {
    return {
      id: d.id,
      name: d.name,
      updatedAt: d.updatedAt,
      deckFormat: d.deckFormat,
      owner: d.owner,
    }
  }

  private parseDeckData(json: ArchidektDeckFull, deckId: string): DeckData {
    // Categories map: ID -> Name
    const categoryIdMap = new Map<string, string>()
    if (json.categories) {
      for (const cat of json.categories) {
        categoryIdMap.set(cat.id.toString(), cat.name)
      }
    }

    // Group by Section Name
    const sectionsMap = new Map<string, Map<string, number>>()

    if (json.cards && Array.isArray(json.cards)) {
      for (const entry of json.cards) {
        const cardName = entry.card?.oracleCard?.name || entry.card?.name
        const quantity = entry.quantity || 1

        if (!cardName) continue

        let sectionName = 'Main'

        if (entry.categories && entry.categories.length > 0) {
          const categoryNames: string[] = []
          for (const catId of entry.categories) {
            const name = categoryIdMap.get(catId.toString()) || catId.toString()
            categoryNames.push(name)
          }

          if (categoryNames.some((c) => c.toLowerCase().includes('commander'))) {
            sectionName = 'Commander'
          } else if (categoryNames.some((c) => c.toLowerCase().includes('sideboard'))) {
            sectionName = 'Sideboard'
          } else if (categoryNames.some((c) => c.toLowerCase().includes('maybeboard'))) {
            sectionName = 'Maybeboard'
          } else {
            if (
              categoryNames.some(
                (c) =>
                  !['Land', 'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment'].includes(
                    c,
                  ),
              )
            ) {
              sectionName = 'Main'
            }
          }
        }

        if (!sectionsMap.has(sectionName)) {
          sectionsMap.set(sectionName, new Map())
        }
        const sectionCards = sectionsMap.get(sectionName)!
        sectionCards.set(cardName, (sectionCards.get(cardName) || 0) + quantity)
      }
    }

    const sections: DeckSection[] = []
    const sortOrder = ['Commander', 'Main', 'Sideboard', 'Maybeboard']

    for (const [name, cardMap] of sectionsMap.entries()) {
      const cards = Array.from(cardMap.entries()).map(([cName, qty]) => ({
        name: cName,
        quantity: qty,
      }))
      sections.push({ name, cards })
    }

    sections.sort((a, b) => {
      const idxA = sortOrder.indexOf(a.name)
      const idxB = sortOrder.indexOf(b.name)
      if (idxA === -1 && idxB === -1) return a.name.localeCompare(b.name)
      if (idxA === -1) return 1
      if (idxB === -1) return -1
      return idxA - idxB
    })

    return {
      name: json.name || `Archidekt Deck ${deckId}`,
      sourceId: deckId.toString(),
      sourceUrl: `https://archidekt.com/decks/${deckId}`,
      description: this.parseDescription(json.description),
      sections,
    }
  }

  private parseDescription(rawDesc: string | null | undefined): string | undefined {
    if (!rawDesc) return undefined

    try {
      const parsed = JSON.parse(rawDesc)

      if (parsed && Array.isArray(parsed.ops)) {
        let text = ''
        for (const op of parsed.ops) {
          if (!op.insert) continue

          if (typeof op.insert === 'string') {
            text += op.insert
          } else if (typeof op.insert === 'object') {
            if (op.insert['card-link']) {
              text += op.insert['card-link']
            }
          }
        }
        return text.trim()
      }
      return rawDesc
    } catch (e) {
      return rawDesc
    }
  }
}
