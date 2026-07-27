/**
 * The Archidekt harness every sync integration test needs: a stored login, a
 * stubbed `fetch` that serves only the URLs a test routed, the card cache seeded
 * so no Scryfall lookup is attempted, and the endpoints and fixtures the sync
 * tests share.
 *
 * Each test keeps its **own route table** — what a run is expected to ask for
 * differs meaningfully per test and belongs where it is read. What is shared is
 * everything around it, which is identical wherever it is copied.
 *
 * Nothing here reaches the network: an unrouted URL fails the run loudly rather
 * than falling through to the real Archidekt.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../../src/scryfall'
import { cardCache } from '../../../src/cache'
import { scryfallIdIndex } from '../../../src/cache/scryfall-id-index'
import type { ArchidektToken } from '../../../src/auth/interfaces'
import { printing, printingId, TEST_ACCOUNT } from '../../unit/collection-sync/fixtures'

export { TEST_ACCOUNT }

/** The Archidekt endpoints a collection sync uses, by URL prefix. */
export const COLLECTION_URL = `https://archidekt.com/api/collection/${TEST_ACCOUNT.id}/v2/`
export const SEARCH_URL = 'https://archidekt.com/api/cards/v2/'
export const UPSERT_URL = 'https://archidekt.com/api/collection/v2/'
export const BULK_URL = 'https://archidekt.com/api/collection/bulk/'
export const UPLOAD_URL = 'https://archidekt.com/api/collection/upload/v2/'

/** The two printings the sync fixtures use; `seedCollectionCardCache` holds both. */
export const SOL_RING = { id: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' } as const
export const BOLT = { id: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' } as const

/** A JWT the auth layer reads as valid for an hour; only the `exp` claim matters. */
export function tokenValidForAnHour(): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url')
  return `header.${payload}.signature`
}

/**
 * Store an Archidekt login in `base` the way `ritual login archidekt` does.
 * Called with no user, it writes the account-less token an older login left
 * behind — which is what a sync needing the numeric user id must refuse.
 */
export async function signIn(base: string, user?: ArchidektToken['user']): Promise<void> {
  const token = {
    access_token: tokenValidForAnHour(),
    refresh_token: tokenValidForAnHour(),
    ...(user ? { user } : {}),
  }
  const loginsDir = path.join(base, '.logins')
  await fs.mkdir(loginsDir, { recursive: true })
  await fs.writeFile(path.join(loginsDir, 'archidekt.json'), JSON.stringify(token))
}

/** One request a run made, as the assertions read it. */
export type StubbedRequest = {
  method: string
  url: string
  body: unknown
  /**
   * The multipart form of a CSV upload; JSON writes carry {@link body} instead.
   * Read the file cell to assert what was uploaded.
   */
  form?: FormData
}

/** The data rows (header excluded) of the CSV a run uploaded, or `[]` if it uploaded none. */
export async function uploadedCsvRows(requests: readonly StubbedRequest[]): Promise<string[]> {
  const upload = requests.find((request) => request.url.startsWith(UPLOAD_URL))
  const file = upload?.form?.get('file')
  if (!(file instanceof File)) return []
  return (await file.text()).trimEnd().split('\n').slice(1)
}

/** Serves one Archidekt endpoint; anything unrouted fails the run loudly. */
export type StubRoute = (request: StubbedRequest) => Response

/**
 * Install a stubbed `fetch` serving `routes` by URL **prefix**, in declaration
 * order (the collection read carries a query string). Returns the array every
 * request is recorded into, so a push can assert what went to Archidekt.
 *
 * Callers restore `globalThis.fetch` themselves — the original has to be
 * captured before the first stub, which is the test's own `beforeEach`.
 */
export function stubArchidekt(routes: Record<string, StubRoute>): StubbedRequest[] {
  const sent: StubbedRequest[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const request: StubbedRequest = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }
    if (init?.body instanceof FormData) request.form = init.body
    sent.push(request)
    for (const [prefix, route] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return route(request)
    }
    throw new Error(`Unexpected fetch: ${request.method} ${url}`)
  }) as typeof globalThis.fetch
  return sent
}

/**
 * The Scryfall id the seeded cache holds for a fixture printing — the uid a CSV
 * row carries. Deliberately not derivable from the set and collector number, so a
 * row built from the line rather than from the cache cannot pass.
 */
export function seededScryfallId(card: { set: string; collectorNumber: string }): string {
  return printingId(card.set, card.collectorNumber)
}

/** Seed the printings the sync fixtures name, so no Scryfall call happens. */
export async function seedCollectionCardCache(): Promise<void> {
  cardCache.invalidate()
  await cardCache.set(SOL_RING.name, [
    printing(SOL_RING.name, SOL_RING.set, SOL_RING.collectorNumber, ['nonfoil', 'foil']),
  ])
  await cardCache.set(BOLT.name, [printing(BOLT.name, BOLT.set, BOLT.collectorNumber, ['nonfoil'])])
  scryfallIdIndex.reset()
}
