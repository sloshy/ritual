/**
 * The `globalThis.fetch` installer for Scryfall's bulk-data endpoints.
 *
 * Every suite that drives a real cache refresh needs the same four URLs served
 * from memory: the bulk-data index, the `default_cards` file, and the two tag
 * files. The URLs and the payload builders are in `test/test-utils.ts` so unit
 * tests (which route through `MockHttpClient` rather than global `fetch`) can
 * share them; this module is the integration-side installer, built on the shared
 * {@link stubFetch} so the routing, the recording, and the restore behave the way
 * they do everywhere else.
 */

import {
  ART_TAGS_URI,
  BULK_META_URL,
  DEFAULT_CARDS_URI,
  ORACLE_TAGS_URI,
  bulkCards,
  bulkMetaBody,
  gzipJsonLinesResponse,
} from '../../test-utils'
import { stubFetch, type StubbedFetch } from './stub-fetch'

export type ScryfallBulkStubOptions = {
  /** Cards in the `default_cards` file. Defaults to {@link bulkCards}. */
  cards?: unknown[]
  /**
   * Serve the `default_cards` request with this instead of a bulk file — how a
   * download failure is pinned.
   */
  cardBulk?: () => Response
  /**
   * Let unrouted requests through to the real `fetch`. Needed only by the MCP
   * HTTP suite, whose SDK client reaches its own loopback server over the same
   * `fetch`; see `stub-fetch.ts`'s header.
   */
  passthrough?: boolean
}

/** Install the bulk-data stub; call `.restore()` to put the real `fetch` back. */
export function stubScryfallBulk(options: ScryfallBulkStubOptions = {}): StubbedFetch {
  const cardBulk = options.cardBulk ?? (() => gzipJsonLinesResponse(options.cards ?? bulkCards()))
  return stubFetch(
    {
      [BULK_META_URL]: () => Response.json(bulkMetaBody()),
      [DEFAULT_CARDS_URI]: () => cardBulk(),
      [ORACLE_TAGS_URI]: () => gzipJsonLinesResponse([]),
      [ART_TAGS_URI]: () => gzipJsonLinesResponse([]),
    },
    { passthrough: options.passthrough },
  )
}
