import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { handleCardPrintings, type CardPrintingsResponse } from '../../src/api/card-printings'
import { cardCache } from '../../src/cache'
import { callJson } from './helpers/request'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
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
    // An all_cards-style entry: three distinct printings, the middle one held
    // in three languages (same set:cn, distinct Scryfall ids).
    Shock: [
      makeScryfallCard({ id: 'shock-a', name: 'Shock', set: 'aaa', collector_number: '1' }),
      makeScryfallCard({ id: 'shock-b-en', name: 'Shock', set: 'bbb', collector_number: '7' }),
      makeScryfallCard({
        id: 'shock-b-ja',
        name: 'Shock',
        set: 'bbb',
        collector_number: '7',
        lang: 'ja',
      }),
      makeScryfallCard({
        id: 'shock-b-de',
        name: 'Shock',
        set: 'bbb',
        collector_number: '7',
        lang: 'de',
      }),
      makeScryfallCard({ id: 'shock-c', name: 'Shock', set: 'ccc', collector_number: '9' }),
    ],
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

  test('an English-only entry reports languages: ["en"]', async () => {
    const { body } = await printings('name=Sol%20Ring')
    expect(body.success === true && body.languages).toEqual(['en'])
  })

  test('language duplicates ride along and languages summarizes them in canonical order', async () => {
    const { body } = await printings('name=Shock')
    // 3 distinct printings, one held in 3 languages = 5 card objects.
    expect(body.printings).toHaveLength(5)
    expect(body).not.toHaveProperty('totalPrintings')
    // CARD_LANGUAGES order: en first, then de before ja.
    expect(body.success === true && body.languages).toEqual(['en', 'de', 'ja'])
    // Within one set:cn the en (default) object sorts first.
    expect(body.printings.map((p) => p.id)).toEqual([
      'shock-a',
      'shock-b-en',
      'shock-b-de',
      'shock-b-ja',
      'shock-c',
    ])
  })

  test('limit counts distinct set:cn printings, keeping every language of each', async () => {
    const { body } = await printings('name=Shock&limit=2')
    // 2 distinct printings survive; the second brings all 3 of its languages.
    expect(body.printings.map((p) => p.id)).toEqual([
      'shock-a',
      'shock-b-en',
      'shock-b-de',
      'shock-b-ja',
    ])
    // totalPrintings counts printings, not per-language objects: 3, not 5.
    expect(body.success === true && body.totalPrintings).toBe(3)
  })

  test('a limit matching the distinct printing count leaves totalPrintings off', async () => {
    const { body } = await printings('name=Shock&limit=3')
    expect(body.printings).toHaveLength(5)
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
