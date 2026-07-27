import { printingSuffix } from '../card-line'
import { findPrinting, hasSpecificPrinting, type CardPrintingsLookup } from '../card-printing'
import type { ScryfallCard } from '../types'
import type { ExportEntry } from './entries'
import type { ExportProperty } from './render'

/**
 * Resolving the one export property that is not in the list files: the
 * `scryfallId` column, looked up in the local Scryfall cache from the entry's
 * name plus its pinned printing.
 *
 * Kept out of the loading pipeline on purpose — every other column is answered
 * by the file itself, so an export only touches the cache when the selected
 * columns actually ask for an id.
 */

/** Entries with their ids filled in, plus one warning per unresolvable printing. */
export type ScryfallIdResolution = {
  entries: ExportEntry[]
  /** One message per distinct printing that has no id, in first-seen order. */
  warnings: string[]
}

/** Whether a column selection needs the Scryfall cache consulted at all. */
export function columnsNeedScryfallIds(columns: readonly ExportProperty[]): boolean {
  return columns.includes('scryfallId')
}

/**
 * Fill in {@link ExportEntry.scryfallId} for every entry whose printing the
 * cache holds, returning fresh entries (the inputs are never mutated — the
 * wizard reuses one loaded set across renders).
 *
 * Two things stop an entry from getting an id, and both are warned about once
 * per distinct printing rather than once per copy: an entry with no pinned
 * printing (nothing to look up), and a printing the cache does not hold. Either
 * way the cell renders empty — an export of 400 cards must not fail over one
 * uncached printing.
 */
export async function resolveExportScryfallIds(
  entries: readonly ExportEntry[],
  lookup: CardPrintingsLookup,
): Promise<ScryfallIdResolution> {
  const warnings: string[] = []
  const warned = new Set<string>()

  // One lookup per distinct name per run: an export repeats names often (several
  // copies, several printings, several lists), and the lookup is a cache read.
  const printingsByName = new Map<string, ScryfallCard[]>()
  const printingsFor = async (name: string): Promise<ScryfallCard[]> => {
    const memoKey = name.toLowerCase()
    const cached = printingsByName.get(memoKey)
    if (cached) return cached
    const printings = await lookup(name)
    printingsByName.set(memoKey, printings)
    return printings
  }

  const warn = (key: string, message: string): void => {
    if (warned.has(key)) return
    warned.add(key)
    warnings.push(message)
  }

  const resolved: ExportEntry[] = []
  for (const entry of entries) {
    if (!hasSpecificPrinting(entry)) {
      warn(
        `${entry.name.toLowerCase()}|`,
        `No Scryfall ID for ${entry.name}: the entry has no set and collector number.`,
      )
      resolved.push(entry)
      continue
    }
    const printing = findPrinting(await printingsFor(entry.name), entry.set, entry.collectorNumber)
    if (!printing) {
      warn(
        `${entry.name.toLowerCase()}|${entry.set}|${entry.collectorNumber}`,
        `No Scryfall ID for ${entry.name}${printingSuffix(entry.set, entry.collectorNumber)}: the printing is not in the Scryfall cache.`,
      )
      resolved.push(entry)
      continue
    }
    resolved.push({ ...entry, scryfallId: printing.id })
  }

  return { entries: resolved, warnings }
}
