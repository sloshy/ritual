import type { HttpClient } from '../util/interfaces'
import { errorParam, syncMessage, type SyncMessage } from '../sync/message'
import { parseCardKingdomFeed, type ParsedCardKingdomFeed } from './feed'

/** Card Kingdom's public MTG-singles pricelist (retail + buylist), ~70 MB JSON. */
export const CARDKINGDOM_PRICELIST_URL = 'https://api.cardkingdom.com/api/v2/pricelist'

/**
 * Download and parse the pricelist feed. Returns the failure as a message
 * (never throws) on network failure, a non-OK response, or an unparseable
 * payload — English plus its key, since a failed refresh reaches the admin API
 * and MCP. Like the Scryfall bulk download, no request timeout is applied — the
 * body is large by design and a slow link must not abort it.
 */
export async function fetchCardKingdomFeed(
  http: HttpClient,
  url: string = CARDKINGDOM_PRICELIST_URL,
): Promise<ParsedCardKingdomFeed | SyncMessage> {
  let response: Response
  try {
    response = await http.fetch(url)
  } catch (e) {
    return syncMessage('domain.cache.cardKingdom.downloadFailed', { error: errorParam(e) })
  }
  if (!response.ok) {
    return syncMessage('domain.cache.cardKingdom.downloadHttpFailed', { status: response.status })
  }
  let json: unknown
  try {
    json = await response.json()
  } catch (e) {
    return syncMessage('domain.cache.cardKingdom.notJson', { error: errorParam(e) })
  }
  return parseCardKingdomFeed(json)
}
