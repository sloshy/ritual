// The on-disk grammar (parseWantedListFile / WantedListEntry) lives in `wanted-file.ts`.
import type { Finish } from '../card/finish-condition'
import { hasSpecificPrinting, type FinishedPrintingFields } from '../card/card-printing'
import type { CardLanguage } from '../card/card-language'
import type { CardTag } from '../card/card-tags'
import type { WantedListCardEntry, WantedListEntryState } from './site-data'
import { DEFAULT_SECTION } from './deck'

/** A wanted-list entry as parsed from disk (the shape the wanted load endpoint returns). */
export type ParsedWantedEntry = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** The line's `[ja]`-style language token. Absent means `en`. */
  language?: CardLanguage
  /** The line's `#tag` tokens in canonical form; absent when it carries none. */
  tags?: CardTag[]
  note?: string
  cardId?: number
  section?: string
}

/**
 * How specific a wanted entry is: no printing at all, a printing, or a printing
 * in a stated finish. The one rule — the apply engine recomputes the state on
 * every write and must not reach a different answer than the parser did.
 */
export function wantedState(entry: FinishedPrintingFields): WantedListEntryState {
  if (!hasSpecificPrinting(entry)) return 'name-only'
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
    tags: entry.tags,
    price: 0,
    fileOrder: index,
    section: entry.section ?? DEFAULT_SECTION,
    note: entry.note,
    state: wantedState(entry),
    cardId: entry.cardId,
  }))
}
