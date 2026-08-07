import type { Finish } from '../types'
import type { CardLanguage } from '../card-language'
import type { WantedListCardEntry, WantedListEntryState } from '../site/data-types'
import { DEFAULT_SECTION } from '../types'

/** A wanted-list entry as parsed from disk (the shape the wanted load endpoint returns). */
export type ParsedWantedEntry = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** The line's `[ja]`-style language token. Absent means `en`. */
  language?: CardLanguage
  note?: string
  cardId?: number
  section?: string
}

function wantedState(entry: ParsedWantedEntry): WantedListEntryState {
  if (!entry.set || !entry.collectorNumber) return 'name-only'
  return entry.finish ? 'fully-specified' : 'printing'
}

/**
 * Convert the parsed entries returned by the wanted load endpoint into the
 * card-entry shape `applyChangeToWantedList` operates on. The wanted save
 * endpoint serializes the entries it receives (unlike the collection endpoint,
 * which re-derives them from disk), so changes must be applied to these and the
 * full entry list sent back. Shared by the MCP mutations and the change-bundle
 * import engine.
 */
export function toWantedCardEntries(parsed: ParsedWantedEntry[]): WantedListCardEntry[] {
  return parsed.map((entry, index) => ({
    name: entry.name,
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    language: entry.language,
    price: 0,
    fileOrder: index,
    section: entry.section ?? DEFAULT_SECTION,
    note: entry.note,
    state: wantedState(entry),
    cardId: entry.cardId,
  }))
}
