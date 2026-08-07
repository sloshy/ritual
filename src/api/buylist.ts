/**
 * Buylist quote endpoints, server-agnostic so both the admin server and the
 * public `serve --api` server can mount them.
 *
 * Quotes are never baked into the built site: a buyer's feed is fresh for about
 * a day, so a static artifact would be stale roughly half the time it is read.
 * The site fetches them here instead, keyed by printing.
 *
 * Strictly cache-backed — nothing here reaches the network. Downloading the
 * feed is `POST /api/sell/refresh`'s job (admin-only and explicitly triggered),
 * so an unauthenticated public route can never be made to pull ~70 MB.
 */

import { apiError, readJsonObjectBody, requireBuylistFeed } from '../admin/api/save-helpers'
import {
  DEFAULT_BUYER,
  isBuyerId,
  quoteKey,
  BUYERS,
  type BuyerId,
  type BuylistQuote,
  type BuylistQuoteRequest,
  type BuylistQuotesResponse,
  type BuylistStatusResponse,
} from '../buylist'
import { feedStamp, quoteForPrinting } from '../cardkingdom'
import { getErrorMessage } from '../errors'
import { invalidLanguageMessage, isCardLanguage } from '../card-language'
import { isFinish } from '../finish-condition'
import { getSiteSellMode, loadRitualConfig } from '../ritual-config'

/**
 * Upper bound on printings per request. A list page asks for every card at
 * once, so this is generous; the client batches past it.
 */
export const MAX_BUYLIST_PRINTINGS = 500

/**
 * Body cap for a quote request. The default mutation-route budget (10 KB) is
 * far too small here: this is a bulk *query* that writes nothing and sends one
 * small record per printing, so it gets a cap derived from its own item limit
 * (~120 bytes per printing, doubled for headroom) rather than borrowing the
 * budget meant for a single card edit.
 */
const MAX_QUOTE_BODY_BYTES = MAX_BUYLIST_PRINTINGS * 240

/** A route handler, named because the gate takes and returns one. */
type BuylistRouteHandler = (req: Request) => Promise<Response>

/** A validated quote request body. */
export type BuylistQuoteBody = {
  buyer: BuyerId
  printings: BuylistQuoteRequest[]
}

function parsePrinting(value: unknown, i: number): BuylistQuoteRequest | string {
  if (!value || typeof value !== 'object') return `"printings[${i}]" must be an object`
  const raw = value as Record<string, unknown>
  if (typeof raw['set'] !== 'string' || raw['set'] === '') {
    return `"printings[${i}].set" must be a non-empty string`
  }
  if (typeof raw['collectorNumber'] !== 'string' || raw['collectorNumber'] === '') {
    return `"printings[${i}].collectorNumber" must be a non-empty string`
  }
  const finish = raw['finish']
  if (typeof finish !== 'string' || !isFinish(finish)) {
    return `"printings[${i}].finish" must be one of: nonfoil, foil, etched`
  }
  const scryfallId = raw['scryfallId']
  if (scryfallId !== undefined && typeof scryfallId !== 'string') {
    return `"printings[${i}].scryfallId" must be a string when present`
  }
  const language = raw['language']
  if (language !== undefined && (typeof language !== 'string' || !isCardLanguage(language))) {
    return invalidLanguageMessage(language, `for "printings[${i}].language"`)
  }
  return {
    // Set codes are lowercase internally, whatever a client sent.
    set: raw['set'].toLowerCase(),
    collectorNumber: raw['collectorNumber'],
    finish,
    ...(scryfallId !== undefined && scryfallId !== '' ? { scryfallId } : {}),
    // Forwarded so the matcher's English-only gate sees the entry's language —
    // a foreign card must never be quoted at the English product's price.
    ...(language !== undefined ? { language } : {}),
  }
}

/** Parse a quote request body; returns the error message string on a bad one. */
export function parseBuylistQuoteBody(body: Record<string, unknown>): BuylistQuoteBody | string {
  const rawBuyer = body['buyer']
  if (rawBuyer !== undefined && !isBuyerId(rawBuyer)) {
    return `"buyer" must be one of: ${BUYERS.join(', ')}`
  }
  const rawPrintings = body['printings']
  if (!Array.isArray(rawPrintings)) {
    return '"printings" must be an array'
  }
  if (rawPrintings.length > MAX_BUYLIST_PRINTINGS) {
    return `"printings" must contain at most ${MAX_BUYLIST_PRINTINGS} entries`
  }
  const printings: BuylistQuoteRequest[] = []
  for (const [i, value] of rawPrintings.entries()) {
    const parsed = parsePrinting(value, i)
    if (typeof parsed === 'string') return parsed
    printings.push(parsed)
  }
  return { buyer: rawBuyer ?? DEFAULT_BUYER, printings }
}

/**
 * POST /api/buylist/quotes — the buyer's current offer for each requested
 * printing. The response's `quotes` map is sparse and keyed by
 * `set:collectorNumber:finish`: a printing the buyer has no product for is
 * simply absent, which the UI renders as "not on the buylist". 503 with the
 * remedy when no feed has been downloaded.
 */
export async function handleBuylistQuotes(req: Request): Promise<Response> {
  try {
    const parsed = await readJsonObjectBody(req, MAX_QUOTE_BODY_BYTES)
    if (!parsed.ok) return parsed.response
    const body = parseBuylistQuoteBody(parsed.body)
    if (typeof body === 'string') return apiError(body, 400)

    const feed = await requireBuylistFeed()
    if (feed instanceof Response) return feed

    const quotes: Record<string, BuylistQuote> = {}
    for (const printing of body.printings) {
      const key = quoteKey(printing.set, printing.collectorNumber, printing.finish)
      if (key in quotes) continue
      const quote = quoteForPrinting(feed.index, feed.file.feed, printing)
      if (quote) quotes[key] = quote
    }

    const response: BuylistQuotesResponse = {
      success: true,
      buyer: body.buyer,
      quotes,
      ...feedStamp(feed),
    }
    return Response.json(response)
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}

/**
 * GET /api/buylist/status — which buyers this server can quote against and how
 * fresh the cached feed is, without quoting anything. Lets a client show a
 * buyer selector and a "buylist as of …" stamp before asking for prices.
 */
export async function handleBuylistStatus(_req: Request): Promise<Response> {
  try {
    const feed = await requireBuylistFeed()
    if (feed instanceof Response) return feed
    const response: BuylistStatusResponse = {
      success: true,
      buyer: DEFAULT_BUYER,
      buyers: [...BUYERS],
      ...feedStamp(feed),
    }
    return Response.json(response)
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}

/**
 * Wrap a buylist handler so the public site server refuses it entirely when
 * `site.sellMode` is off — a 404, so a disabled deployment does not even
 * advertise the capability.
 *
 * The config is read per request rather than at route-table construction: the
 * route table is built once at startup, and a `config set site.sellMode false`
 * must take effect without a restart (the same reason the served `index.json`
 * carries `sellMode` in its config stamp).
 */
export function withPublicSellModeGate(handler: BuylistRouteHandler): BuylistRouteHandler {
  return async (req: Request): Promise<Response> => {
    const config = await loadRitualConfig()
    if (!getSiteSellMode(config)) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return handler(req)
  }
}
