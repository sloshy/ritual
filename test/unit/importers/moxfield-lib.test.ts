import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test'
import { fetchMoxfieldDeck } from '../../../src/importers/moxfield-lib'
import { MemoryLogger, resetLogger, setLogger } from '../../test-utils'

const mockDeckData = {
  name: 'Moxfield Deck',
  description: 'A description',
  primer: 'A primer',
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

class MockMoxfieldApi {
  deckList = {
    findById: mock(async (id: string) => {
      if (id === 'bad-id') throw new Error('Not found')
      return mockDeckData
    }),
  }
}

describe('Moxfield Importer', () => {
  beforeEach(() => {
    setLogger(new MemoryLogger())
  })

  afterEach(() => {
    resetLogger()
  })

  test('fetches and parses deck using library', async () => {
    const mockApi = new MockMoxfieldApi() as any
    const deck = await fetchMoxfieldDeck('12345', mockApi)

    expect(deck.name).toBe('Moxfield Deck')
    expect(deck.sourceId).toBe('12345')
    expect(deck.sections).toHaveLength(2)

    // Check mainboard
    const main = deck.sections.find((s) => s.name === 'Main')
    expect(main).toBeDefined()
    expect(main?.cards[0]?.name).toBe('Sol Ring')

    // Check sideboard
    const sb = deck.sections.find((s) => s.name === 'Sideboard')
    expect(sb).toBeDefined()
    expect(sb?.cards[0]?.name).toBe('Island')
  })

  test('propagates errors', async () => {
    const mockApi = new MockMoxfieldApi() as any
    expect(fetchMoxfieldDeck('bad-id', mockApi)).rejects.toThrow('Not found')
  })
})
