/**
 * How both sync engines name a card in the lines they log. A leaf with no
 * filesystem or network imports, so the admin bundle can render the same text
 * from a finished report that the engines stream while they run.
 */

import { formatPrintingAnnotation, type PrintingAnnotationInput } from '../changes/change-event'

/**
 * A card and its variant as a sync line reads it, e.g.
 * `Karlach, Fury of Avernus (CLB:507) [etched] [LP]`. Built from the same
 * annotation formatter changelog lines use, so defaults are omitted and set
 * codes uppercased exactly as they are everywhere else. Without a printing it
 * is the name alone.
 */
export function describeSyncCard(name: string, printing?: PrintingAnnotationInput): string {
  return printing === undefined ? name : `${name}${formatPrintingAnnotation(printing)}`
}
