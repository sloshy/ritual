/**
 * The refusal a deck-service request raises when the service answers with an
 * error status: English plus its catalog key (a {@link SyncMessageError}), so
 * the admin import route and MCP answer with the English and the key, and the
 * CLI words it in its own language.
 */

import { syncMessage, SyncMessageError } from '../sync/message'

/** The catalog keys of the deck-service request failures — each takes `{status}` and `{statusText}`. */
export type FetchFailureKey =
  | 'domain.import.url.mtgGoldfishPageFailed'
  | 'domain.import.url.mtgGoldfishListFailed'
  | 'domain.import.url.moxfieldDeckFailed'
  | 'domain.import.url.moxfieldPrimerFailed'

/** Throw the failure `key` names for a response that was not OK. */
export function throwFetchFailure(response: Response, key: FetchFailureKey): never {
  throw new SyncMessageError(
    syncMessage(key, { status: response.status, statusText: response.statusText }),
  )
}
