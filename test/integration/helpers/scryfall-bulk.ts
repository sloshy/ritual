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
  bulkCard,
  bulkCards,
  bulkMetaBody,
  gzipJsonLines,
  gzipJsonLinesResponse,
} from '../../test-utils'
import { stubFetch, type StubRoute, type StubbedFetch } from '../../helpers/stub-fetch'

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
  /**
   * Further routes served by the same stub, merged over the bulk table — for a
   * run that refreshes more than the card cache (the buyer feed
   * `cache preload-all` pulls under sell mode).
   */
  routes?: Record<string, StubRoute>
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
      ...options.routes,
    },
    { passthrough: options.passthrough },
  )
}

/** A Scryfall stand-in served on a loopback port: its manifest URL, and how to stop it. */
export type ServedBulkUpstream = { bulkApiUrl: string; stop: () => Promise<void> }

export type ServedBulkUpstreamOptions = {
  /**
   * Answer the manifest with this status (and its standard reason phrase)
   * instead of the bulk list — how an unreachable Scryfall is pinned.
   */
  manifestStatus?: { status: number; statusText: string }
}

/**
 * Serve a bulk manifest and the three bulk files a default `cache feed host`
 * publishes (the English card bulk and both tag bulks) over real HTTP, for a
 * spawned binary that {@link stubScryfallBulk}'s in-process `fetch` cannot reach.
 */
export function serveBulkUpstream(options: ServedBulkUpstreamOptions = {}): ServedBulkUpstream {
  const bodies = new Map<string, Uint8Array>([
    ['/default_cards.jsonl.gz', gzipJsonLines([bulkCard()])],
    ['/oracle_tags.jsonl.gz', gzipJsonLines([{ object: 'tag', id: 't1', slug: 'ramp' }])],
    ['/art_tags.jsonl.gz', gzipJsonLines([{ object: 'tag', id: 'a1', slug: 'ring' }])],
  ])
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      const { pathname, origin } = new URL(request.url)
      if (pathname === '/bulk-data') {
        if (options.manifestStatus !== undefined) {
          return new Response('unavailable', options.manifestStatus)
        }
        return Response.json({
          data: [...bodies.keys()].map((file) => ({
            type: file.slice(1, -'.jsonl.gz'.length),
            updated_at: '2026-06-04T00:00:00Z',
            jsonl_download_uri: `${origin}${file}`,
          })),
        })
      }
      const body = bodies.get(pathname)
      return body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(body.slice())
    },
  })
  return {
    bulkApiUrl: `http://127.0.0.1:${server.port}/bulk-data`,
    stop: () => server.stop(true),
  }
}
