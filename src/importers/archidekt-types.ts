import { BOARDS, type DeckData, type DeckSection } from '../types'
import { getDeckFormatLabel, parseDeckFormat, type DeckFormatKey } from '../deck-format'

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
  /** Archidekt's numeric format id; see `ARCHIDEKT_FORMATS`. */
  deckFormat?: number
  categories?: ArchidektCategory[]
  cards?: ArchidektCardEntry[]
}

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

/**
 * Map an Archidekt format id onto a canonical {@link DeckFormatKey}. Returns null
 * for an unknown id and for the Archidekt-only formats Ritual does not model
 * (Custom, Frontier, Future Standard) — such a deck is imported with no declared
 * format and falls back to section-name detection.
 */
export function archidektDeckFormat(formatId: number | undefined): DeckFormatKey | null {
  if (formatId === undefined) return null
  return parseDeckFormat(ARCHIDEKT_FORMATS[formatId])
}

/** An Archidekt format id as a human-readable label, for listing remote decks. */
export function getArchidektFormat(formatId: number): string {
  const key = archidektDeckFormat(formatId)
  return key ? getDeckFormatLabel(key) : (ARCHIDEKT_FORMATS[formatId] ?? 'Unknown')
}

export type ArchidektCardModifier = 'Normal' | 'Foil' | 'Etched'

export interface ArchidektRawCardEntry {
  id: number // Deck-card relation ID (deckRelationId for modifyCards)
  quantity: number
  modifier: ArchidektCardModifier
  categories: string[]
  companion: boolean
  flippedDefault: boolean
  label: string // "name,hexcolor" — default ",#656565"
  customCmc: number | null
  card: {
    id: number // Archidekt card edition ID — sent as cardid to modifyCards/v2/
    uid: string // Scryfall UUID
    collectorNumber: string
    options: ArchidektCardModifier[]
    oracleCard: { id: number; name: string; defaultCategory: string }
    edition: { editioncode: string }
  }
}

export interface ArchidektRawDeckResponse {
  id: number
  name: string
  description?: string
  owner: { id: number; username: string }
  categories: ArchidektCategory[]
  cards: ArchidektRawCardEntry[]
  updatedAt: string
}

export type ModifyCardAction = 'add' | 'modify' | 'remove'

export interface ModifyCardModifications {
  quantity: number
  modifier: ArchidektCardModifier
  customCmc: number | null
  companion: boolean
  flippedDefault: boolean
  label: string // "name,hexcolor" — default ",#656565"
}

export interface ModifyCardEntry {
  action: ModifyCardAction
  cardid: number // Archidekt card edition ID
  customCardId: number | null
  categories: string[]
  patchId: string // Client-generated tracking ID
  modifications: ModifyCardModifications
  deckRelationId?: number // Required for "modify" and "remove" actions
}

export interface ArchidektCardSearchResult {
  id: number
  collectorNumber: string
  options: ArchidektCardModifier[]
  oracleCard: { name: string; defaultCategory: string }
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
      const quantity = entry.quantity ?? 1

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
  // Canonical board order lives in `BOARDS`; widened to string[] so `indexOf` can
  // take raw (possibly custom, non-board) section names.
  const sortOrder: readonly string[] = BOARDS

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
    format: archidektDeckFormat(json.deckFormat) ?? undefined,
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
  } catch {
    return rawDesc
  }
}
