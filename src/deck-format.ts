import type { DeckData, DeckSection } from './types'

/**
 * The canonical deck formats. This is the *only* vocabulary a deck's `format`
 * may take: every surface that reads a format (file front matter, CLI flag,
 * admin form, Archidekt, Moxfield) runs its input through {@link parseDeckFormat}
 * first, and every surface that writes a deck persists the key it returns.
 */
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
  | 'alchemy'
  | 'explorer'
  | 'timeless'
  | 'penny-dreadful'
  | 'brawl'
  | 'historic-brawl'
  | 'duel-commander'
  | 'pauper-commander'
  | 'pre-dh'
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
  alchemy: { label: 'Alchemy', expectedMainboardSize: 60 },
  explorer: { label: 'Explorer', expectedMainboardSize: 60 },
  timeless: { label: 'Timeless', expectedMainboardSize: 60 },
  'penny-dreadful': { label: 'Penny Dreadful', expectedMainboardSize: 60 },
  brawl: { label: 'Brawl', expectedMainboardSize: 60 },
  'historic-brawl': { label: 'Historic Brawl', expectedMainboardSize: 100 },
  'duel-commander': { label: 'Duel Commander', expectedMainboardSize: 100 },
  'pauper-commander': { label: 'Pauper Commander', expectedMainboardSize: 100 },
  'pre-dh': { label: 'PreDH', expectedMainboardSize: 100 },
  'pre-modern': { label: 'Pre-Modern', expectedMainboardSize: 60 },
  limited: { label: 'Limited', expectedMainboardSize: 40 },
}

/**
 * Alternate spellings that resolve to a canonical key. Covers the names external
 * services use (Archidekt's "Commander / EDH" and "Dual Commander", Moxfield's
 * "duelCommander", "penny", "predh") as well as the shorthand a user is likely
 * to type. Keys here are already slugified by {@link parseDeckFormat}.
 */
const FORMAT_ALIASES: Record<string, DeckFormatKey> = {
  edh: 'commander',
  'commander-edh': 'commander',
  'edh-commander': 'commander',
  '1v1-commander': 'duel-commander',
  'commander-1v1': 'duel-commander',
  'dual-commander': 'duel-commander',
  penny: 'penny-dreadful',
  pdh: 'pauper-commander',
  'pauper-edh': 'pauper-commander',
  predh: 'pre-dh',
  premodern: 'pre-modern',
  draft: 'limited',
  sealed: 'limited',
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

/** Every legal deck format key, in declaration order. */
export const DECK_FORMAT_KEYS = Object.keys(FORMAT_INFO) as DeckFormatKey[]

function isDeckFormatKey(value: string): value is DeckFormatKey {
  return value in FORMAT_INFO
}

/**
 * Parse an untrusted format value — a front matter field, a CLI flag, an admin
 * form value, an Archidekt label, a Moxfield slug — into a canonical
 * {@link DeckFormatKey}. Returns null when the value is absent, not a string, or
 * names a format Ritual does not model (e.g. Archidekt's "Custom").
 *
 * This is the single entry point for turning outside text into a format; no
 * other module should compare or lowercase format strings itself.
 */
export function parseDeckFormat(raw: unknown): DeckFormatKey | null {
  if (typeof raw !== 'string') return null
  const slug = raw
    .trim()
    // Split camelCase so Moxfield's `duelCommander` slugs to `duel-commander`.
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    // Collapse every other separator (spaces, underscores, slashes) to a dash.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) return null
  if (isDeckFormatKey(slug)) return slug
  return FORMAT_ALIASES[slug] ?? null
}

/**
 * The message shown when {@link parseDeckFormat} rejects a user-supplied format.
 * Lives here so the CLI, the admin API, and any other caller reject a bad format
 * in the same words, listing the same keys.
 */
export function invalidDeckFormatMessage(raw: unknown): string {
  return `Invalid deck format '${String(raw)}'. Valid formats: ${DECK_FORMAT_KEYS.join(', ')}`
}

/**
 * Resolve the format a deck should be treated as: its declared format when it
 * has (and can parse) one, otherwise a heuristic read of its section names.
 * `frontMatterFormat` is the raw front matter value, for callers that hold the
 * front matter separately from the parsed {@link DeckData}. Returns null when no
 * format can be determined.
 *
 * Every surface — the site, the editors, the CLI menus — resolves through this,
 * and `serializeDeckToMarkdown` persists what it returns, so a deck's format
 * reads the same everywhere and stops being a guess after its first save.
 */
export function resolveDeckFormat(
  deck: DeckData,
  frontMatterFormat?: unknown,
): DeckFormatKey | null {
  const declared = parseDeckFormat(deck.format ?? frontMatterFormat)
  if (declared) return declared
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
