import { BOARDS, type DeckData, type DeckSection } from '../list/deck'
import type { Card } from '../card/card'
import type { Finish } from '../card/finish-condition'
import { compareData } from '../i18n/collate'
import { t } from '../i18n/t'
import { getDeckFormatLabel, parseDeckFormat, type DeckFormatKey } from '../list/deck-format'
import { resolvePrinting } from '../card/card-line'
import { getLogger } from '../util/logger'

export interface ArchidektCategory {
  id: number
  name: string
}

/**
 * The printing a deck entry names. The deck endpoint is looser than the raw
 * card payload — `collectorNumber` and `edition` are absent on some entries —
 * so the shared {@link ArchidektEdition} / {@link ArchidektOracleCard} shapes
 * are widened rather than restated.
 */
export interface ArchidektDeckCardPrinting {
  oracleCard?: Partial<ArchidektOracleCard>
  name: string
  /** Collector number of the printing the deck names. */
  collectorNumber?: string
  edition?: Partial<ArchidektEdition>
}

export interface ArchidektCardEntry {
  card?: ArchidektDeckCardPrinting
  quantity?: number
  /** Finish of this deck entry: `Normal`, `Foil`, or `Etched`. */
  modifier?: ArchidektCardModifier
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

/** The owner block a deck listing carries. */
export interface ArchidektDeckOwner {
  username: string
}

export interface ArchidektDeckSimple {
  id: number
  name: string
  updatedAt: string
  deckFormat: number
  owner: ArchidektDeckOwner
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

export interface ArchidektEdition {
  /** Set code. Archidekt serves it lowercase; normalize anyway before comparing. */
  editioncode: string
}

export interface ArchidektOracleCard {
  id: number
  name: string
  /** Archidekt's default deck category — present on deck card entries, not on every card payload. */
  defaultCategory?: string
}

/**
 * The card ("printing") object Archidekt embeds in deck entries and collection
 * records. Only the fields Ritual reads are declared.
 */
export interface ArchidektCard {
  id: number // Archidekt card edition ID — sent as cardid to modifyCards/v2/ and as `card` on collection upserts
  uid: string // Scryfall UUID
  collectorNumber: string
  options: ArchidektCardModifier[]
  oracleCard: ArchidektOracleCard
  edition: ArchidektEdition
}

export interface ArchidektRawCardEntry {
  id: number // Deck-card relation ID (deckRelationId for modifyCards)
  quantity: number
  modifier: ArchidektCardModifier
  categories: string[]
  companion: boolean
  flippedDefault: boolean
  label: string // "name,hexcolor" — default ",#656565"
  customCmc: number | null
  card: ArchidektCard
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

/**
 * The oracle block a card-search hit carries.
 *
 * `defaultCategory` is **not** always present: Archidekt sends `null` for cards
 * it files under no default category (basic lands among them), and a `null` in a
 * `categories` array is rejected by `modifyCards/v2/` with
 * `"This field may not be null."` — so it must be treated as absent, never
 * forwarded.
 */
export interface ArchidektSearchOracleCard {
  name: string
  defaultCategory?: string | null
}

export interface ArchidektCardSearchResult {
  id: number
  collectorNumber: string
  options: ArchidektCardModifier[]
  oracleCard: ArchidektSearchOracleCard
}

/**
 * Map an Archidekt entry modifier onto Ritual's finish. `Normal` (and a missing
 * modifier) is the default finish, which serializes as a bare line.
 */
export function archidektFinish(modifier: ArchidektCardModifier | undefined): Finish | undefined {
  if (modifier === 'Foil') return 'foil'
  if (modifier === 'Etched') return 'etched'
  return undefined
}

/** The set, collector number, and finish an Archidekt deck entry states. */
export type ArchidektEntryPrinting = {
  set?: string
  collectorNumber?: string
  finish?: Finish
}

/** The card half of a deck entry, in both the parsed and the raw payload. */
type ArchidektEntryCard = {
  collectorNumber?: string
  edition?: { editioncode?: string }
}

/**
 * The printing an Archidekt deck entry names, normalized the way Ritual's
 * lookups need it.
 *
 * Both the deck parser and the upload planner read printings off Archidekt
 * entries, and a deck sync **joins their answers by printing key** — the parsed
 * deck supplies the diff's remote side while the raw payload supplies the
 * relations the plan patches. Two derivations that drifted apart would not fail
 * loudly; every card would simply stop matching. Hence one function.
 */
export function archidektEntryPrinting(
  card: ArchidektEntryCard | undefined,
  modifier: ArchidektCardModifier | undefined,
): ArchidektEntryPrinting {
  // Both halves of the printing or neither: a card line cannot express a set
  // without a collector number, so lifting one alone would be a silent loss.
  const printing = resolvePrinting(card?.edition?.editioncode, card?.collectorNumber)
  return {
    set: printing?.set,
    collectorNumber: printing?.collectorNumber,
    finish: archidektFinish(modifier),
  }
}

/**
 * Parse an Archidekt deck response into a DeckData object.
 *
 * The printing each entry names — set code, collector number, and foil/etched
 * modifier — is carried through as stated by Archidekt, at the same trust level
 * as a CSV import: nothing is verified against Scryfall. Set codes are
 * lowercased for the in-memory representation; the markdown serializer
 * uppercases them on the way out.
 *
 * Entries of the same card AND the same printing in one section merge into a
 * single line; different printings stay separate lines.
 */
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
  const sectionsMap = new Map<string, Map<string, Card>>()

  /** Entries carrying no resolvable card name; reported rather than dropped in silence. */
  let unnamedEntries = 0

  if (json.cards && Array.isArray(json.cards)) {
    for (const entry of json.cards) {
      const cardName = entry.card?.oracleCard?.name || entry.card?.name
      const quantity = entry.quantity ?? 1

      if (!cardName) {
        unnamedEntries++
        continue
      }

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

      const { set, collectorNumber, finish } = archidektEntryPrinting(entry.card, entry.modifier)

      if (!sectionsMap.has(sectionName)) {
        sectionsMap.set(sectionName, new Map())
      }
      const sectionCards = sectionsMap.get(sectionName)!
      const key = `${cardName.toLowerCase()}|${set ?? ''}|${collectorNumber ?? ''}|${finish ?? ''}`
      const existing = sectionCards.get(key)
      if (existing) {
        existing.quantity += quantity
      } else {
        sectionCards.set(key, { name: cardName, quantity, set, collectorNumber, finish })
      }
    }
  }

  if (unnamedEntries > 0) {
    getLogger().warn(
      `Archidekt deck ${deckId}: skipped ${t('domain.count.cardEntries', { count: unnamedEntries })} with no card name.`,
    )
  }

  const sections: DeckSection[] = []
  // Canonical board order lives in `BOARDS`; widened to string[] so `indexOf` can
  // take raw (possibly custom, non-board) section names.
  const sortOrder: readonly string[] = BOARDS

  for (const [name, cardMap] of sectionsMap.entries()) {
    sections.push({ name, cards: Array.from(cardMap.values()) })
  }

  sections.sort((a, b) => {
    const idxA = sortOrder.indexOf(a.name)
    const idxB = sortOrder.indexOf(b.name)
    if (idxA === -1 && idxB === -1) return compareData(a.name, b.name)
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
