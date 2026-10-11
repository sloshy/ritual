/**
 * How both sync engines name a card in the lines they log. A leaf with no
 * filesystem or network imports, so the admin bundle can render the same text
 * from a finished report that the engines stream while they run.
 */

import { formatPrintingAnnotation, type PrintingAnnotationInput } from '../changes/change-event'
import type { SyncText } from './message'

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

/**
 * One line of an item's change listing, at the level the run logs it — held as
 * a message, so each surface renders it in its reader's locale.
 */
export type ItemChangeLine = { level: 'info' | 'detail'; text: SyncText }

/**
 * An item's change lines in the one order every surface shows them: the
 * `Changes:` count line (when there is one), then a detail line per card. The
 * engines emit these and the admin pages replay them from a finished report,
 * so the order cannot drift between the stream and the fallback.
 */
export function itemChangeLines(
  changesLine: SyncText | undefined,
  details: readonly SyncText[],
): ItemChangeLine[] {
  return [
    ...(changesLine === undefined ? [] : [{ level: 'info' as const, text: changesLine }]),
    ...details.map((text): ItemChangeLine => ({ level: 'detail', text })),
  ]
}
