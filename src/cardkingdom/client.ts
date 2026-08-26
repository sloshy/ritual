import { getErrorMessage } from '../util/errors'
import type { HttpClient } from '../util/interfaces'
import { parseCardKingdomFeed, type ParsedCardKingdomFeed } from './feed'

/** Card Kingdom's public MTG-singles pricelist (retail + buylist), ~70 MB JSON. */
export const CARDKINGDOM_PRICELIST_URL = 'https://api.cardkingdom.com/api/v2/pricelist'

/**
 * Download and parse the pricelist feed. Returns an error string (never
 * throws) on network failure, a non-OK response, or an unparseable payload.
 * Like the Scryfall bulk download, no request timeout is applied — the body is
 * large by design and a slow link must not abort it.
 */
export async function fetchCardKingdomFeed(
  http: HttpClient,
  url: string = CARDKINGDOM_PRICELIST_URL,
): Promise<ParsedCardKingdomFeed | string> {
  let response: Response
  try {
    response = await http.fetch(url)
  } catch (e) {
    return `Card Kingdom feed download failed: ${getErrorMessage(e)}`
  }
  if (!response.ok) {
    return `Card Kingdom feed download failed: HTTP ${response.status}`
  }
  let json: unknown
  try {
    json = await response.json()
  } catch (e) {
    return `Card Kingdom feed was not valid JSON: ${getErrorMessage(e)}`
  }
  return parseCardKingdomFeed(json)
}
