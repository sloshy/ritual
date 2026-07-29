import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { handleCardPrintings, type CardPrintingsResponse } from '../../src/api/card-printings'
import { cardCache } from '../../src/cache'
import { callJson } from './helpers/request'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'
import { makeScryfallCard } from '../test-utils'

/**
 * `GET /api/card-printings` — every cached printing of a card, with an opt-in
 * `limit`.
 *
 * The opt-in part is the contract that matters: this handler is mounted on the
 * public/hosted site server as well as the admin one, so a request without
 * `limit` must keep returning everything. Capping by default would silently
 * truncate the hosted site's printing pickers.
 */

let ws: BoundWorkspace

const PRINTING_COUNT = 5

beforeAll(async () => {
  ws = await bindWorkspace({ init: true, clearCardCache: true })
  await cardCache.bulkSet({
    'Sol Ring': Array.from({ length: PRINTING_COUNT }, (_, i) =>
      makeScryfallCard({
        id: `sol-${i}`,
        name: 'Sol Ring',
        set: `s${i}`,
        collector_number: String(i + 1),
      }),
    ),
  })
})

afterAll(async () => {
  await ws.dispose()
})

function printings(query: string): Promise<{ status: number; body: CardPrintingsResponse }> {
  return callJson<CardPrintingsResponse>(handleCardPrintings, 'GET', `/api/card-printings?${query}`)
}

describe('handleCardPrintings', () => {
  test('no limit returns every printing — the public-site contract', async () => {
    const { status, body } = await printings('name=Sol%20Ring')
    expect(status).toBe(200)
    expect(body.printings).toHaveLength(PRINTING_COUNT)
    expect(body).not.toHaveProperty('totalPrintings')
  })

  test('limit truncates and reports how many there were', async () => {
    const { body } = await printings('name=Sol%20Ring&limit=2')
    expect(body.printings).toHaveLength(2)
    expect(body.success === true && body.totalPrintings).toBe(PRINTING_COUNT)
    // Newest first is the cache's own order, so a cap keeps the useful end.
    expect(body.printings[0]?.id).toBe('sol-0')
  })

  test('a limit at or above the count leaves totalPrintings off', async () => {
    const { body } = await printings(`name=Sol%20Ring&limit=${PRINTING_COUNT}`)
    expect(body.printings).toHaveLength(PRINTING_COUNT)
    expect(body).not.toHaveProperty('totalPrintings')
  })

  test('a malformed limit is a 400', async () => {
    const { status, body } = await printings('name=Sol%20Ring&limit=abc')
    expect(status).toBe(400)
    expect(body.success === false && body.message).toContain("Invalid limit 'abc'")
  })

  test('a missing name is a 400', async () => {
    const { status } = await printings('')
    expect(status).toBe(400)
  })
})
