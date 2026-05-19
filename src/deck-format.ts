import type { DeckData, DeckSection } from './types'

export type DeckFormatKey =
  | 'commander'
  | 'oathbreaker'
  | 'standard'
  | 'modern'
  | 'pioneer'
  | 'legacy'
  | 'vintage'
  | 'pauper'
  | 'historic'
  | 'brawl'
  | 'duel-commander'
  | 'pre-modern'
  | 'limited'

interface FormatInfo {
  label: string
  /**
   * The card count expected for a "standard" deck in this format. Counts only
   * the main deck (commander/oathbreaker/signature included; sideboard,
   * maybeboard, tokens, and other extras excluded).
   */
  expectedMainboardSize: number
}

const FORMAT_INFO: Record<DeckFormatKey, FormatInfo> = {
  commander: { label: 'Commander', expectedMainboardSize: 100 },
  oathbreaker: { label: 'Oathbreaker', expectedMainboardSize: 60 },
  standard: { label: 'Standard', expectedMainboardSize: 60 },
  modern: { label: 'Modern', expectedMainboardSize: 60 },
  pioneer: { label: 'Pioneer', expectedMainboardSize: 60 },
  legacy: { label: 'Legacy', expectedMainboardSize: 60 },
  vintage: { label: 'Vintage', expectedMainboardSize: 60 },
  pauper: { label: 'Pauper', expectedMainboardSize: 60 },
  historic: { label: 'Historic', expectedMainboardSize: 60 },
  brawl: { label: 'Brawl', expectedMainboardSize: 60 },
  'duel-commander': { label: 'Duel Commander', expectedMainboardSize: 100 },
  'pre-modern': { label: 'Pre-Modern', expectedMainboardSize: 60 },
  limited: { label: 'Limited', expectedMainboardSize: 40 },
}

export function getDeckFormatLabel(format: DeckFormatKey): string {
  return FORMAT_INFO[format].label
}

export function isCommanderSection(name: string): boolean {
  return name.toLowerCase().includes('commander')
}

export function isOathbreakerSection(name: string): boolean {
  const low = name.toLowerCase()
  return low.includes('oathbreaker') || low.includes('signature spell')
}

export function isSideboardSection(name: string): boolean {
  return name.toLowerCase().includes('sideboard')
}

export function isExtraSection(name: string): boolean {
  const low = name.toLowerCase()
  return low.includes('maybeboard') || low.includes('token')
}

/**
 * True for sections that count toward the main deck size (commander +
 * mainboard, including oathbreaker/signature spell). Sideboard, maybeboard,
 * and token sections are excluded.
 */
export function isMainDeckSection(name: string): boolean {
  return !isSideboardSection(name) && !isExtraSection(name)
}

/**
 * Sum of card quantities across the main deck (commander/oathbreaker +
 * mainboard). Sideboard/maybeboard/token sections are excluded so a "60-card"
 * format with a sideboard still reports 60.
 */
export function getMainDeckSize(sections: DeckSection[]): number {
  let total = 0
  for (const section of sections) {
    if (!isMainDeckSection(section.name)) continue
    for (const card of section.cards) total += card.quantity
  }
  return total
}

const FORMAT_KEYS = new Set<string>(Object.keys(FORMAT_INFO))

function normalizeFormatKey(raw: string): DeckFormatKey | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
  return FORMAT_KEYS.has(normalized) ? (normalized as DeckFormatKey) : null
}

/**
 * Determine the deck's format from its `format` frontmatter field if present,
 * falling back to heuristic detection from section names. Returns null when no
 * format can be inferred.
 */
export function detectDeckFormat(deck: DeckData): DeckFormatKey | null {
  if (deck.format) {
    const fromFrontMatter = normalizeFormatKey(deck.format)
    if (fromFrontMatter) return fromFrontMatter
  }
  if (deck.sections.some((s) => isOathbreakerSection(s.name))) return 'oathbreaker'
  if (deck.sections.some((s) => isCommanderSection(s.name))) return 'commander'
  return null
}

export interface DeckCountLabel {
  /** Primary label shown in normal weight (format name, or "X cards" fallback). */
  primary: string
  /** Optional parenthetical, rendered smaller, when the size is unusual. */
  suffix?: string
}

export function pluralizeCards(count: number): string {
  return `${count} card${count === 1 ? '' : 's'}`
}

/**
 * Build the deck cover label. When a format is known, show the format name and
 * only include the card count parenthetically if it deviates from the format's
 * expected mainboard size. When no format is known, fall back to the raw card
 * count.
 */
export function getDeckCountLabel(
  format: DeckFormatKey | null,
  mainboardSize: number,
): DeckCountLabel {
  if (!format) return { primary: pluralizeCards(mainboardSize) }
  const info = FORMAT_INFO[format]
  if (mainboardSize === info.expectedMainboardSize) return { primary: info.label }
  return { primary: info.label, suffix: `(${pluralizeCards(mainboardSize)})` }
}
