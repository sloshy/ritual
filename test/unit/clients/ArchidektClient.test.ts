import { describe, it, expect, mock } from 'bun:test'
import { ArchidektClient } from '../../../src/clients/ArchidektClient'

describe('ArchidektClient', () => {
  it('should fetch public decks', async () => {
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

  it('should fetch own decks with JWT token', async () => {
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

  it('should throw error on failure', async () => {
    const mockFetch = mock(async () => new Response('Error', { status: 500 }))
    const client = new ArchidektClient({ fetch: mockFetch } as any)

    expect(client.fetchPublicDecks('bad')).rejects.toThrow('Failed to fetch public decks')
  })

  it('should map format IDs to strings', () => {
    const { getArchidektFormat } = require('../../../src/clients/ArchidektClient')
    expect(getArchidektFormat(1)).toBe('Standard')
    expect(getArchidektFormat(3)).toBe('Commander / EDH')
    expect(getArchidektFormat(999)).toBe('Unknown')
  })

  it('should fetch deck details', async () => {
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

  it('should fetch deck details with token', async () => {
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
})
