/**
 * Card Kingdom's sell-cart CSV import format — the columns
 * `card name, edition, foil, quantity` with no header row
 * (cardkingdom.com/static/csvImport).
 *
 * Extracted from the sell report engine so the browser can build the same file
 * from client-held quotes: the CLI (`ritual sell --output csv`), the admin sell
 * endpoint, and the site's "Copy CK cart CSV" all render byte-identical rows.
 *
 * Browser-safe: imports only `csv.ts` and `card-line.ts`.
 *
 * **Persistence fence — this module must never import `src/i18n`.** The file it
 * writes is read by CK's importer, so every byte of it is a machine contract
 * that may not follow the UI locale. What it has to tell the user beside the
 * file is a {@link CartWarning} — a code and the values its sentence needs —
 * worded by `src/buylist/cart-message.ts`, in English plus the key for the
 * admin API and MCP, in the reader's language on the CLI and the sites.
 */

import { aggregateQuantities } from '../card/card-line'
import { csvCell } from '../changes/csv'
import type { Finish } from '../card/finish-condition'

/** Card Kingdom's sell-cart CSV import caps (per upload). */
export const CK_CSV_MAX_TITLES = 500
export const CK_CSV_MAX_CARDS = 5000

/**
 * One line of a CK cart, in CK's own vocabulary. `name`, `edition` and
 * `variation` must be the buyer's spellings (from the matched product), not
 * Ritual's — that is what makes the file importable.
 */
export type CkCartItem = {
  name: string
  edition: string
  /** CK's variant note for the matched product (`Borderless`, `298 - Borderless Ichor`), when they publish one. */
  variation?: string
  finish: Finish
  /** Copies to sell — already capped at what CK is buying. */
  quantity: number
}

/**
 * CK's own listing title for a product: the card name plus their variant note
 * in parentheses (`Mishra's Factory (Autumn)`), which is how a variant printing
 * is titled on their store and in their sell cart. A bare name leaves their
 * importer to pick between every printing of the card, so exporting the listed
 * title is what makes a variant row land on the right product.
 */
export function ckListedName(item: Pick<CkCartItem, 'name' | 'variation'>): string {
  return item.variation ? `${item.name} (${item.variation})` : item.name
}

/**
 * What each cart warning code carries. `titles` are the etched items' listed
 * titles ({@link ckListedName}), in first-seen order — CK's own spellings, the
 * same in every language. `count` is the file's figure and `max` CK's cap.
 */
export type CartWarningParams = {
  /** The format cannot express etched, so these items were exported as foil. */
  'etched-as-foil': { titles: readonly string[] }
  /** More unique titles than CK imports per upload. */
  'too-many-titles': { count: number; max: number }
  /** More cards than CK imports per upload. */
  'too-many-cards': { count: number; max: number }
}

export type CartWarningCode = keyof CartWarningParams

/** Something the cart builder reports beside the file: a code and the values it needs. */
export type CartWarning = {
  [C in CartWarningCode]: { code: C; params: CartWarningParams[C] }
}[CartWarningCode]

/** A rendered sell-cart CSV plus its size against CK's upload caps. */
export type SellCartCsv = {
  csv: string
  titleCount: number
  cardCount: number
  warnings: CartWarning[]
}

/**
 * CK's importer keys on the listed title + edition + foil, so rows aggregate to that
 * grain — two variants of one card in one edition stay two rows, as CK lists them.
 */
function cartRowKey(item: CkCartItem): string {
  return `${ckListedName(item).toLowerCase()}|${item.edition}|${item.finish !== 'nonfoil'}`
}

/**
 * Render cart items as CK's import CSV. Items are aggregated to CK's
 * title+edition+foil grain and zero-quantity items are dropped. The file carries
 * no header row — CK's importer expects data rows only and prompts for column
 * matching itself. The format cannot express etched, so etched items export as
 * foil with a warning naming every affected card, and the advisory upload caps
 * are reported rather than enforced — a too-large file is still a correct file,
 * it just needs splitting.
 */
export function buildCkCartCsv(items: CkCartItem[]): SellCartCsv {
  const sellable = items.filter((item) => item.quantity > 0)

  const etched: string[] = []
  for (const item of sellable) {
    const listed = ckListedName(item)
    if (item.finish === 'etched' && !etched.includes(listed)) etched.push(listed)
  }

  const rows = aggregateQuantities(sellable, cartRowKey, (item) => item.quantity)

  const lines: string[] = []
  let cardCount = 0
  for (const { entry, quantity } of rows) {
    cardCount += quantity
    lines.push(
      [
        csvCell(ckListedName(entry)),
        csvCell(entry.edition),
        String(entry.finish !== 'nonfoil'),
        String(quantity),
      ].join(','),
    )
  }

  const warnings: CartWarning[] = []
  if (etched.length > 0) warnings.push({ code: 'etched-as-foil', params: { titles: etched } })
  if (rows.length > CK_CSV_MAX_TITLES) {
    warnings.push({
      code: 'too-many-titles',
      params: { count: rows.length, max: CK_CSV_MAX_TITLES },
    })
  }
  if (cardCount > CK_CSV_MAX_CARDS) {
    warnings.push({ code: 'too-many-cards', params: { count: cardCount, max: CK_CSV_MAX_CARDS } })
  }

  const csv = lines.length > 0 ? `${lines.join('\n')}\n` : ''
  return { csv, titleCount: rows.length, cardCount, warnings }
}
