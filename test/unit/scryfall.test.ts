import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import {
  ScryfallClient,
  type ScryfallSymbol,
  comparePrintings,
  computeRepresentativePrints,
  getCardGames,
  isArenaOnly,
  isToken,
} from '../../src/scryfall'
import { cardCache } from '../../src/cache'
import type { FileSystemClient } from '../../src/interfaces'
import {
  MockHttpClient,
  InMemoryCacheManager,
  MemoryFileSystemClient,
  MemoryLogger,
  gzipJsonLinesResponse,
  resetLogger,
  setLogger,
} from '../test-utils'
import { type ScryfallCard } from '../../src/types'

const readFileMock = mock(async (_path: string, _encoding: BufferEncoding) => '[]')
const writeFileMock = mock(async (_path: string, _data: string | Uint8Array) => {})
const writeFileExclusiveMock = mock(
  async (_path: string, _data: string | Uint8Array) => 'created' as const,
)
const renameMock = mock(async (_source: string, _destination: string) => {})
const unlinkMock = mock(async (_path: string) => {})
const accessMock = mock(async (_path: string) => {})
const copyFileMock = mock(async (_source: string, _destination: string) => {})
const mkdirMock = mock(async (_path: string, _options?: { recursive?: boolean }) => {})

const mockFileSystem: FileSystemClient = {
  readFile: readFileMock,
  writeFile: writeFileMock,
  writeFileExclusive: writeFileExclusiveMock,
  rename: renameMock,
  unlink: unlinkMock,
  access: accessMock,
  copyFile: copyFileMock,
  mkdir: mkdirMock,
}

function makeStubScryfallCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'test-id',
    name: 'Test Card',
    cmc: 0,
    type_line: 'Artifact',
    prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    finishes: ['nonfoil'],
    games: ['paper'],
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    color_identity: [],
    ...overrides,
  }
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

      const writeCall = writeFileMock.mock.calls[0]!
      expect(JSON.parse(writeCall[1] as string)).toEqual(mockData)
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
      const card1 = makeStubScryfallCard({ id: '1', name: 'Card 1' })
      const card2 = makeStubScryfallCard({ id: '2', name: 'Card 2' })

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

      // Verify caching: assert the cached payloads actually round-trip the card,
      // not just that *something* sits at that key. A `toBeDefined()` check would
      // pass even if the cache stored an empty array or the wrong page's data.
      const cached1 = await mockCache.get('Card 1')
      const cached2 = await mockCache.get('Card 2')
      expect(cached1?.[0]?.name).toBe('Card 1')
      expect(cached2?.[0]?.name).toBe('Card 2')
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

    test('fetchMinMaxPrice returns zero fallback when the search returns 404', async () => {
      const encodedName = encodeURIComponent('!"Unknown Card"')
      const searchUrl = `https://api.scryfall.com/cards/search?q=${encodedName}+unique%3Aprints&order=usd&dir=asc`

      mockHttp.mock(
        searchUrl,
        () => new Response(JSON.stringify({ object: 'error' }), { status: 404 }),
      )

      const result = await client.fetchMinMaxPrice('Unknown Card')
      expect(result).toEqual({ min: 0, max: 0 })
    })

    test('fetchMinMaxPrice returns zero fallback when no printing has a price', async () => {
      const encodedName = encodeURIComponent('!"Priceless Card"')
      const searchUrl = `https://api.scryfall.com/cards/search?q=${encodedName}+unique%3Aprints&order=usd&dir=asc`

      mockHttp.mock(searchUrl, () => {
        return new Response(
          JSON.stringify({
            data: [{ prices: { usd: null } }, { prices: { usd: null } }],
          }),
        )
      })

      const result = await client.fetchMinMaxPrice('Priceless Card')
      expect(result).toEqual({ min: 0, max: 0 })
    })

    test('fetchLatestPrices reads the eur price field when currency=eur', async () => {
      mockHttp.mock('https://api.scryfall.com/cards/collection', () => {
        return new Response(
          JSON.stringify({
            // usd is set but should be ignored when currency=eur
            data: [{ name: 'Sol Ring', prices: { usd: '99.00', eur: '3.50' } }],
          }),
        )
      })

      const result = await client.fetchLatestPrices(['Sol Ring'], 'eur')

      expect(result.get('Sol Ring')).toBe(3.5)
    })
  })

  describe('fetchRepresentativePrints', () => {
    function makeCard(
      id: string,
      prices: Partial<{ usd: string; eur: string; tix: string }>,
    ): ScryfallCard {
      return makeStubScryfallCard({
        id,
        prices: {
          usd: prices.usd ?? null,
          usd_foil: null,
          usd_etched: null,
          eur: prices.eur ?? null,
          eur_foil: null,
          tix: prices.tix ?? null,
        },
      })
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
  function makePrinting(set: string, collectorNumber: string, releasedAt?: string): ScryfallCard {
    return makeStubScryfallCard({
      id: `${set}-${collectorNumber}-${releasedAt ?? ''}`,
      type_line: 'Creature',
      edhrec_rank: 0,
      set,
      set_name: set,
      collector_number: collectorNumber,
      released_at: releasedAt,
    })
  }

  test('newer release date sorts before older (primary key)', () => {
    const newer = makePrinting('AAA', '1', '2024-06-01')
    const older = makePrinting('AAA', '1', '2020-01-01')
    expect(comparePrintings(newer, older)).toBeLessThan(0)
    expect(comparePrintings(older, newer)).toBeGreaterThan(0)
  })

  test('newer release date wins even when set code would otherwise sort first', () => {
    // 'AAA' < 'ZZZ' alphabetically, but ZZZ is newer
    const newer = makePrinting('ZZZ', '1', '2024-06-01')
    const older = makePrinting('AAA', '1', '2020-01-01')
    expect(comparePrintings(newer, older)).toBeLessThan(0)
  })

  test('same release date falls through to set code alphabetical tiebreaker', () => {
    const a = makePrinting('CMM', '1', '2024-01-01')
    const b = makePrinting('FDN', '1', '2024-01-01')
    expect(comparePrintings(a, b)).toBeLessThan(0)
  })

  test('missing released_at on both falls through to set-code alphabetical tiebreaker', () => {
    // Both printings lack a date, so the date comparator returns no preference and
    // the decision passes to the set-code key, where 'CMM' sorts before 'FDN'.
    const a = makePrinting('CMM', '1')
    const b = makePrinting('FDN', '1')
    expect(comparePrintings(a, b)).toBeLessThan(0)
  })

  test('same date and set falls through to collector number tiebreaker', () => {
    const a = makePrinting('FDN', '2', '2024-01-01')
    const b = makePrinting('FDN', '294', '2024-01-01')
    expect(comparePrintings(a, b)).toBeLessThan(0)
  })

  test('numeric collector number sorts before one with suffix when set and date match', () => {
    const a = makePrinting('FDN', '630', '2024-01-01')
    const b = makePrinting('FDN', '630p', '2024-01-01')
    expect(comparePrintings(a, b)).toBeLessThan(0)
  })

  test('sorts a mixed set of printings by date first, then set, then number', () => {
    const cards = [
      makePrinting('FDN', '294', '2020-01-01'), // older
      makePrinting('PLST', '10E-30', '2024-06-01'), // newest, alpha last
      makePrinting('CMM', '1', '2024-06-01'), // newest, alpha first
      makePrinting('FDN', '2', '2020-01-01'), // older, lower CN
      makePrinting('MOM', '12', '2023-03-01'), // middle date
    ]
    cards.sort(comparePrintings)
    const result = cards.map((c) => `${c.set}:${c.collector_number}`)
    // Newest first; same-date pairs broken by set code; same-date+set broken by CN
    expect(result).toEqual(['CMM:1', 'PLST:10E-30', 'MOM:12', 'FDN:2', 'FDN:294'])
  })
})

describe('preloadCache', () => {
  let logger: MemoryLogger
  let bulkSetSpy: ReturnType<typeof spyOn> | undefined

  beforeEach(() => {
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(() => {
    bulkSetSpy?.mockRestore()
    bulkSetSpy = undefined
    resetLogger()
  })

  test('fetches bulk data and writes the result through cardCache.bulkSet', async () => {
    const mockData = [
      {
        id: '1',
        name: 'Card A',
        set: 'set1',
        prices: {
          usd: null,
          usd_foil: null,
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
      },
      {
        id: '2',
        name: 'Card B',
        set: 'set1',
        prices: {
          usd: null,
          usd_foil: null,
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null,
        },
      },
    ]
    const mockMeta = {
      data: [
        {
          type: 'default_cards',
          jsonl_download_uri: 'https://example.com/bulk.jsonl.gz',
        },
      ],
    }

    const mockFetch = mock(async (url: unknown) => {
      if (url === 'https://api.scryfall.com/bulk-data') {
        return new Response(JSON.stringify(mockMeta))
      }
      return gzipJsonLinesResponse(mockData)
    })
    const client = new ScryfallClient({ fetch: mockFetch }, cardCache, new MemoryFileSystemClient())

    bulkSetSpy = spyOn(cardCache, 'bulkSet').mockResolvedValue(undefined)

    await client.preloadCache()

    expect(mockFetch).toHaveBeenCalled()
    expect(bulkSetSpy).toHaveBeenCalled()
    const args = bulkSetSpy.mock.calls[0]![0] as Record<string, ScryfallCard[]>
    expect(args['Card A']).toEqual([expect.objectContaining({ name: 'Card A', id: '1' })])
    expect(args['Card B']).toEqual([expect.objectContaining({ name: 'Card B', id: '2' })])
    expect(
      logger.entries.some(
        (entry) =>
          entry.level === 'info' &&
          typeof entry.args[0] === 'string' &&
          entry.args[0].includes('Fetching bulk data metadata'),
      ),
    ).toBeTrue()
  })
})

const makeGamesCard = (games: string[]): ScryfallCard => makeStubScryfallCard({ games })

describe('isToken', () => {
  test('returns true for token layout', () => {
    expect(isToken({ ...makeGamesCard([]), layout: 'token' })).toBe(true)
  })

  test('returns true for double_faced_token layout', () => {
    expect(isToken({ ...makeGamesCard([]), layout: 'double_faced_token' })).toBe(true)
  })

  test('returns true for cached card with Token in type_line (no layout field)', () => {
    expect(isToken({ ...makeGamesCard([]), type_line: 'Token Creature — Cat Soldier' })).toBe(true)
  })

  test('returns true for legendary token type_line', () => {
    expect(isToken({ ...makeGamesCard([]), type_line: 'Legendary Token Creature — Angel' })).toBe(
      true,
    )
  })

  test('returns false for normal card layout', () => {
    expect(isToken({ ...makeGamesCard([]), layout: 'normal' })).toBe(false)
  })

  test('returns false when layout is absent and type_line has no Token', () => {
    expect(isToken(makeGamesCard([]))).toBe(false)
  })

  test('returns false for card whose type_line contains Token only as substring', () => {
    // e.g. a hypothetical card named "Tokenmaker" would not match \bToken\b in type_line
    expect(isToken({ ...makeGamesCard([]), type_line: 'Artifact — Tokenmaker' })).toBe(false)
  })
})

describe('isArenaOnly', () => {
  test('returns true for arena-only card', () => {
    expect(isArenaOnly(makeGamesCard(['arena']))).toBe(true)
  })

  test('returns false for paper card', () => {
    expect(isArenaOnly(makeGamesCard(['paper']))).toBe(false)
  })

  test('returns false for paper+arena card', () => {
    expect(isArenaOnly(makeGamesCard(['paper', 'arena']))).toBe(false)
  })

  test('returns false for mtgo card', () => {
    expect(isArenaOnly(makeGamesCard(['mtgo']))).toBe(false)
  })

  test('returns false for empty games array', () => {
    expect(isArenaOnly(makeGamesCard([]))).toBe(false)
  })

  test('returns false for paper+mtgo+arena card', () => {
    expect(isArenaOnly(makeGamesCard(['paper', 'mtgo', 'arena']))).toBe(false)
  })
})

describe('getCardGames', () => {
  test('returns union of games across printings', () => {
    const paper = makeGamesCard(['paper'])
    const mtgo = makeGamesCard(['mtgo'])
    expect(getCardGames([paper, mtgo]).sort()).toEqual(['mtgo', 'paper'])
  })

  test('deduplicates games', () => {
    const a = makeGamesCard(['paper', 'arena'])
    const b = makeGamesCard(['paper', 'mtgo'])
    expect(getCardGames([a, b]).sort()).toEqual(['arena', 'mtgo', 'paper'])
  })

  test('returns empty for no printings', () => {
    expect(getCardGames([])).toEqual([])
  })

  test('returns empty for cards with empty games', () => {
    expect(getCardGames([makeGamesCard([])])).toEqual([])
  })
})

describe('computeRepresentativePrints — banned printings', () => {
  function makeCard(set: string, collectorNumber: string, usd: string): ScryfallCard {
    return makeStubScryfallCard({
      id: `${set}-${collectorNumber}`,
      set,
      collector_number: collectorNumber,
      prices: { usd, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    })
  }

  // Newest first. Without bans the representative is the newest within 1.5x median.
  const printings = [
    makeCard('sld', '123', '1.00'),
    makeCard('mh2', '42', '2.00'),
    makeCard('lea', '161', '3.00'),
  ]

  test('skips a banned printing and features the next eligible one', () => {
    const result = computeRepresentativePrints(printings, printings, ['usd'], new Set(['sld:123']))
    expect(result.usd?.representative?.id).toBe('mh2-42')
    // Cheapest is unaffected by the ban — it still reflects the true lowest price.
    expect(result.usd?.cheapest?.id).toBe('sld-123')
  })

  test('lowercases the card set code when matching normalized banned keys', () => {
    // Scryfall set codes are normally lowercase, but the match defensively
    // lowercases the card's set so an upper-cased set still matches a key.
    const upper = [makeCard('SLD', '123', '1.00'), makeCard('mh2', '42', '2.00')]
    const result = computeRepresentativePrints(upper, upper, ['usd'], new Set(['sld:123']))
    expect(result.usd?.representative?.id).toBe('mh2-42')
  })

  test('without bans the newest eligible printing is featured', () => {
    const result = computeRepresentativePrints(printings, printings, ['usd'])
    expect(result.usd?.representative?.id).toBe('sld-123')
  })
})
