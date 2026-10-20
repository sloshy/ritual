/**
 * Text formatting for the rows of the CLI's interactive pickers, shared by the
 * commands that list cards in one (the price browser, the export wizard).
 */

import { t } from '../i18n/t'

/**
 * A picker row led by its copy count — `2x Sol Ring (LEA:232) …` — or the row
 * alone for a single copy. The one wording of that shape, so the price browser
 * and the export wizard cannot drift apart.
 */
export function quantityRow(count: number, item: string): string {
  return count > 1 ? t('cli.row.quantity', { count, item }) : item
}
