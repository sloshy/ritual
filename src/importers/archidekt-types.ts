import type { DeckData, DeckSection } from '../types'

export interface ArchidektCategory {
  id: number
  name: string
}

export interface ArchidektCardEntry {
  card?: {
    oracleCard?: { name: string }
    name: string
  }
  quantity?: number
  categories?: number[] // Array of category IDs
}

export interface ArchidektDeckResponse {
  name?: string
  description?: string
  categories?: ArchidektCategory[]
  cards?: ArchidektCardEntry[]
}

/** Parse an Archidekt deck response into a DeckData object. */
export function parseArchidektDeckResponse(json: ArchidektDeckResponse, deckId: string): DeckData {
  // Categories map: ID -> Name
  const categoryIdMap = new Map<string, string>()
  if (json.categories) {
    for (const cat of json.categories) {
      categoryIdMap.set(cat.id.toString(), cat.name)
    }
  }

  // Group by Section Name
  // Common Archidekt categories: "Commander", "Sideboard", "Maybeboard", "Mainboard" (default)
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
                !['Land', 'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment'].includes(c),
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
    description: parseArchidektDescription(json.description),
    sections,
  }
}

/** Parse an Archidekt rich-text (Quill delta) description into plain text. */
export function parseArchidektDescription(rawDesc: string | null | undefined): string | undefined {
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
