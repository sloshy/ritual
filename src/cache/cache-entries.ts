/**
 * What counts as card-cache data inside a cache directory. Only the entries
 * Ritual itself writes count: a lock file, a move marker, an interrupted
 * copy, or an operating system's own litter (`.DS_Store`, `Thumbs.db`) does
 * not make a directory "hold a cache", so it can neither stop a cache from
 * moving into it nor make an empty workspace folder look like one.
 *
 * A new file the cache writes must be added to {@link CACHE_ENTRY_NAMES}.
 */

import { readdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import { hasErrorCode } from '../util/errno'

/** Every top-level entry the card cache writes into its directory. */
export const CACHE_ENTRY_NAMES: ReadonlySet<string> = new Set([
  'cache.json', // the card and price cache (`file-cache.ts`)
  'card-bulk.json', // which Scryfall bulk built it (`bulk-provenance.ts`)
  'tags.json', // Scryfall Tagger tags (`scryfall/client.ts`)
  'symbology.json', // mana symbols (`scryfall/client.ts`)
  'images', // card and symbol images (`scryfall/client.ts`)
  'cardkingdom.json', // the Card Kingdom buylist (`cardkingdom/cache.ts`)
  'feed-client', // cache-feed sync state (`refresh-source.ts`)
  'feed', // a cache feed host's artifacts (`commands/cache-feed.ts`)
])

/** Whether a directory listing holds any cache data. */
export function listingHasCacheData(entries: readonly string[]): boolean {
  return entries.some((entry) => CACHE_ENTRY_NAMES.has(entry))
}

/** A directory's entries, or none when it is missing (or not a directory). */
export async function entriesOf(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch (e) {
    if (hasErrorCode(e, 'ENOENT') || hasErrorCode(e, 'ENOTDIR')) return []
    throw e
  }
}

/** Whether a cache directory holds cache data. A missing directory holds none. */
export async function hasCacheData(dir: string): Promise<boolean> {
  return listingHasCacheData(await entriesOf(dir))
}

/**
 * {@link hasCacheData}, synchronously — for the cache-directory resolution
 * that runs on every cache read. Any failure to list reads as "no data".
 */
export function hasCacheDataSync(dir: string): boolean {
  try {
    return listingHasCacheData(readdirSync(dir))
  } catch {
    return false
  }
}
