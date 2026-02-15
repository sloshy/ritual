import { describe, expect, test, mock } from 'bun:test'
import { fetchArchidektDeck } from '../../../src/importers/archidekt'
import { type HttpClient } from '../../../src/interfaces'

describe('Archidekt Importer', () => {
  test('fetches and parses a simple deck', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
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
            categories: [1], // Commander
          },
          {
            card: { oracleCard: { name: 'Forest' } },
            quantity: 10,
            categories: [2], // Land -> Main
          },
        ],
      }),
    }

    const mockHttp: HttpClient = {
      fetch: mock(async () => mockResponse as any),
    }

    const deck = await fetchArchidektDeck('12345', mockHttp)

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

  test('handles failed fetch', async () => {
    const mockHttp: HttpClient = {
      fetch: mock(async () => ({ ok: false, status: 404 }) as any),
    }

    expect(fetchArchidektDeck('bad-id', mockHttp)).rejects.toThrow(/Failed to fetch deck/)
  })
})
