import { type DeckData, type DeckSection } from '../types'
import { type HttpClient } from '../interfaces'
import { defaultHttpClient } from '../http'

import { type ArchidektDeckResponse } from './archidekt-types'

export async function fetchArchidektDeck(
  deckId: string,
  http: HttpClient = defaultHttpClient,
): Promise<DeckData> {
  const response = await http.fetch(`https://archidekt.com/api/decks/${deckId}/`)

  if (!response.ok) {
    throw new Error(`Failed to fetch deck from Archidekt. Status: ${response.status}`)
  }

  const json = (await response.json()) as ArchidektDeckResponse

  // Categories map: ID -> Name
  const categoryIdMap = new Map<string, string>()
  if (json.categories) {
    for (const cat of json.categories) {
      categoryIdMap.set(cat.id.toString(), cat.name)
    }
  }

  // Group by Section Name
  // Common Archidekt categories: "Commander", "Sideboard", "Maybeboard", "Mainboard" (default)
  const sectionsMap = new Map<string, Map<string, number>>() // SectionName -> CardName -> Qty

  if (json.cards && Array.isArray(json.cards)) {
    for (const entry of json.cards) {
      const cardName = entry.card?.oracleCard?.name || entry.card?.name
      const quantity = entry.quantity || 1

      if (!cardName) continue

      // Verify Categories
      let sectionName = 'Main' // Default

      if (entry.categories && entry.categories.length > 0) {
        // Check if category implies Sideboard/Commander/Maybeboard.
        // Order of precedence: Commander > Sideboard > Maybeboard > Main.

        const categoryNames: string[] = []
        for (const catId of entry.categories) {
          // Try to match ID to name from the category definitions
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
          // Others might be custom categories "Land", "Creature". Treat as Main.
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
  // Sort sections logic: Commander -> Main -> Sideboard -> Maybeboard -> Others
  const sortOrder = ['Commander', 'Main', 'Sideboard', 'Maybeboard']

  // Convert map to DeckSection[]
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
    // If both unknown, sort alpha
    if (idxA === -1 && idxB === -1) return a.name.localeCompare(b.name)
    // If one unknown, put it last
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

function parseArchidektDescription(rawDesc: string | null | undefined): string | undefined {
  if (!rawDesc) return undefined

  try {
    // Archidekt descriptions are often JSON strings representing rich text (Quill delta format)
    // format: { ops: [ { insert: "text" }, { insert: { "card-link": "Name" } } ] }
    const parsed = JSON.parse(rawDesc)

    if (parsed && Array.isArray(parsed.ops)) {
      let text = ''
      for (const op of parsed.ops) {
        if (!op.insert) continue

        if (typeof op.insert === 'string') {
          text += op.insert
        } else if (typeof op.insert === 'object') {
          // Handle custom inserts like card links
          if (op.insert['card-link']) {
            text += op.insert['card-link']
          }
          // Add other custom inserts here if needed
        }
      }
      return text.trim()
    }

    // Fallback for plain string descriptions or legacy deck formats
    return rawDesc
  } catch (e) {
    // Not JSON, treat as plain text
    return rawDesc
  }
}
