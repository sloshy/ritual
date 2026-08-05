/**
 * Card Kingdom's sell-cart CSV import format
 * (`card name,edition,foil,quantity` — cardkingdom.com/static/csvImport).
 *
 * Extracted from the sell report engine so the browser can build the same file
 * from client-held quotes: the CLI (`ritual sell --output csv`), the admin sell
 * endpoint, and the site's "Copy CK cart CSV" all render byte-identical rows.
 *
 * Browser-safe: imports only `csv.ts` and `card-line.ts`.
 */

import { aggregateQuantities } from '../card-line'
import { csvCell } from '../csv'
import type { Finish } from '../types'

/** Card Kingdom's sell-cart CSV import caps (per upload). */
export const CK_CSV_MAX_TITLES = 500
export const CK_CSV_MAX_CARDS = 5000

/**
 * One line of a CK cart, in CK's own vocabulary. `name` and `edition` must be
 * the buyer's spellings (from the matched product), not Ritual's — that is what
 * makes the file importable.
 */
export type CkCartItem = {
  name: string
  edition: string
  finish: Finish
  /** Copies to sell — already capped at what CK is buying. */
  quantity: number
}

/** A rendered sell-cart CSV plus its size against CK's upload caps. */
export type SellCartCsv = {
  csv: string
  titleCount: number
  cardCount: number
  warnings: string[]
}

/** CK's importer keys on name + edition + foil, so rows aggregate to that grain. */
function cartRowKey(item: CkCartItem): string {
  return `${item.name.toLowerCase()}|${item.edition}|${item.finish !== 'nonfoil'}`
}

/**
 * Render cart items as CK's import CSV. Items are aggregated to CK's
 * name+edition+foil grain and zero-quantity items are dropped. The format
 * cannot express etched, so etched items export as foil with a warning naming
 * every affected card, and the advisory upload caps are reported rather than
 * enforced — a too-large file is still a correct file, it just needs splitting.
 */
export function buildCkCartCsv(items: CkCartItem[]): SellCartCsv {
  const sellable = items.filter((item) => item.quantity > 0)

  const etched: string[] = []
  for (const item of sellable) {
    if (item.finish === 'etched' && !etched.includes(item.name)) etched.push(item.name)
  }

  const rows = aggregateQuantities(sellable, cartRowKey, (item) => item.quantity)

  const lines = ['card name,edition,foil,quantity']
  let cardCount = 0
  for (const { entry, quantity } of rows) {
    cardCount += quantity
    lines.push(
      [
        csvCell(entry.name),
        csvCell(entry.edition),
        String(entry.finish !== 'nonfoil'),
        String(quantity),
      ].join(','),
    )
  }

  const warnings: string[] = []
  if (etched.length > 0) {
    warnings.push(
      `The CK CSV format cannot mark etched foils; exported as foil — adjust in the sell cart: ${etched.join(', ')}`,
    )
  }
  if (rows.length > CK_CSV_MAX_TITLES) {
    warnings.push(
      `CK imports at most ${CK_CSV_MAX_TITLES} unique titles per upload (this file has ${rows.length}); split it before uploading.`,
    )
  }
  if (cardCount > CK_CSV_MAX_CARDS) {
    warnings.push(
      `CK imports at most ${CK_CSV_MAX_CARDS} cards per upload (this file has ${cardCount}); split it before uploading.`,
    )
  }

  return { csv: `${lines.join('\n')}\n`, titleCount: rows.length, cardCount, warnings }
}
