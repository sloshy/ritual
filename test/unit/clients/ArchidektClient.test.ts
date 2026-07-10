import { describe, test, expect, mock } from 'bun:test'
import { ArchidektClient } from '../../../src/clients/ArchidektClient'
import {
  type ArchidektDeckResponse,
  parseArchidektDeckResponse,
} from '../../../src/importers/archidekt-types'

describe('ArchidektClient', () => {
  test('should fetch public decks', async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 1,
              name: 'Deck 1',
              updatedAt: '2023-01-01',
              deckFormat: 3,
              owner: { username: 'user1' },
            },
            {
              id: 2,
              name: 'Deck 2',
              updatedAt: '2023-01-02',
              deckFormat: 1,
              owner: { username: 'user1' },
            },
          ],
        }),
      )
    })

    const client = new ArchidektClient({ fetch: mockFetch })
    const decks = await client.fetchPublicDecks('user1')

    expect(mockFetch).toHaveBeenCalled()
    expect(decks).toHaveLength(2)
    expect(decks[0]?.id).toBe(1)
    expect(decks[1]?.name).toBe('Deck 2')
  })

  test('should fetch own decks with JWT token', async () => {
    const mockFetch = mock(async (_url: string | URL | Request, opts?: any) => {
      if (opts?.headers?.Authorization !== 'JWT mytoken') {
        return new Response('Unauthorized', { status: 401 })
      }
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 3,
              name: 'My Private Deck',
              updatedAt: '2023-01-03',
              deckFormat: 3,
              owner: { username: 'me' },
            },
          ],
        }),
      )
    })

    const client = new ArchidektClient({ fetch: mockFetch })
    const decks = await client.fetchOwnDecks('mytoken')

    expect(mockFetch).toHaveBeenCalled()
    expect(decks).toHaveLength(1)
    expect(decks[0]?.name).toBe('My Private Deck')
  })

  test('should throw error on failure', async () => {
    const mockFetch = mock(async () => new Response('Error', { status: 500 }))
    const client = new ArchidektClient({ fetch: mockFetch })

    expect(client.fetchPublicDecks('bad')).rejects.toThrow('Failed to fetch public decks')
  })

  test('should fall back to the Main section for unknown category IDs', async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: 1,
          name: 'Test Deck',
          cards: [
            {
              quantity: 1,
              card: { oracleCard: { name: 'Card A' } },
              categories: [99],
            },
          ],
          categories: [{ id: 1, name: 'Commander' }],
        }),
      )
    })
    const client = new ArchidektClient({ fetch: mockFetch })
    const deck = await client.fetchDeck('1')
    const main = deck.sections.find((s) => s.name === 'Main')
    expect(main).toBeDefined()
    expect(main?.cards).toEqual([{ name: 'Card A', quantity: 1 }])
  })

  test('should parse categories and description from deck response', async () => {
    const mockFetch = mock(async (_url: string | URL | Request, opts?: any) => {
      if (opts?.headers?.Authorization !== 'JWT mytoken') {
        return new Response('Unauthorized', { status: 401 })
      }
      return new Response(
        JSON.stringify({
          id: 12345,
          name: 'Test Deck',
          description: '{"ops":[{"insert":"Hello world"}]}',
          categories: [
            { id: 1, name: 'Commander' },
            { id: 2, name: 'Land' },
          ],
          cards: [
            {
              card: { oracleCard: { name: 'Sol Ring' } },
              quantity: 1,
              categories: [1],
            },
            {
              card: { oracleCard: { name: 'Forest' } },
              quantity: 10,
              categories: [2],
            },
          ],
        }),
      )
    })

    const client = new ArchidektClient({ fetch: mockFetch })
    const deck = await client.fetchDeck('12345', 'mytoken')

    expect(deck.name).toBe('Test Deck')
    expect(deck.sourceId).toBe('12345')
    expect(deck.description).toBe('Hello world')
    expect(deck.sections).toHaveLength(2)

    const commander = deck.sections.find((s) => s.name === 'Commander')
    expect(commander).toBeDefined()
    expect(commander?.cards).toHaveLength(1)
    expect(commander?.cards[0]?.name).toBe('Sol Ring')

    const main = deck.sections.find((s) => s.name === 'Main')
    expect(main).toBeDefined()
    expect(main?.cards).toHaveLength(1)
    expect(main?.cards[0]?.name).toBe('Forest')
    expect(main?.cards[0]?.quantity).toBe(10)
  })

  test('should parse a response with no categories and no cards', () => {
    const response: ArchidektDeckResponse = { name: 'X', cards: [] }
    expect(parseArchidektDeckResponse(response, '1').sections).toHaveLength(0)
  })

  test('should throw error when fetchDeck fails', async () => {
    const mockFetch = mock(
      async () => new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    )
    const client = new ArchidektClient({ fetch: mockFetch })
    expect(client.fetchDeck('bad-id')).rejects.toThrow(/Failed to fetch deck/)
  })
})
