import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { ScryfallClient, type ScryfallSymbol } from '../../src/scryfall'
import type { FileSystemClient } from '../../src/interfaces'
import {
  MockHttpClient,
  InMemoryCacheManager,
  MemoryLogger,
  resetLogger,
  setLogger,
} from '../test-utils'
import { type ScryfallCard } from '../../src/types'

const readFileMock = mock(async (_path: string, _encoding: BufferEncoding) => '[]')
const writeFileMock = mock(async (_path: string, _data: string | Uint8Array) => {})
const accessMock = mock(async (_path: string) => {})
const copyFileMock = mock(async (_source: string, _destination: string) => {})
const mkdirMock = mock(async (_path: string, _options?: { recursive?: boolean }) => {})

const mockFileSystem: FileSystemClient = {
  readFile: readFileMock,
  writeFile: writeFileMock,
  access: accessMock,
  copyFile: copyFileMock,
  mkdir: mkdirMock,
}

describe('ScryfallClient', () => {
  let client: ScryfallClient
  let mockHttp: MockHttpClient
  let mockCache: InMemoryCacheManager<ScryfallCard[]>

  beforeEach(() => {
    setLogger(new MemoryLogger())
    mockHttp = new MockHttpClient()
    mockCache = new InMemoryCacheManager()
    client = new ScryfallClient(mockHttp, mockCache, mockFileSystem)

    writeFileMock.mockClear()
    readFileMock.mockClear()
    accessMock.mockClear()
    copyFileMock.mockClear()
    mkdirMock.mockClear()
  })

  afterEach(() => {
    resetLogger()
  })

  describe('fetchSymbology', () => {
    test('should fetch symbology from API and cache it', async () => {
      const mockData: ScryfallSymbol[] = [
        {
          symbol: '{T}',
          svg_uri: 'https://svg',
          english: 'tap',
          transposable: false,
          represents_mana: false,
          appears_in_mana_costs: false,
          funny: false,
          colors: [],
        },
      ]

      mockHttp.mock('https://api.scryfall.com/symbology', () => {
        return new Response(JSON.stringify({ data: mockData }))
      })

      const result = await client.fetchSymbology(true)

      expect(result).toEqual(mockData)
      expect(writeFileMock).toHaveBeenCalled()

      const writeCall = writeFileMock.mock.calls[0]
      if (writeCall && typeof writeCall[1] === 'string') {
        expect(JSON.parse(writeCall[1])).toEqual(mockData)
      }
    })
  })

  describe('fetchCardData', () => {
    test('should fetch card from API and cache via CacheManager', async () => {
      const mockCard: ScryfallCard = {
        id: '123',
        name: 'Test Card',
        cmc: 1,
        type_line: 'Instant',
        prices: { usd: '1.00', usd_foil: null, usd_etched: null },
        edhrec_rank: 999999,
        finishes: ['nonfoil'],
        set: 'tst',
        set_name: 'Test Set',
        collector_number: '1',
        rarity: 'common',
      }

      mockHttp.mock('https://api.scryfall.com/cards/named?exact=Test%20Card', () => {
        return new Response(JSON.stringify(mockCard))
      })

      const result = await client.fetchCardData('Test Card')

      expect(result).toEqual(mockCard)

      // Verify cache
      const cached = await mockCache.get('Test Card')
      expect(cached).toBeArray()
      expect(cached).toHaveLength(1)
      expect(cached?.[0]?.name).toBe('Test Card')
    })
  })

  describe('searchCards', () => {
    test('should search cards via API', async () => {
      const mockCard: ScryfallCard = {
        id: '123',
        name: 'Lightning Bolt',
        cmc: 1,
        edhrec_rank: 5,
        mana_cost: '{R}',
        type_line: 'Instant',
        oracle_text: 'Deal 3 damage.',
        prices: { usd: '1.00', usd_foil: null, usd_etched: null },
        finishes: ['nonfoil'],
        set: 'lea',
        set_name: 'Limited Edition Alpha',
        collector_number: '1',
        rarity: 'common',
      }

      mockHttp.mock('https://api.scryfall.com/cards/search?q=Lightning%20Bolt&order=edhrec', () => {
        return new Response(JSON.stringify({ data: [mockCard] }))
      })

      const result = await client.searchCards('Lightning Bolt')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(mockCard)
    })

    test('should handle pagination', async () => {
      const makeStubCard = (id: string, name: string): ScryfallCard => ({
        id,
        name,
        cmc: 0,
        type_line: '',
        prices: { usd: null, usd_foil: null, usd_etched: null },
        finishes: ['nonfoil'],
        set: 'tst',
        set_name: 'Test Set',
        collector_number: '1',
        rarity: 'common',
      })
      const card1 = makeStubCard('1', 'Card 1')
      const card2 = makeStubCard('2', 'Card 2')

      // Page 1
      mockHttp.mock('https://api.scryfall.com/cards/search?q=set%3Akhm&order=edhrec', () => {
        return new Response(
          JSON.stringify({
            has_more: true,
            next_page: 'https://api.scryfall.com/cards/search?page=2',
            data: [card1],
          }),
        )
      })

      // Page 2
      mockHttp.mock('https://api.scryfall.com/cards/search?page=2', () => {
        return new Response(
          JSON.stringify({
            has_more: false,
            data: [card2],
          }),
        )
      })

      const result = await client.searchCards('set:khm')

      expect(result).toHaveLength(2)
      expect(result[0]?.name).toBe('Card 1')
      expect(result[1]?.name).toBe('Card 2')

      // Verify caching
      const cached1 = await mockCache.get('Card 1')
      const cached2 = await mockCache.get('Card 2')
      expect(cached1).toBeDefined()
      expect(cached2).toBeDefined()
    })

    test('should return empty array on 404', async () => {
      mockHttp.mock('https://api.scryfall.com/cards/search?q=Unknown&order=edhrec', () => {
        return new Response(JSON.stringify({}), { status: 404 })
      })

      const result = await client.searchCards('Unknown')

      expect(result).toEqual([])
    })
  })

  describe('fetchNamedCard', () => {
    const mockCard: ScryfallCard = {
      id: 'abc',
      name: 'Lightning Bolt',
      cmc: 1,
      edhrec_rank: 5,
      mana_cost: '{R}',
      type_line: 'Instant',
      prices: { usd: '1.00', usd_foil: null, usd_etched: null },
      finishes: ['nonfoil'],
      set: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '1',
      rarity: 'common',
    }

    test('should fetch card with exact match by default', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/named?exact=Lightning+Bolt',
        () => new Response(JSON.stringify(mockCard)),
      )

      const result = await client.fetchNamedCard('Lightning Bolt')

      expect(result).toEqual(mockCard)
    })

    test('should fetch card with fuzzy match', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/named?fuzzy=ligh+bolt',
        () => new Response(JSON.stringify(mockCard)),
      )

      const result = await client.fetchNamedCard('ligh bolt', { fuzzy: true })

      expect(result).toEqual(mockCard)
    })

    test('should include set filter when provided', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/named?exact=Lightning+Bolt&set=lea',
        () =>
          new Response(
            JSON.stringify({ ...mockCard, set: 'lea', set_name: 'Limited Edition Alpha' }),
          ),
      )

      const result = await client.fetchNamedCard('Lightning Bolt', { set: 'lea' })

      expect(result).not.toBeNull()
      expect(result!.set).toBe('lea')
    })

    test('should return null on 404', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/named?exact=Not+A+Real+Card',
        () =>
          new Response(
            JSON.stringify({
              object: 'error',
              details: 'No cards found matching "Not A Real Card"',
            }),
            { status: 404 },
          ),
      )

      const result = await client.fetchNamedCard('Not A Real Card')

      expect(result).toBeNull()
    })
  })

  describe('fetchRandomCard', () => {
    const mockCard: ScryfallCard = {
      id: 'rand-1',
      name: 'Surprise Deployment',
      cmc: 4,
      type_line: 'Instant',
      prices: { usd: '0.25', usd_foil: null },
      image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
    } as ScryfallCard

    test('should fetch a random card without filter', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/random',
        () => new Response(JSON.stringify(mockCard)),
      )

      const result = await client.fetchRandomCard()

      expect(result).toEqual(mockCard)
    })

    test('should fetch a random card with filter', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/random?q=t%3Ainstant',
        () => new Response(JSON.stringify(mockCard)),
      )

      const result = await client.fetchRandomCard('t:instant')

      expect(result).toEqual(mockCard)
    })

    test('should return null on error', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/random?q=impossible%3Aquery',
        () =>
          new Response(JSON.stringify({ object: 'error', details: 'No cards match your query' }), {
            status: 404,
          }),
      )

      const result = await client.fetchRandomCard('impossible:query')

      expect(result).toBeNull()
    })
  })

  describe('pricing backend methods', () => {
    test('should fetch latest prices in batch format using request order', async () => {
      mockHttp.mock('https://api.scryfall.com/cards/collection', () => {
        return new Response(
          JSON.stringify({
            data: [
              // Intentionally incorrect names to verify mapping by request order, not by response content
              { name: 'Unexpected Name A', prices: { usd: '2.50' } },
              { name: 'Unexpected Name B', prices: { usd: '1.25' } },
            ],
          }),
        )
      })

      const result = await client.fetchLatestPrices(['Lightning Bolt', 'Counterspell'])

      expect(result.get('Lightning Bolt')).toBe(2.5)
      expect(result.get('Counterspell')).toBe(1.25)
    })

    test('should throw when collection API returns not_found entries', async () => {
      mockHttp.mock('https://api.scryfall.com/cards/collection', () => {
        return new Response(
          JSON.stringify({
            data: [{ name: 'Lightning Bolt', prices: { usd: '2.50' } }],
            not_found: [{ name: 'Counterspell' }, { name: 'Bogus Card' }],
          }),
        )
      })

      await expect(client.fetchLatestPrices(['Lightning Bolt', 'Counterspell'])).rejects.toThrow(
        'Scryfall could not find prices for: Counterspell, Bogus Card',
      )
    })

    test('should fetch min max pricing for a card', async () => {
      const encodedName = encodeURIComponent('!"Lightning Bolt"')
      const searchUrl = `https://api.scryfall.com/cards/search?q=${encodedName}+unique%3Aprints&order=usd&dir=asc`

      mockHttp.mock(searchUrl, () => {
        return new Response(
          JSON.stringify({
            data: [
              { prices: { usd: '1.00' } },
              { prices: { usd: '2.00' } },
              { prices: { usd: '5.00' } },
            ],
          }),
        )
      })

      const result = await client.fetchMinMaxPrice('Lightning Bolt')

      expect(result).toEqual({ min: 1, max: 5 })
    })
  })

  describe('downloadImage', () => {
    test('should copy from cache when image already exists', async () => {
      accessMock.mockResolvedValue(undefined)
      const result = await client.downloadImage('https://image.example/card.png', '/tmp/card.png')

      expect(result).toBeTrue()
      expect(mkdirMock).toHaveBeenCalled()
      expect(copyFileMock).toHaveBeenCalled()
    })

    test('should download and write when image is not cached', async () => {
      accessMock.mockRejectedValue(new Error('missing'))
      mockHttp.mock('https://image.example/card.png', () => {
        return new Response(new Blob([new Uint8Array([1, 2, 3])]))
      })

      const result = await client.downloadImage('https://image.example/card.png', '/tmp/card.png')

      expect(result).toBeTrue()
      expect(writeFileMock).toHaveBeenCalledTimes(2)
    })
  })
})
