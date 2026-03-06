import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { fetchMoxfieldDeck } from '../../../src/importers/moxfield-lib'
import { MoxfieldClient } from '../../../src/importers/moxfield-client'
import { type HttpClient } from '../../../src/interfaces'
import { MemoryLogger, resetLogger, setLogger } from '../../test-utils'

const deckResponse = {
  id: 'internal-id-1',
  publicId: '12345',
  name: 'Moxfield Deck',
  description: 'A description',
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

  test('falls back to inline deck.primer when primer endpoint returns 404', async () => {
    const deckWithInlinePrimer = { ...deckResponse, primer: 'Inline primer' }
    const client = new MoxfieldClient(makeMockHttpClient(deckWithInlinePrimer, null))
    const deck = await fetchMoxfieldDeck('12345', client)

    expect(deck.primer).toBe('Inline primer')
  })

  test('always attempts primer fetch regardless of hasPrimer field value', async () => {
    // hasPrimer: null is what the v3 API returns even for decks that do have primers
    let primerCalled = false
    const deckNullHasPrimer = { ...deckResponse, hasPrimer: null }
    const http: HttpClient = {
      fetch: async (url: string | URL) => {
        const urlStr = String(url)
        if (urlStr.includes('/primer')) {
          primerCalled = true
          return new Response(JSON.stringify(primerResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(deckNullHasPrimer), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    }
    const client = new MoxfieldClient(http)
    const deck = await fetchMoxfieldDeck('12345', client)

    expect(primerCalled).toBe(true)
    expect(deck.primer).toBe('A primer')
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
    expect(fetchMoxfieldDeck('bad-id', client)).rejects.toThrow('Failed to fetch Moxfield deck')
  })
})
