import type { HttpClient } from '../interfaces'
import { throwHttpError } from '../errors'

export const SCRYFALL_BULK_API_URL = 'https://api.scryfall.com/bulk-data'

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
