import path from 'node:path'
import { handleArtFile } from '../api/art'
import { handleAutocomplete } from '../api/autocomplete'
import { handleBuylistQuotes, handleBuylistStatus, withBuylistFeedGate } from '../api/buylist'
import { handleCards } from '../api/cards'
import { handleCardPrintings } from '../api/card-printings'
import { handleCardPrice } from '../api/card-price'
import { handleCardPrices } from '../api/card-prices'
import type { HttpMethod } from '../util/routing'
import type { ListType } from '../list/list-type'
import type { LiveJson, LiveSiteData } from './live-data'

export type SiteRouteHandler = (req: Request) => Promise<Response>

/** One public site-server route. All routes are read-only; there is no auth. */
export type SiteRoute = {
  method: HttpMethod
  path: string
  handler: SiteRouteHandler
}

/**
 * Serve a live JSON payload with revalidation caching: always `no-cache` (the
 * client revalidates every time) but with a content ETag so unchanged payloads
 * cost a 304 instead of a re-download.
 */
function liveJsonResponse(req: Request, payload: LiveJson): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=utf-8',
    'Cache-Control': 'no-cache',
    ETag: payload.etag,
    'Last-Modified': payload.lastModified,
  }
  if (req.headers.get('If-None-Match') === payload.etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(payload.body, { headers })
}

function detailHandler(live: LiveSiteData, kind: ListType): SiteRouteHandler {
  return async (req) => {
    const url = new URL(req.url)
    const file = decodeURIComponent(url.pathname.split('/').pop() ?? '')
    if (!file.endsWith('.json')) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    const payload = await live.getDetail(kind, file.slice(0, -'.json'.length))
    if (!payload) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return liveJsonResponse(req, payload)
  }
}

/** Locale tags are BCP-47, so anything else in the path is a 404, not a file read. */
const LOCALE_TAG_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/

/**
 * Serve one published dictionary from `dist/locales/`.
 *
 * A dictionary is a static file with the same lifetime as `app.js`, so it is
 * served as one — no `Accept-Language` negotiation anywhere in this server. The
 * shell, the bundle and the dictionaries stay byte-identical whether a CDN or
 * this process hands them out, which is what keeps a static deployment and a
 * served one the same deployment.
 */
function localeHandler(distDir: string): SiteRouteHandler {
  return async (req) => {
    const url = new URL(req.url)
    const file = decodeURIComponent(url.pathname.split('/').pop() ?? '')
    const tag = file.endsWith('.json') ? file.slice(0, -'.json'.length) : ''
    if (!LOCALE_TAG_PATTERN.test(tag)) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    const dictionary = Bun.file(path.join(distDir, 'locales', `${tag}.json`))
    if (!(await dictionary.exists())) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return new Response(dictionary, {
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
    })
  }
}

/**
 * The public site server's route table: live list data at the exact paths the
 * static build bakes (shadowing any baked copies in dist/), plus the
 * cache-backed card-query endpoints the admin editor uses — including
 * `/api/autocomplete`'s term-separation semantics — and `/api/cards`, the
 * by-Scryfall-ID lookup a shared trade link needs to restore its rows.
 *
 * The two buylist routes are *not* how this server's sell mode works: each list
 * detail carries its own baked quotes (see `src/api/buylist.ts`), so the public
 * site never calls them. They remain the on-demand path for clients quoting
 * printings a baked list does not carry. They read only the cached buyer feed —
 * there is deliberately no public refresh route, since an unauthenticated
 * wildcard-CORS endpoint must never trigger a ~70 MB download — and 404 when
 * `site.sellMode` is off.
 *
 * `/art/*` is the live counterpart of the files `build-site` copies into
 * `dist/art/`: it reads the workspace's art directory, so a card's custom art
 * appears here without a rebuild, at the very path the baked value names.
 */
export function buildSiteRoutes(live: LiveSiteData, distDir: string): SiteRoute[] {
  return [
    { method: 'GET', path: '/locales/:file', handler: localeHandler(distDir) },
    { method: 'GET', path: '/art/*', handler: handleArtFile },
    {
      method: 'GET',
      path: '/index.json',
      handler: async (req) => liveJsonResponse(req, await live.getIndex()),
    },
    { method: 'GET', path: '/decks/:file', handler: detailHandler(live, 'deck') },
    { method: 'GET', path: '/collections/:file', handler: detailHandler(live, 'collection') },
    { method: 'GET', path: '/wanted/:file', handler: detailHandler(live, 'wanted') },
    { method: 'GET', path: '/api/autocomplete', handler: handleAutocomplete },
    { method: 'GET', path: '/api/cards', handler: handleCards },
    { method: 'GET', path: '/api/card-printings', handler: handleCardPrintings },
    { method: 'GET', path: '/api/card-price', handler: handleCardPrice },
    { method: 'POST', path: '/api/card-prices', handler: handleCardPrices },
    {
      method: 'GET',
      path: '/api/buylist/status',
      handler: withBuylistFeedGate(handleBuylistStatus),
    },
    {
      method: 'POST',
      path: '/api/buylist/quotes',
      handler: withBuylistFeedGate(handleBuylistQuotes),
    },
  ]
}
