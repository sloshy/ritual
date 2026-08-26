import type { HttpClient } from '../util/interfaces'
import { throwHttpError } from '../util/errors'
import { getDefaultLanguage } from '../config/ritual-config'

export const SCRYFALL_BULK_API_URL = 'https://api.scryfall.com/bulk-data'

/**
 * The Scryfall bulk files a card cache can be built from: `default_cards`
 * holds one card object per printing (English, or the printed language when no
 * English object exists), while `all_cards` holds every language's object of
 * every printing (a several-times-larger download).
 */
export type CardBulkType = 'default_cards' | 'all_cards'

export const CARD_BULK_TYPES: readonly CardBulkType[] = ['default_cards', 'all_cards']

export function isCardBulkType(value: string): value is CardBulkType {
  return (CARD_BULK_TYPES as readonly string[]).includes(value)
}

/**
 * Which card bulk the configured `defaultLanguage` demands: `en` works from
 * the English-only `default_cards` bulk (as always), while any other default
 * language needs `all_cards` so the cache actually holds the objects that
 * language's printings resolve to. The single rule every bulk download path —
 * direct Scryfall preload, cache feed, cache server — selects its card bulk by.
 */
export function configuredCardBulkType(): CardBulkType {
  return getDefaultLanguage() === 'en' ? 'default_cards' : 'all_cards'
}

/** One entry of Scryfall's `/bulk-data` manifest (the fields ritual uses). */
export type ScryfallBulkManifestEntry = {
  type: string
  /** URL of the gzipped-JSONL form of this bulk file (`*.jsonl.gz`). */
  jsonl_download_uri: string
  updated_at?: string
}

type ScryfallBulkManifest = { data?: ScryfallBulkManifestEntry[] }

/**
 * Fetch the Scryfall bulk-data manifest listing each available bulk file.
 * Callers validate the presence of the fields they specifically require.
 */
export async function fetchScryfallBulkManifest(
  http: HttpClient,
  url: string = SCRYFALL_BULK_API_URL,
): Promise<ScryfallBulkManifestEntry[]> {
  const response = await http.fetch(url)
  if (!response.ok) throwHttpError(response, 'Failed to fetch bulk manifest')
  const json = (await response.json()) as ScryfallBulkManifest
  return json.data ?? []
}
