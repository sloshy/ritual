import { printingSuffix } from '../card/card-line'
import {
  edhrecRankOf,
  findPrinting,
  hasSpecificPrinting,
  memoizePrintingsLookup,
  type CardPrintingsLookup,
} from '../card/card-printing'
import type { ExportEntry } from './entries'
import type { ExportProperty } from './render'

/**
 * Resolving the export properties that are not in the list files — the
 * `scryfallId` and `edhrecRank` columns — from the local Scryfall cache, by the
 * entry's name plus (for the id) its pinned printing.
 *
 * Kept out of the loading pipeline on purpose — every other column is answered
 * by the file itself, so an export only touches the cache when the selected
 * columns actually ask for cached card data.
 */

/** Entries with cached card data filled in, plus one warning per unresolvable card. */
export type CacheColumnResolution = {
  entries: ExportEntry[]
  /** One message per distinct printing (or name) that could not be resolved, in first-seen order. */
  warnings: string[]
}

/** Fills one cache-answered column in on a set of entries. */
type CacheColumnResolver = (
  entries: readonly ExportEntry[],
  lookup: CardPrintingsLookup,
) => Promise<CacheColumnResolution>

/**
 * The columns answered from the Scryfall cache rather than the list file, each
 * with its resolver — one table, so a column cannot be declared cache-answered
 * without something filling it in.
 */
const CACHE_COLUMN_RESOLVERS = {
  scryfallId: resolveExportScryfallIds,
  edhrecRank: resolveExportEdhrecRanks,
} as const satisfies Partial<Record<ExportProperty, CacheColumnResolver>>

type CacheColumn = keyof typeof CACHE_COLUMN_RESOLVERS

function isCacheColumn(column: ExportProperty): column is CacheColumn {
  return Object.hasOwn(CACHE_COLUMN_RESOLVERS, column)
}

/** Whether a column selection needs the Scryfall cache consulted at all. */
export function columnsNeedCardCache(columns: readonly ExportProperty[]): boolean {
  return columns.some(isCacheColumn)
}

/** Warnings collected so far, and the sink that keeps only the first per key. */
type WarningCollector = {
  warnings: string[]
  warn: (key: string, message: string) => void
}

/** Collects warnings, keeping only the first per key. */
function warningCollector(): WarningCollector {
  const warnings: string[] = []
  const warned = new Set<string>()
  return {
    warnings,
    warn: (key, message) => {
      if (warned.has(key)) return
      warned.add(key)
      warnings.push(message)
    },
  }
}

/**
 * Fill in every cache-answered column the selection asks for, returning fresh
 * entries, with one lookup per distinct name across all of them. The one entry
 * point `renderExport` calls.
 */
export async function resolveExportCacheColumns(
  entries: readonly ExportEntry[],
  columns: readonly ExportProperty[],
  lookup: CardPrintingsLookup,
): Promise<CacheColumnResolution> {
  const memoized = memoizePrintingsLookup(lookup)
  let resolved: readonly ExportEntry[] = entries
  const warnings: string[] = []
  for (const column of columns.filter(isCacheColumn)) {
    const resolution = await CACHE_COLUMN_RESOLVERS[column](resolved, memoized)
    resolved = resolution.entries
    warnings.push(...resolution.warnings)
  }
  return { entries: [...resolved], warnings }
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
): Promise<CacheColumnResolution> {
  const { warnings, warn } = warningCollector()
  const printingsFor = memoizePrintingsLookup(lookup)

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
    // Language-aware: a `[ja]` entry under an `all_cards` cache exports the
    // Japanese object's id, falling back per `findPrinting` (the English object,
    // then whatever the cache holds) when that language object is not cached.
    const printing = findPrinting(
      await printingsFor(entry.name),
      entry.set,
      entry.collectorNumber,
      entry.language,
    )
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

/**
 * Fill in {@link ExportEntry.edhrecRank} for every entry whose card the cache
 * holds and EDHREC has ranked, returning fresh entries. The rank is the card's,
 * not the printing's, so an entry with no pinned printing still gets one. A
 * card the cache does not hold at all is warned about once per name; an
 * unranked card is not — "EDHREC has no rank for it" is an honest empty cell,
 * not a gap in the local data.
 */
export async function resolveExportEdhrecRanks(
  entries: readonly ExportEntry[],
  lookup: CardPrintingsLookup,
): Promise<CacheColumnResolution> {
  const { warnings, warn } = warningCollector()
  const printingsFor = memoizePrintingsLookup(lookup)

  const resolved: ExportEntry[] = []
  for (const entry of entries) {
    const printings = await printingsFor(entry.name)
    if (printings.length === 0) {
      warn(
        entry.name.toLowerCase(),
        `No EDHREC rank for ${entry.name}: the card is not in the Scryfall cache.`,
      )
      resolved.push(entry)
      continue
    }
    const edhrecRank = edhrecRankOf(printings)
    resolved.push(edhrecRank === undefined ? entry : { ...entry, edhrecRank })
  }

  return { entries: resolved, warnings }
}
