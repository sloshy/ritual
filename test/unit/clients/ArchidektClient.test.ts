import { describe, test, expect, mock } from 'bun:test'
import { ArchidektClient, getArchidektFormat } from '../../../src/clients/ArchidektClient'

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

    const client = new ArchidektClient({ fetch: mockFetch } as any)
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

    const client = new ArchidektClient({ fetch: mockFetch } as any)
    const decks = await client.fetchOwnDecks('mytoken')

    expect(mockFetch).toHaveBeenCalled()
    expect(decks).toHaveLength(1)
    expect(decks[0]?.name).toBe('My Private Deck')
  })

  test('should throw error on failure', async () => {
    const mockFetch = mock(async () => new Response('Error', { status: 500 }))
    const client = new ArchidektClient({ fetch: mockFetch } as any)

    expect(client.fetchPublicDecks('bad')).rejects.toThrow('Failed to fetch public decks')
  })

  test('should map format IDs to strings', () => {
    expect(getArchidektFormat(1)).toBe('Standard')
    expect(getArchidektFormat(3)).toBe('Commander / EDH')
    expect(getArchidektFormat(999)).toBe('Unknown')
  })

  test('should fetch deck details', async () => {
    const mockFetch = mock(async (_url) => {
      return new Response(
        JSON.stringify({
          id: 1,
          name: 'Test Deck',
          cards: [
            {
              quantity: 1,
              card: { oracleCard: { name: 'Card A' } },
              categories: [{ id: 1, name: 'Main' }],
            },
          ],
          categories: [{ id: 1, name: 'Main' }],
        }),
      )
    })
    const client = new ArchidektClient({ fetch: mockFetch } as any)
    const deck = await client.fetchDeck('1')
    expect(mockFetch).toHaveBeenCalled()
    expect(deck.name).toBe('Test Deck')
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]?.name).toBe('Main')
  })

  test('should parse categories and description from deck response', async () => {
    const mockFetch = mock(async () => {
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

    const client = new ArchidektClient({ fetch: mockFetch } as any)
    const deck = await client.fetchDeck('12345')

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

  test('should fetch deck details with token', async () => {
    const mockFetch = mock(async (_url: any, opts: any) => {
      if (opts.headers.Authorization !== 'JWT token') {
        return new Response('Unauthorized', { status: 401 })
      }
      return new Response(
        JSON.stringify({
          id: 1,
          name: 'Private Deck',
          cards: [],
        }),
      )
    })
    const client = new ArchidektClient({ fetch: mockFetch } as any)
    const deck = await client.fetchDeck('1', 'token')
    expect(deck.name).toBe('Private Deck')
  })

  test('should throw error when fetchDeck fails', async () => {
    const mockFetch = mock(
      async () => new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    )
    const client = new ArchidektClient({ fetch: mockFetch } as any)
    expect(client.fetchDeck('bad-id')).rejects.toThrow(/Failed to fetch deck/)
  })
})
