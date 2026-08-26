import { defaultHttpClient } from '../util/http'
import type { HttpClient } from '../util/interfaces'
import type { DeckData } from '../list/deck'
import { throwHttpError } from '../util/errors'
import {
  type ArchidektDeckResponse,
  type ArchidektDeckSimple,
  type ArchidektRawDeckResponse,
  type ArchidektCardSearchResult,
  type ModifyCardEntry,
  parseArchidektDeckResponse,
} from '../importers/archidekt-types'
import {
  ARCHIDEKT_BULK_BATCH_SIZE,
  ARCHIDEKT_CSV_CHUNK_SIZE,
  ARCHIDEKT_CSV_IF_FOUND,
  ARCHIDEKT_CSV_SKIP_AMBIGUOUS,
  ARCHIDEKT_GAME_PAPER,
  ARCHIDEKT_LANGUAGE_ENGLISH,
  archidektConditionId,
  parseCollectionCsvUploadResponse,
  type ArchidektCollectionPage,
  type ArchidektCsvColumn,
  type CollectionCsvRowResult,
  type CollectionCsvUnreadableResponse,
  type CollectionCsvUploadResult,
  type CollectionUpsertBody,
  type CollectionUpsertResponse,
  validateArchidektCsvColumns,
} from '../importers/archidekt-collection'
import { parseCsv } from '../importers/csv'

import { describeRateLimitWait, type RateLimitWait } from '../sync/common'
import { getLogger } from '../util/logger'

export { type ArchidektDeckSimple, getArchidektFormat } from '../importers/archidekt-types'

/**
 * One page of a paginated list endpoint, as the wire actually serves it — every
 * field optional, because nothing has validated it yet. {@link parseListPage}
 * turns it into the checked shape.
 */
interface ArchidektListPageBody<T> {
  results?: T[]
  count?: number
  /** Absolute URL of the next page, or null on the last one. */
  next?: string | null
}

/** A validated list page. */
interface ArchidektListResponse<T> {
  results: T[]
  next?: string | null
}

/**
 * Validate one page of a list response. A page whose `results` is missing or is
 * not an array is an error, not an empty page: silently treating it as empty
 * would end the walk and make a truncated list look complete.
 *
 * @returns the checked page, or an error message.
 */
export function parseListPage<T>(json: unknown): ArchidektListResponse<T> | string {
  if (typeof json !== 'object' || json === null) return 'response body was not an object'
  const body = json as ArchidektListPageBody<T>
  if (!Array.isArray(body.results)) return 'response body had no `results` array'
  const next = typeof body.next === 'string' ? body.next : null
  return { results: body.results, next }
}

interface ArchidektSearchResponse {
  results: ArchidektCardSearchResult[]
}

/** A `PATCH /api/collection/v2/{id}/` body: the upsert fields plus the record id. */
type CollectionUpdatePayload = CollectionUpsertBody & { id: number }

/** File name sent with a CSV upload; cosmetic — Archidekt only reads the bytes. */
export const DEFAULT_CSV_UPLOAD_FILE_NAME = 'ritual-collection.csv'

/** What a CSV upload needs to know about the file it is sending. */
export type CollectionCsvUploadOptions = {
  /**
   * One Archidekt column key per CSV column, in the file's column order —
   * validated by {@link validateArchidektCsvColumns} before anything is sent.
   */
  columns: readonly ArchidektCsvColumn[]
  /**
   * Whether the CSV's first row is a header. The header is sent only with the
   * first chunk, whose `skip` field tells Archidekt to pass over it — the server
   * treats the chunks as one continuous file and honors `skip` for chunk 1
   * alone, so later chunks must carry data rows only.
   */
  header: boolean
  /** Defaults to {@link DEFAULT_CSV_UPLOAD_FILE_NAME}. */
  fileName?: string
}

/**
 * Hard cap on pages a list endpoint is followed for. Far above any real
 * account (a page is 50 decks), so reaching it means the server is looping
 * rather than paginating — the fetch stops and says so instead of running
 * forever.
 */
export const MAX_LIST_PAGES = 100

/**
 * The URL of a list response's next page, or undefined when there is none.
 *
 * Archidekt serves `next` as an absolute `http://archidekt.com/...` URL, which
 * is upgraded to https here to avoid a redirect on every page. A relative link
 * is resolved against `baseUrl` (the page it arrived on) when one is given, so a
 * server that switches to relative links keeps paginating.
 *
 * A link pointing anywhere but Archidekt, or one that will not parse, ends the
 * walk — and says so on the warning channel, since a truncated list must never
 * look complete.
 *
 * @param baseUrl The URL the page was fetched from; only relative links need it.
 */
export function nextPageUrl(next: string | null | undefined, baseUrl?: string): string | undefined {
  if (typeof next !== 'string' || next.trim() === '') return undefined
  const decline = (reason: string): undefined => {
    getLogger().warn(
      `Archidekt served a next-page link that will not be followed (${reason}): ${next}. The list may be incomplete.`,
    )
    return undefined
  }
  let url: URL
  try {
    url = new URL(next, baseUrl)
  } catch {
    return decline('unparseable')
  }
  if (url.hostname !== 'archidekt.com' && !url.hostname.endsWith('.archidekt.com')) {
    return decline(`unexpected host ${url.hostname}`)
  }
  if (url.protocol === 'http:') url.protocol = 'https:'
  return url.toString()
}

/**
 * Archidekt's observed rate limit: ~80 requests per minute per IP (measured
 * 2026-08-11). Pacing and backoff below are both derived from it.
 */
export const ARCHIDEKT_RATE_LIMIT_PER_MIN = 80

/**
 * The fraction of {@link ARCHIDEKT_RATE_LIMIT_PER_MIN} the default pacing aims
 * to use — the rest is headroom for anything else sharing the IP (another
 * Ritual process, a browser tab, a NAT neighbor).
 */
const RATE_LIMIT_HEADROOM_DIVISOR = 2

/**
 * Milliseconds enforced between consecutive requests. Targets half the
 * observed limit (40 req/min); pacing state is shared process-wide by default
 * (see {@link processPacer}), so however many clients a process constructs,
 * they respect this one budget together.
 */
export const DEFAULT_MIN_REQUEST_INTERVAL_MS = Math.ceil(
  60_000 / (ARCHIDEKT_RATE_LIMIT_PER_MIN / RATE_LIMIT_HEADROOM_DIVISOR),
)

/** How many 429 responses a single request rides out before failing for real. */
export const RATE_LIMIT_MAX_RETRIES = 5

/** The first backoff after a 429; each further retry doubles it. */
const BACKOFF_BASE_MS = 2000

/**
 * The longest a computed exponential backoff will sleep. The limit window is
 * per-minute, so the full retry budget (62s of backoff) must be able to
 * outlive one window — the cap only guards a future retry-budget increase
 * from producing minutes-long sleeps (the fifth backoff is 32s).
 */
export const BACKOFF_CAP_MS = 60_000

/** The longest a server-sent Retry-After is honored for — beyond this, wait the cap. */
const RETRY_AFTER_CAP_MS = 60_000

/** Observes each 429 backoff wait, so callers can tell the user why a run pauses. */
export type RateLimitWaitObserver = (wait: RateLimitWait) => void

/**
 * Mutable pacing state: when the last request went out. Shared by every client
 * that holds the same instance, so their combined traffic respects one
 * interval.
 */
export type ArchidektPacer = {
  /** Epoch milliseconds of the previous request; the next one waits out the interval. */
  lastRequestAt: number
}

/** A pacer that has never sent a request — the first one through it is free. */
export function createArchidektPacer(): ArchidektPacer {
  return { lastRequestAt: Number.NEGATIVE_INFINITY }
}

/**
 * The default pacer, shared process-wide: the rate limit is per-IP, so two
 * clients in one process (a sync engine next to a URL import, two admin SSE
 * runs) must pace against each other, not just themselves.
 */
const processPacer: ArchidektPacer = createArchidektPacer()

export type ArchidektClientOptions = {
  /**
   * Minimum milliseconds between consecutive Archidekt requests made through
   * this instance's pacer (process-wide by default); 0 disables it.
   * Defaults, in order: this option, the `RITUAL_ARCHIDEKT_MIN_INTERVAL_MS`
   * environment variable, then {@link DEFAULT_MIN_REQUEST_INTERVAL_MS}. An
   * invalid option throws; an invalid environment value is ignored (pacing is a
   * courtesy — a garbled tuning knob must not turn it off).
   */
  minRequestIntervalMs?: number
  onRateLimitWait?: RateLimitWaitObserver
  /**
   * Pacing state to share; the process-wide default keeps every client in the
   * process under one budget. Tests inject a fresh {@link createArchidektPacer}
   * so suites do not pace against each other.
   */
  pacer?: ArchidektPacer
  /**
   * Clock seam for tests; `Date.now` by default. Must return epoch
   * milliseconds — the Retry-After HTTP-date branch subtracts it from a parsed
   * absolute date.
   */
  now?: () => number
  /** Timer seam for tests; a real `setTimeout` sleep by default. */
  sleep?: (ms: number) => Promise<void>
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isValidInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/**
 * The pacing interval a client starts with; see
 * {@link ArchidektClientOptions.minRequestIntervalMs} for the precedence.
 */
function resolveMinInterval(option: number | undefined): number {
  if (option !== undefined) {
    if (!isValidInterval(option)) {
      throw new Error(
        `minRequestIntervalMs must be a non-negative finite number, got ${String(option)}`,
      )
    }
    return option
  }
  const env = process.env.RITUAL_ARCHIDEKT_MIN_INTERVAL_MS
  if (env !== undefined && env.trim() !== '') {
    const parsed = Number(env)
    if (isValidInterval(parsed)) return parsed
  }
  return DEFAULT_MIN_REQUEST_INTERVAL_MS
}

/**
 * Looks numeric (int, decimal, sign, exponent) — exactly the strings that must
 * never reach `Date.parse`, whose leniency would read `3.5` as a date.
 */
const NUMERIC_LIKE_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/**
 * Parse a Retry-After header into milliseconds to wait: either delta-seconds
 * (`"3"`) or an HTTP-date, capped at {@link RETRY_AFTER_CAP_MS}. Returns
 * undefined for a missing or unparseable header, and for one naming no usable
 * wait (`"0"`, a date already past) — in every such case the caller falls back
 * to its own exponential backoff, which is the designed recovery, not an error.
 */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined
  const trimmed = header.trim()
  if (trimmed === '') return undefined

  if (/^\d+$/.test(trimmed)) {
    const ms = Math.min(Number(trimmed) * 1000, RETRY_AFTER_CAP_MS)
    return ms > 0 ? ms : undefined
  }
  // Other numeric-looking forms ("3.5", "-3", "1e3") are not valid delta-seconds
  // and must not fall through to Date.parse's engine-dependent leniency.
  if (NUMERIC_LIKE_RE.test(trimmed)) return undefined

  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return undefined
  const delay = Math.min(dateMs - nowMs, RETRY_AFTER_CAP_MS)
  return delay > 0 ? delay : undefined
}

/** One deck fetch, in both the shapes deck sync reads it as. */
export type ArchidektDeckFetch = {
  deck: DeckData
  raw: ArchidektRawDeckResponse
}

/**
 * The exponential backoff for a retry: {@link BACKOFF_BASE_MS} doubled per
 * retry (2s, 4s, 8s, 16s, 32s), capped at {@link BACKOFF_CAP_MS}. The curve is
 * sized to Archidekt's per-minute window ({@link ARCHIDEKT_RATE_LIMIT_PER_MIN}):
 * a 429 means the window is saturated and may not clear for tens of seconds,
 * so the retries together span a full window rather than burning the budget on
 * waits too short to matter.
 */
function backoffMs(retry: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (retry - 1), BACKOFF_CAP_MS)
}

/**
 * A default-transport client whose 429 waits are reported to `onWait` as the
 * shared {@link describeRateLimitWait} line — the construction both sync
 * engines (and any future consumer with a progress channel) share. `options`
 * exists for the seams; an `onRateLimitWait` given there is overridden.
 *
 * @param httpClient Transport seam. Defaults to the real one; a test injects a
 * mock here so a command that builds its client through this factory can be
 * driven end to end without a network.
 */
export function createPacedArchidektClient(
  onWait: (message: string) => void,
  options?: ArchidektClientOptions,
  httpClient?: HttpClient,
): ArchidektClient {
  return new ArchidektClient(httpClient, {
    ...options,
    onRateLimitWait: (wait) => onWait(describeRateLimitWait(wait)),
  })
}

export class ArchidektClient {
  private readonly httpClient: HttpClient
  private readonly minRequestIntervalMs: number
  private readonly onRateLimitWait: RateLimitWaitObserver | undefined
  private readonly now: NonNullable<ArchidektClientOptions['now']>
  private readonly sleep: NonNullable<ArchidektClientOptions['sleep']>
  /** Shared pacing state; the process-wide default unless the options inject one. */
  private readonly pacer: ArchidektPacer

  constructor(httpClient?: HttpClient, options?: ArchidektClientOptions) {
    this.httpClient = httpClient ?? defaultHttpClient
    this.minRequestIntervalMs = resolveMinInterval(options?.minRequestIntervalMs)
    this.onRateLimitWait = options?.onRateLimitWait
    this.pacer = options?.pacer ?? processPacer
    this.now = options?.now ?? Date.now
    this.sleep = options?.sleep ?? realSleep
  }

  /** Hold the next request until the pacing interval since the last one has passed. */
  private async pace(): Promise<void> {
    if (this.minRequestIntervalMs <= 0) return
    const wait = this.pacer.lastRequestAt + this.minRequestIntervalMs - this.now()
    if (wait > 0) await this.sleep(wait)
    this.pacer.lastRequestAt = this.now()
  }

  /**
   * Every Archidekt request funnels through here: paced to the minimum
   * interval, and retried on 429 (Retry-After when the server names a wait,
   * exponential backoff otherwise) up to {@link RATE_LIMIT_MAX_RETRIES} times.
   * A 429 that outlives the budget is returned as-is, so each caller's own
   * error path reports it like any other failure. Retrying a 429 write is safe:
   * the status means the request was refused, not half-applied.
   */
  private async request(url: string | URL, init?: RequestInit): Promise<Response> {
    for (let retry = 1; ; retry++) {
      await this.pace()
      const response = await this.httpClient.fetch(url, init)
      if (response.status !== 429 || retry > RATE_LIMIT_MAX_RETRIES) return response
      const waitMs =
        parseRetryAfterMs(response.headers.get('retry-after'), this.now()) ?? backoffMs(retry)
      try {
        this.onRateLimitWait?.({ waitMs, retry, maxRetries: RATE_LIMIT_MAX_RETRIES })
      } catch {
        // The observer is a courtesy; its failure must not fail the request.
      }
      await this.sleep(waitMs)
    }
  }

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `JWT ${token}` }
  }

  /** Headers for an authenticated write carrying a JSON body. */
  private jsonAuthHeaders(token: string): Record<string, string> {
    return { ...this.authHeaders(token), 'Content-Type': 'application/json' }
  }

  /** Throw with the response body attached — write endpoints explain themselves there. */
  private async throwWriteError(response: Response, action: string): Promise<never> {
    const body = await response.text()
    throw new Error(`${action} failed (${response.status}): ${body}`)
  }

  private async fetchDeckResponse(deckId: string, token?: string): Promise<Response> {
    const url = `https://archidekt.com/api/decks/${deckId}/`
    const headers: Record<string, string> = {}

    if (token) {
      Object.assign(headers, this.authHeaders(token))
    }

    const response = await this.request(url, { headers })

    if (!response.ok) {
      throwHttpError(response, `Failed to fetch deck ${deckId}`)
    }

    return response
  }

  /**
   * Walk a paginated list endpoint from `firstUrl`, following each response's
   * `next` link through the same paced/retrying funnel as any other request,
   * and return every page's results.
   *
   * Two guards keep a misbehaving server from looping forever: a URL already
   * fetched ends the walk, and so does {@link MAX_LIST_PAGES}. Both say so on
   * the warning channel — a truncated list must never look complete.
   */
  private async fetchAllPages<T>(
    firstUrl: string,
    init: RequestInit | undefined,
    errorMessage: string,
  ): Promise<T[]> {
    const results: T[] = []
    const seen = new Set<string>()
    let url: string | undefined = firstUrl

    for (let page = 1; url !== undefined; page++) {
      if (seen.has(url)) {
        getLogger().warn(
          `Archidekt returned a next-page link it had already served (${url}); stopping after ${results.length} result(s).`,
        )
        break
      }
      seen.add(url)

      const response = await this.request(url, init)
      if (!response.ok) {
        throwHttpError(response, errorMessage)
      }
      const body = parseListPage<T>(await response.json())
      if (typeof body === 'string') {
        throw new Error(`${errorMessage}: ${body}`)
      }
      results.push(...body.results)

      const next = nextPageUrl(body.next, url)
      if (next !== undefined && page >= MAX_LIST_PAGES) {
        getLogger().warn(
          `Stopped after ${MAX_LIST_PAGES} pages; the list may be incomplete (${results.length} result(s) so far).`,
        )
        break
      }
      url = next
    }

    return results
  }

  /** Every public deck of a user, following the endpoint's pagination to the end. */
  async fetchPublicDecks(username: string): Promise<ArchidektDeckSimple[]> {
    const url = `https://archidekt.com/api/decks/v3/?ownerUsername=${encodeURIComponent(username)}`
    return this.fetchAllPages<ArchidektDeckSimple>(url, undefined, 'Failed to fetch public decks')
  }

  /** Every deck of the logged-in user, following the endpoint's pagination to the end. */
  async fetchOwnDecks(token: string): Promise<ArchidektDeckSimple[]> {
    return this.fetchAllPages<ArchidektDeckSimple>(
      'https://archidekt.com/api/decks/curated/self/',
      { headers: this.authHeaders(token) },
      'Failed to fetch own decks',
    )
  }

  async fetchDeck(deckId: string, token?: string): Promise<DeckData> {
    const response = await this.fetchDeckResponse(deckId, token)
    const json = (await response.json()) as ArchidektDeckResponse
    return parseArchidektDeckResponse(json, deckId)
  }

  async fetchDeckRaw(deckId: string, token?: string): Promise<ArchidektRawDeckResponse> {
    const response = await this.fetchDeckResponse(deckId, token)
    return (await response.json()) as ArchidektRawDeckResponse
  }

  /**
   * The parsed deck *and* the response it was parsed from, in one request.
   *
   * Deck sync needs both — the sections to diff against, and the raw payload's
   * `updatedAt`/card ids — and fetching them separately both doubles the calls
   * and risks the two halves describing different revisions of the deck.
   */
  async fetchDeckWithRaw(deckId: string, token?: string): Promise<ArchidektDeckFetch> {
    const response = await this.fetchDeckResponse(deckId, token)
    const json = (await response.json()) as ArchidektRawDeckResponse & ArchidektDeckResponse
    return { deck: parseArchidektDeckResponse(json, deckId), raw: json }
  }

  /**
   * Find an Archidekt printing by name, optionally pinned to a set and
   * collector number. Returns the matching search result, or an error message
   * string (search failure or no match) — the caller discriminates on
   * `typeof result === 'string'`.
   */
  async searchCards(
    cardName: string,
    set: string | undefined,
    token: string,
    collectorNumber?: string,
  ): Promise<ArchidektCardSearchResult | string> {
    // Archidekt indexes the oracle (front-face) name while list files spell the
    // full Scryfall name, so a double-faced or split card has to be searched for
    // by its front face or it matches nothing at all.
    const queryName = oracleNameOf(cardName)
    const searchUrl = new URL('https://archidekt.com/api/cards/v2/')
    searchUrl.searchParams.set('nameSearch', queryName)
    if (set) {
      searchUrl.searchParams.set('editionSearch', set.toLowerCase())
    }
    if (collectorNumber) {
      searchUrl.searchParams.set('collectorNumber', collectorNumber)
    }
    searchUrl.searchParams.set('pageSize', '50')

    const response = await this.request(searchUrl.toString(), {
      headers: this.authHeaders(token),
    })

    if (!response.ok) {
      return `Card search failed (${response.status}): ${cardName}`
    }

    const data = (await response.json()) as ArchidektSearchResponse

    // The collector-number filter is applied server-side too, but re-check it
    // here so a pinned printing is never satisfied by a different one.
    const candidates = collectorNumber
      ? data.results.filter(
          (r) => r.collectorNumber.toLowerCase() === collectorNumber.toLowerCase(),
        )
      : data.results

    // A set plus a collector number identifies exactly one printing, so a lone
    // survivor of that filter is the right card however its name is spelled.
    const match =
      set && collectorNumber && candidates.length === 1
        ? candidates[0]
        : candidates.find((r) => r.oracleCard.name.toLowerCase() === queryName.toLowerCase())
    if (!match) {
      return `Card not found on Archidekt: ${cardName}${formatPrintingSuffix(set, collectorNumber)}`
    }
    return match
  }

  async modifyCards(deckId: string, entries: ModifyCardEntry[], token: string): Promise<void> {
    const url = `https://archidekt.com/api/decks/${deckId}/modifyCards/v2/`
    const response = await this.request(url, {
      method: 'PATCH',
      headers: this.jsonAuthHeaders(token),
      body: JSON.stringify({ cards: entries }),
    })

    if (!response.ok) {
      await this.throwWriteError(response, 'modifyCards')
    }
  }

  // ── Collection ────────────────────────────────────────────────────────

  /**
   * Fetch one page of a user's Paper collection. Public collections read
   * without a token; a private one needs the owner's JWT (Archidekt answers
   * 404, not 401, when it is not visible). Page numbers are 1-based; follow
   * {@link ArchidektCollectionPage.next} until it is null.
   */
  async fetchCollectionPage(
    userId: number,
    page: number,
    token?: string,
  ): Promise<ArchidektCollectionPage> {
    const url = new URL(`https://archidekt.com/api/collection/${userId}/v2/`)
    url.searchParams.set('game', String(ARCHIDEKT_GAME_PAPER))
    url.searchParams.set('page', String(page))

    const headers: Record<string, string> = {}
    if (token) {
      Object.assign(headers, this.authHeaders(token))
    }

    const response = await this.request(url.toString(), { headers })

    if (!response.ok) {
      throwHttpError(response, `Failed to fetch collection page ${page} for user ${userId}`)
    }

    return (await response.json()) as ArchidektCollectionPage
  }

  /** Create one collection record. */
  async createCollectionRecord(
    body: CollectionUpsertBody,
    token: string,
  ): Promise<CollectionUpsertResponse> {
    const response = await this.request('https://archidekt.com/api/collection/v2/', {
      method: 'POST',
      headers: this.jsonAuthHeaders(token),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      await this.throwWriteError(response, 'createCollectionRecord')
    }

    return (await response.json()) as CollectionUpsertResponse
  }

  /** Update one existing collection record (quantity, finish, condition, …). */
  async updateCollectionRecord(
    id: number,
    body: CollectionUpsertBody,
    token: string,
  ): Promise<CollectionUpsertResponse> {
    const payload: CollectionUpdatePayload = { ...body, id }
    const response = await this.request(`https://archidekt.com/api/collection/v2/${id}/`, {
      method: 'PATCH',
      headers: this.jsonAuthHeaders(token),
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      await this.throwWriteError(response, `updateCollectionRecord ${id}`)
    }

    return (await response.json()) as CollectionUpsertResponse
  }

  /**
   * Delete collection records by id, in batches of
   * {@link ARCHIDEKT_BULK_BATCH_SIZE} (what Archidekt's own UI sends). No
   * request is made for an empty id list.
   */
  async deleteCollectionRecords(ids: number[], token: string): Promise<void> {
    for (let start = 0; start < ids.length; start += ARCHIDEKT_BULK_BATCH_SIZE) {
      const batch = ids.slice(start, start + ARCHIDEKT_BULK_BATCH_SIZE)
      const response = await this.request('https://archidekt.com/api/collection/bulk/', {
        method: 'DELETE',
        headers: this.jsonAuthHeaders(token),
        body: JSON.stringify({ ids: batch }),
      })

      if (!response.ok) {
        await this.throwWriteError(response, `deleteCollectionRecords (${batch.length} records)`)
      }
    }
  }

  /**
   * Import collection rows from CSV text through
   * `POST /api/collection/upload/v2/` — the path a large push takes instead of
   * one printing search plus one create per card.
   *
   * The rows are split into chunks of {@link ARCHIDEKT_CSV_CHUNK_SIZE} and
   * posted one multipart form at a time. The header rides the **first chunk
   * only**: Archidekt treats the chunks as one continuous file and honors
   * `skip` for chunk 1 alone, so a header repeated later is imported as a card
   * row (the live 2026-07-27 incident). Chunks go through the paced
   * {@link request} funnel like every other Archidekt call.
   *
   * Throws before touching the network when the CSV cannot be split or the
   * column mapping could not match a printing, and on a non-ok response (the
   * body is attached, as with every other write). It does **not** throw over an
   * unexpected response *shape*: per-row results Ritual can read come back in
   * `rows`, and anything else in `unreadable` with the raw body — a response
   * Archidekt changed must not look like a failed import.
   *
   * **Row numbering**: `rows[n].row` counts **data records**, not file lines — the
   * text is parsed as CSV first, so blank lines are not records and a quoted cell
   * spanning lines is one record. A caller pairing results back to what it sent
   * must therefore hold its rows in the same order it rendered them (as
   * `planCollectionCsv` does), not index into the file's lines.
   */
  async uploadCollectionCsv(
    csvText: string,
    options: CollectionCsvUploadOptions,
    token: string,
  ): Promise<CollectionCsvUploadResult> {
    const columnError = validateArchidektCsvColumns(options.columns)
    if (columnError) throw new Error(`uploadCollectionCsv: ${columnError}`)

    const parsed = parseCsv(csvText)
    if ('error' in parsed) {
      throw new Error(`uploadCollectionCsv: the CSV could not be read — ${parsed.error}`)
    }
    // Records, not lines: a quoted cell may span lines, and a chunk boundary must
    // never fall inside one.
    const records = parsed.rows.map((row) => row.raw)
    const headerRow = options.header ? records[0] : undefined
    const dataRows = options.header ? records.slice(1) : records

    const fileName = options.fileName ?? DEFAULT_CSV_UPLOAD_FILE_NAME
    const rows: CollectionCsvRowResult[] = []
    const unreadable: CollectionCsvUnreadableResponse[] = []

    for (let start = 0; start < dataRows.length; start += ARCHIDEKT_CSV_CHUNK_SIZE) {
      const chunkRows = dataRows.slice(start, start + ARCHIDEKT_CSV_CHUNK_SIZE)
      const chunk = start / ARCHIDEKT_CSV_CHUNK_SIZE + 1
      // The header goes out once, on the first chunk only: Archidekt treats the
      // chunks as one continuous file and honors `skip` solely for chunk 1 —
      // a header repeated on a later chunk is imported as a card row (verified
      // live 2026-07-27: it comes back as `Unknown condition: CONDITION`).
      const lines = headerRow !== undefined && chunk === 1 ? [headerRow, ...chunkRows] : chunkRows
      const form = this.collectionCsvForm(`${lines.join('\n')}\n`, fileName, options, chunk)

      const response = await this.request('https://archidekt.com/api/collection/upload/v2/', {
        method: 'POST',
        // No Content-Type: FormData sets its own multipart boundary.
        headers: this.authHeaders(token),
        body: form,
      })
      if (!response.ok) {
        await this.throwWriteError(response, `uploadCollectionCsv (chunk ${chunk})`)
      }

      const result = parseCollectionCsvUploadResponse(await response.text(), {
        chunk,
        rowOffset: start,
        rowCount: chunkRows.length,
      })
      rows.push(...result.rows)
      unreadable.push(...result.unreadable)
    }

    return {
      rowCount: dataRows.length,
      chunkCount: Math.ceil(dataRows.length / ARCHIDEKT_CSV_CHUNK_SIZE),
      rows,
      unreadable,
    }
  }

  /** One chunk's multipart body, per the `upload/v2` form contract. */
  private collectionCsvForm(
    text: string,
    fileName: string,
    options: CollectionCsvUploadOptions,
    chunk: number,
  ): FormData {
    const form = new FormData()
    form.set('fileType', 'csv')
    form.set('file', new File([text], fileName, { type: 'text/csv' }))
    options.columns.forEach((column, index) => form.set(`columns[${index}]`, column))
    form.set('chunk', String(chunk))
    form.set('chunkSize', String(ARCHIDEKT_CSV_CHUNK_SIZE))
    form.set('ifFound', ARCHIDEKT_CSV_IF_FOUND)
    // Only chunk 1 carries the header, so only chunk 1 asks for a line skipped.
    form.set('skip', String(options.header && chunk === 1))
    form.set('skipAmbiguousImports', String(ARCHIDEKT_CSV_SKIP_AMBIGUOUS))
    // Defaults for cells a row leaves empty: Paper, English, Near Mint.
    form.set('defaultGame', String(ARCHIDEKT_GAME_PAPER))
    form.set('defaultLanguage', String(ARCHIDEKT_LANGUAGE_ENGLISH))
    form.set('defaultCondition', String(archidektConditionId('NM')))
    return form
  }
}

/**
 * The front-face name of a card: Archidekt's `oracleCard.name` never carries the
 * ` // ` back face that Ritual's list files and the Scryfall cache do.
 */
function oracleNameOf(name: string): string {
  const front = name.split(' // ')[0]?.trim()
  return front ? front : name
}

/** ` (MKM:123)` / ` (MKM)` / ` (#123)` for a not-found message; set codes uppercase in output. */
function formatPrintingSuffix(
  set: string | undefined,
  collectorNumber: string | undefined,
): string {
  if (set) {
    return ` (${set.toUpperCase()}${collectorNumber ? `:${collectorNumber}` : ''})`
  }
  return collectorNumber ? ` (#${collectorNumber})` : ''
}
