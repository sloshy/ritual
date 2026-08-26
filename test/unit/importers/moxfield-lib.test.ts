import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { fetchMoxfieldDeck } from '../../../src/importers/moxfield-lib'
import { MoxfieldClient } from '../../../src/importers/moxfield-client'
import { type HttpClient } from '../../../src/util/interfaces'
import { MemoryLogger, resetLogger, setLogger } from '../../test-utils'

const deckResponse = {
  id: 'internal-id-1',
  publicId: '12345',
  name: 'Moxfield Deck',
  description: 'A description',
  // The v3 API returns hasPrimer: null even for decks that do have primers,
  // so the importer must always attempt the primer fetch regardless of it.
  hasPrimer: null,
  boards: {
    mainboard: {
      cards: {
        card1: { quantity: 1, card: { name: 'Sol Ring' } },
      },
    },
    sideboard: {
      cards: {
        card2: { quantity: 15, card: { name: 'Island' } },
      },
    },
  },
}

const primerResponse = { content: 'A primer' }

function makeMockHttpClient(
  deckJson: object = deckResponse,
  primerJson: object | null = primerResponse,
): HttpClient {
  return {
    fetch: async (url: string | URL) => {
      const urlStr = String(url)
      if (urlStr.includes('/primer')) {
        if (primerJson === null) {
          return new Response(null, { status: 404 })
        }
        return new Response(JSON.stringify(primerJson), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(deckJson), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  }
}

describe('Moxfield Importer', () => {
  beforeEach(() => {
    setLogger(new MemoryLogger())
  })

  afterEach(() => {
    resetLogger()
  })

  test('fetches and parses deck with primer via separate endpoint', async () => {
    const client = new MoxfieldClient(makeMockHttpClient())
    const deck = await fetchMoxfieldDeck('12345', client)

    expect(deck.name).toBe('Moxfield Deck')
    expect(deck.sourceId).toBe('12345')
    expect(deck.sections).toHaveLength(2)
    expect(deck.primer).toBe('A primer')

    // Check mainboard
    const main = deck.sections.find((s) => s.name === 'Main')
    expect(main).toBeDefined()
    expect(main?.cards[0]?.name).toBe('Sol Ring')

    // Check sideboard
    const sb = deck.sections.find((s) => s.name === 'Sideboard')
    expect(sb).toBeDefined()
    expect(sb?.cards[0]?.name).toBe('Island')
  })

  test('carries the printing and finish Moxfield states for each card', async () => {
    const withPrintings = {
      ...deckResponse,
      boards: {
        mainboard: {
          cards: {
            a: {
              quantity: 2,
              finish: 'foil',
              card: { name: 'Lightning Bolt', set: 'LEA', cn: '161' },
            },
            // Same card, different printing: a separate line, not a merge.
            b: {
              quantity: 1,
              finish: 'nonFoil',
              card: { name: 'Lightning Bolt', set: 'm10', cn: '146' },
            },
            // Same printing as `b`: merges into it.
            c: {
              quantity: 3,
              finish: 'nonFoil',
              card: { name: 'Lightning Bolt', set: 'M10', cn: '146' },
            },
            d: { quantity: 1, finish: 'etched', card: { name: 'Sol Ring', set: 'CLB', cn: '319' } },
            // No printing data at all: still imported, just bare.
            e: { quantity: 4, card: { name: 'Island' } },
          },
        },
      },
    }
    const client = new MoxfieldClient(makeMockHttpClient(withPrintings))
    const deck = await fetchMoxfieldDeck('12345', client)

    // Set codes lowercase internally; the serializer uppercases them on output.
    expect(deck.sections[0]?.cards).toEqual([
      { quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', finish: 'foil' },
      {
        quantity: 4,
        name: 'Lightning Bolt',
        set: 'm10',
        collectorNumber: '146',
        finish: undefined,
      },
      { quantity: 1, name: 'Sol Ring', set: 'clb', collectorNumber: '319', finish: 'etched' },
      {
        quantity: 4,
        name: 'Island',
        set: undefined,
        collectorNumber: undefined,
        finish: undefined,
      },
    ])
  })

  test('drops half a printing rather than carrying a set that cannot be written', async () => {
    // `printingSuffix` writes `(SET:NUM)` or nothing, so a set with no collector
    // number would vanish on serialize while still splitting the merge.
    const halfPrintings = {
      ...deckResponse,
      boards: {
        mainboard: {
          cards: {
            a: { quantity: 3, card: { name: 'Forest', set: 'UNF' } },
            b: { quantity: 2, card: { name: 'Forest', set: 'THB' } },
          },
        },
      },
    }
    const client = new MoxfieldClient(makeMockHttpClient(halfPrintings))
    const deck = await fetchMoxfieldDeck('12345', client)

    expect(deck.sections[0]?.cards).toEqual([
      {
        quantity: 5,
        name: 'Forest',
        set: undefined,
        collectorNumber: undefined,
        finish: undefined,
      },
    ])
  })

  test('maps the Moxfield format slug onto a canonical format key', async () => {
    const client = new MoxfieldClient(
      makeMockHttpClient({ ...deckResponse, format: 'duelCommander' }),
    )
    const deck = await fetchMoxfieldDeck('12345', client)

    expect(deck.format).toBe('duel-commander')
  })

  test('leaves the format unset for a format Ritual does not model', async () => {
    const client = new MoxfieldClient(makeMockHttpClient({ ...deckResponse, format: 'none' }))
    const deck = await fetchMoxfieldDeck('12345', client)

    expect(deck.format).toBeUndefined()
  })

  test('falls back to inline deck.primer when primer endpoint returns 404', async () => {
    const deckWithInlinePrimer = { ...deckResponse, primer: 'Inline primer' }
    const client = new MoxfieldClient(makeMockHttpClient(deckWithInlinePrimer, null))
    const deck = await fetchMoxfieldDeck('12345', client)

    expect(deck.primer).toBe('Inline primer')
  })

  test('does not attempt primer fetch when deck has no id', async () => {
    let primerCalled = false
    const deckNoId = { ...deckResponse, id: undefined }
    const http: HttpClient = {
      fetch: async (url: string | URL) => {
        if (String(url).includes('/primer')) primerCalled = true
        return new Response(JSON.stringify(deckNoId), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    }
    const client = new MoxfieldClient(http)
    await fetchMoxfieldDeck('12345', client)

    expect(primerCalled).toBe(false)
  })

  test('primer is undefined when primer endpoint returns 404 and no inline primer', async () => {
    const client = new MoxfieldClient(makeMockHttpClient(deckResponse, null))
    const deck = await fetchMoxfieldDeck('12345', client)

    expect(deck.primer).toBeUndefined()
  })

  test('propagates errors on failed deck fetch', async () => {
    const http: HttpClient = {
      fetch: async () => new Response('Not found', { status: 404, statusText: 'Not Found' }),
    }
    const client = new MoxfieldClient(http)
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(fetchMoxfieldDeck('bad-id', client)).rejects.toThrow(
      'Failed to fetch Moxfield deck',
    )
  })
})
