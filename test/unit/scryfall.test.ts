import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { ScryfallClient, type ScryfallSymbol, comparePrintings } from '../../src/scryfall'
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
    client = new ScryfallClient(mockHttp, mockCache, mockFileSystem, 0)

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

    test('should fetch symbology when cache file is missing', async () => {
      const mockData: ScryfallSymbol[] = [
        {
          symbol: '{W}',
          svg_uri: 'https://svg',
          english: 'white mana',
          transposable: false,
          represents_mana: true,
          appears_in_mana_costs: true,
          funny: false,
          colors: ['W'],
        },
      ]

      readFileMock.mockImplementationOnce(async () => {
        throw new Error('ENOENT: no such file or directory')
      })

      mockHttp.mock('https://api.scryfall.com/symbology', () => {
        return new Response(JSON.stringify({ data: mockData }))
      })

      const result = await client.fetchSymbology()

      expect(result).toEqual(mockData)
      expect(mkdirMock).toHaveBeenCalled()
      expect(writeFileMock).toHaveBeenCalled()
    })
  })

  describe('fetchCardData', () => {
    test('should fetch card from API and cache via CacheManager', async () => {
      const mockCard: ScryfallCard = {
        id: '123',
        name: 'Test Card',
        cmc: 1,
        type_line: 'Instant',
        prices: {
          usd: '1.00',
          usd_foil: null,
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
        edhrec_rank: 999999,
        finishes: ['nonfoil'],
        games: ['paper'],
        set: 'tst',
        set_name: 'Test Set',
        collector_number: '1',
        rarity: 'common',
        color_identity: [],
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
        prices: {
          usd: '1.00',
          usd_foil: null,
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
        finishes: ['nonfoil'],
        games: ['paper'],
        set: 'lea',
        set_name: 'Limited Edition Alpha',
        collector_number: '1',
        rarity: 'common',
        color_identity: [],
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
        prices: {
          usd: null,
          usd_foil: null,
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
        finishes: ['nonfoil'],
        games: ['paper'],
        set: 'tst',
        set_name: 'Test Set',
        collector_number: '1',
        rarity: 'common',
        color_identity: [],
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
      prices: {
        usd: '1.00',
        usd_foil: null,
        usd_etched: null,
        eur: null,
        eur_foil: null,
        tix: null,
      },
      finishes: ['nonfoil'],
      games: ['paper'],
      set: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '1',
      rarity: 'common',
      color_identity: ['R'],
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

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
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

  describe('fetchRepresentativePrints', () => {
    function makeCard(
      id: string,
      prices: Partial<{ usd: string; eur: string; tix: string }>,
    ): ScryfallCard {
      return {
        id,
        name: 'Test Card',
        cmc: 0,
        type_line: 'Artifact',
        prices: {
          usd: prices.usd ?? null,
          usd_foil: null,
          usd_etched: null,
          eur: prices.eur ?? null,
          eur_foil: null,
          tix: prices.tix ?? null,
        },
        finishes: ['nonfoil'],
        games: ['paper'],
        set: 'tst',
        set_name: 'Test Set',
        collector_number: '1',
        rarity: 'common',
        color_identity: [],
      }
    }

    function searchUrl(name: string) {
      return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${name}"`) + '+unique%3Aprints'}&order=released`
    }

    test('picks representative (latest within 1.5x median) for each currency', async () => {
      // Results ordered newest first (index 0 = newest)
      // USD prices: 1.00, 2.00, 3.00 → median 2.00, threshold 3.00 → first card (1.00) chosen
      // TIX prices: only card[2] has tix → only 1 candidate, median = 1.50 → chosen
      const cards = [
        makeCard('a', { usd: '1.00', eur: '0.80' }),
        makeCard('b', { usd: '2.00', eur: '1.60' }),
        makeCard('c', { usd: '3.00', eur: '2.40', tix: '1.50' }),
      ]

      mockHttp.mock(searchUrl('Colossus Hammer'), () => {
        return new Response(JSON.stringify({ data: cards, has_more: false }))
      })

      const result = await client.fetchRepresentativePrints('Colossus Hammer', [
        'usd',
        'eur',
        'tix',
      ])

      // USD: median of [1,2,3]=2, threshold=3; first card 1.00 ≤ 3 → representative='a', cheapest='a'
      expect(result.usd?.representative?.id).toBe('a')
      expect(result.usd?.cheapest?.id).toBe('a')
      // EUR: median of [0.80,1.60,2.40]=1.60, threshold=2.40; first card 0.80 ≤ 2.40 → 'a'
      expect(result.eur?.representative?.id).toBe('a')
      // TIX: only one candidate (card 'c', 1.50), median=1.50, threshold=2.25; chosen
      expect(result.tix?.representative?.id).toBe('c')
      expect(result.tix?.cheapest?.id).toBe('c')
    })

    test('skips the latest card when its price exceeds 1.5x median', async () => {
      // USD prices: 10.00, 2.00, 2.00 → median 2.00, threshold 3.00
      // card 'a' (10.00) exceeds threshold, so representative picks 'b' (2.00)
      const cards = [
        makeCard('a', { usd: '10.00' }),
        makeCard('b', { usd: '2.00' }),
        makeCard('c', { usd: '2.00' }),
      ]

      mockHttp.mock(searchUrl('Expensive Card'), () => {
        return new Response(JSON.stringify({ data: cards, has_more: false }))
      })

      const result = await client.fetchRepresentativePrints('Expensive Card', ['usd'])

      expect(result.usd?.representative?.id).toBe('b')
      expect(result.usd?.cheapest?.id).toBe('b')
    })

    test('returns null representative and cheapest when no cards have prices', async () => {
      const cards = [makeCard('a', {}), makeCard('b', {})]

      mockHttp.mock(searchUrl('No Price Card'), () => {
        return new Response(JSON.stringify({ data: cards, has_more: false }))
      })

      const result = await client.fetchRepresentativePrints('No Price Card', ['usd', 'tix'])

      expect(result.usd?.representative).toBeNull()
      expect(result.usd?.cheapest).toBeNull()
      expect(result.tix?.representative).toBeNull()
      expect(result.tix?.cheapest).toBeNull()
    })

    test('returns null representative and cheapest on API error', async () => {
      mockHttp.mock(searchUrl('Error Card'), () => {
        return new Response('Not Found', { status: 404 })
      })

      const result = await client.fetchRepresentativePrints('Error Card', ['usd', 'tix'])

      expect(result.usd?.representative).toBeNull()
      expect(result.tix?.representative).toBeNull()
    })

    test('considers at most 5 candidates per currency for representative selection', async () => {
      // 6 cards with tix prices; only first 5 used for median
      // tix prices: 1,2,3,4,5,100 → median=3, threshold=4.5 → representative='a' (1.00)
      // cheapest from ALL cards is still 'a' (1.00)
      const cards = [
        makeCard('a', { tix: '1.00' }),
        makeCard('b', { tix: '2.00' }),
        makeCard('c', { tix: '3.00' }),
        makeCard('d', { tix: '4.00' }),
        makeCard('e', { tix: '5.00' }),
        makeCard('f', { tix: '100.00' }),
      ]

      mockHttp.mock(searchUrl('Many Prints'), () => {
        return new Response(JSON.stringify({ data: cards, has_more: false }))
      })

      const result = await client.fetchRepresentativePrints('Many Prints', ['tix'])

      expect(result.tix?.representative?.id).toBe('a')
      expect(result.tix?.cheapest?.id).toBe('a')
    })

    test('fetches all pages and returns cheapest from all pages', async () => {
      // Page 1: card 'a' (usd=2.00) — representative selected from here
      // Page 2: card 'b' (usd=0.50) — cheaper, becomes cheapest
      const page2Url = 'https://api.scryfall.com/cards/search?page=2'

      mockHttp.mock(searchUrl('Paginated Card'), () => {
        return new Response(
          JSON.stringify({
            data: [makeCard('a', { usd: '2.00' })],
            has_more: true,
            next_page: page2Url,
          }),
        )
      })

      mockHttp.mock(page2Url, () => {
        return new Response(
          JSON.stringify({
            data: [makeCard('b', { usd: '0.50' })],
            has_more: false,
          }),
        )
      })

      const result = await client.fetchRepresentativePrints('Paginated Card', ['usd'])

      expect(result.usd?.representative?.id).toBe('a')
      expect(result.usd?.cheapest?.id).toBe('b')
    })

    test('only computes requested currencies', async () => {
      const cards = [makeCard('a', { usd: '1.00', eur: '0.90', tix: '0.10' })]

      mockHttp.mock(searchUrl('Selective Card'), () => {
        return new Response(JSON.stringify({ data: cards, has_more: false }))
      })

      const result = await client.fetchRepresentativePrints('Selective Card', ['usd'])

      expect(result.usd?.representative?.id).toBe('a')
      expect(result.eur).toBeUndefined()
      expect(result.tix).toBeUndefined()
    })
  })

  describe('downloadSymbol', () => {
    test('should create cache directory when downloading a missing symbol', async () => {
      accessMock.mockRejectedValueOnce(new Error('missing'))
      mockHttp.mock('https://image.example/symbol-ur.svg', () => {
        return new Response(new Blob([new Uint8Array([1, 2, 3])]))
      })

      const symbol: ScryfallSymbol = {
        symbol: '{U/R}',
        svg_uri: 'https://image.example/symbol-ur.svg',
        english: 'blue or red mana',
        transposable: false,
        represents_mana: true,
        appears_in_mana_costs: true,
        funny: false,
        colors: ['U', 'R'],
      }

      const result = await client.downloadSymbol(symbol, '/tmp/symbols')

      expect(result).toBe('UR.svg')
      expect(mkdirMock).toHaveBeenCalled()
      expect(writeFileMock).toHaveBeenCalled()
      expect(copyFileMock).toHaveBeenCalled()
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

describe('comparePrintings', () => {
  function makePrinting(set: string, collectorNumber: string): ScryfallCard {
    return {
      id: `${set}-${collectorNumber}`,
      name: 'Test',
      cmc: 0,
      type_line: 'Creature',
      prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
      edhrec_rank: 0,
      finishes: ['nonfoil'],
      games: ['paper'],
      set,
      set_name: set,
      collector_number: collectorNumber,
      rarity: 'common',
      color_identity: [],
    }
  }

  test('3-letter set codes sort before 4-letter', () => {
    const a = makePrinting('CMM', '1')
    const b = makePrinting('PLST', '1')
    expect(comparePrintings(a, b)).toBeLessThan(0)
  })

  test('sorts alphabetically within same set code length', () => {
    const a = makePrinting('CMM', '1')
    const b = makePrinting('FDN', '1')
    expect(comparePrintings(a, b)).toBeLessThan(0)
  })

  test('sorts by collector number within same set', () => {
    const a = makePrinting('FDN', '2')
    const b = makePrinting('FDN', '294')
    expect(comparePrintings(a, b)).toBeLessThan(0)
  })

  test('numeric collector number without suffix sorts before one with suffix', () => {
    const a = makePrinting('FDN', '630')
    const b = makePrinting('FDN', '630p')
    expect(comparePrintings(a, b)).toBeLessThan(0)
  })

  test('sorts multiple printings correctly', () => {
    const cards = [
      makePrinting('PLST', '10E-30'),
      makePrinting('FDN', '294'),
      makePrinting('CMM', '1'),
      makePrinting('FDN', '2'),
      makePrinting('MOM', '12'),
    ]
    cards.sort(comparePrintings)
    const result = cards.map((c) => `${c.set}:${c.collector_number}`)
    expect(result).toEqual(['CMM:1', 'FDN:2', 'FDN:294', 'MOM:12', 'PLST:10E-30'])
  })
})
