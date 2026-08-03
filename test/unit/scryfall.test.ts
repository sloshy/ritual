import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import {
  ScryfallClient,
  type ScryfallSymbol,
  classifyFetchCard,
  comparePrintings,
  computeRepresentativePrints,
  getCardGames,
  isArenaOnly,
  isArtSeries,
  isToken,
} from '../../src/scryfall'
import type { FileSystemClient } from '../../src/interfaces'
import {
  MockHttpClient,
  InMemoryCacheManager,
  MemoryLogger,
  makeScryfallCard,
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

/** A card with the given id and per-currency nonfoil prices, for representative-print tests. */
function makePricedCard(
  id: string,
  prices: Partial<{ usd: string; eur: string; tix: string }>,
): ScryfallCard {
  return makeScryfallCard({
    id,
    prices: { usd: prices.usd ?? null, eur: prices.eur ?? null, tix: prices.tix ?? null },
  })
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

      const result = await client.fetchSymbology({ force: true })

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

    test('network: false returns no symbols instead of downloading them', async () => {
      readFileMock.mockImplementationOnce(async () => {
        throw new Error('ENOENT: no such file or directory')
      })
      let fetches = 0
      mockHttp.mock('https://api.scryfall.com/symbology', () => {
        fetches++
        return new Response(JSON.stringify({ data: [] }))
      })

      const result = await client.fetchSymbology({ network: false })

      expect(result).toEqual([])
      expect(fetches).toBe(0)
      expect(writeFileMock).not.toHaveBeenCalled()
    })
  })

  describe('fetchCardData', () => {
    test('should fetch card from API and cache via CacheManager', async () => {
      const mockCard = makeScryfallCard({
        id: '123',
        cmc: 1,
        type_line: 'Instant',
        edhrec_rank: 999999,
        prices: { usd: '1.00' },
      })

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

  describe('fetchPrintingByCollectorNumber', () => {
    const PRINTING_URL = 'https://api.scryfall.com/cards/sta/90'

    test('lowercases the set code and caches the printing it verifies', async () => {
      const card = makeScryfallCard({ id: 'sta-90', name: 'Demonic Tutor', set: 'sta' })
      mockHttp.mock(PRINTING_URL, () => Response.json(card))

      const result = await client.fetchPrintingByCollectorNumber('STA', '90')

      expect(result?.id).toBe('sta-90')
      expect((await mockCache.get('Demonic Tutor'))?.map((c) => c.id)).toEqual(['sta-90'])
    })

    test('merges into an existing printing list instead of replacing it', async () => {
      const cached = makeScryfallCard({ id: 'cmm-150', name: 'Demonic Tutor', set: 'cmm' })
      await mockCache.set('Demonic Tutor', [cached])
      const card = makeScryfallCard({ id: 'sta-90', name: 'Demonic Tutor', set: 'sta' })
      mockHttp.mock(PRINTING_URL, () => Response.json(card))

      await client.fetchPrintingByCollectorNumber('sta', '90')

      // Overwriting here would shrink a full printing list down to one printing.
      expect((await mockCache.get('Demonic Tutor'))?.map((c) => c.id)).toEqual([
        'cmm-150',
        'sta-90',
      ])
    })

    test('a 404 means no such printing — the caller has to tell that from a failure', async () => {
      mockHttp.mock(PRINTING_URL, () => new Response('', { status: 404 }))

      expect(await client.fetchPrintingByCollectorNumber('sta', '90')).toBeNull()
    })

    test('a non-404 failure throws rather than reading as "no such printing"', async () => {
      mockHttp.mock(PRINTING_URL, () => new Response('', { status: 503 }))

      expect(client.fetchPrintingByCollectorNumber('sta', '90')).rejects.toThrow()
    })

    test('an excluded printing (art series) is refused', async () => {
      const art = makeScryfallCard({
        id: 'art-1',
        name: 'Demonic Tutor',
        set: 'asta',
        layout: 'art_series',
      })
      mockHttp.mock(PRINTING_URL, () => Response.json(art))

      expect(await client.fetchPrintingByCollectorNumber('sta', '90')).toBeNull()
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

      if (result === null || 'error' in result) throw new Error('expected a card result')
      expect(result.set).toBe('lea')
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

    test('should surface a fetch error with Scryfall details on a non-404 HTTP failure', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/named?exact=Lightning+Bolt',
        () =>
          new Response(JSON.stringify({ object: 'error', details: 'Scryfall is on fire' }), {
            status: 503,
          }),
      )

      const result = await client.fetchNamedCard('Lightning Bolt')

      expect(result).toEqual({ error: 'Scryfall is on fire' })
    })

    test('should fall back to the HTTP status when the error body has no details', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/named?exact=Lightning+Bolt',
        () => new Response('not json', { status: 500, statusText: 'Internal Server Error' }),
      )

      const result = await client.fetchNamedCard('Lightning Bolt')

      expect(result).toEqual({ error: '500 Internal Server Error' })
    })

    test('should surface a fetch error when the request throws', async () => {
      mockHttp.mock('https://api.scryfall.com/cards/named?exact=Lightning+Bolt', () => {
        throw new Error('network down')
      })

      const result = await client.fetchNamedCard('Lightning Bolt')

      expect(result).toEqual({ error: 'network down' })
    })

    test('should pass an abort signal and surface a timeout as a clear fetch error', async () => {
      let receivedSignal: AbortSignal | null | undefined
      mockHttp.mock('https://api.scryfall.com/cards/named?exact=Lightning+Bolt', (init) => {
        receivedSignal = init?.signal
        // What `fetch` rejects with once AbortSignal.timeout fires.
        throw new DOMException('The operation timed out.', 'TimeoutError')
      })

      const result = await client.fetchNamedCard('Lightning Bolt')

      expect(receivedSignal).toBeInstanceOf(AbortSignal)
      if (result === null || !('error' in result)) throw new Error('expected a fetch error')
      expect(result.error).toContain('timed out after 15 seconds')
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

    test('should return null on 404 (no cards match the filter)', async () => {
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

    test('should surface a fetch error on a non-404 HTTP failure', async () => {
      mockHttp.mock(
        'https://api.scryfall.com/cards/random',
        () =>
          new Response(JSON.stringify({ object: 'error', details: 'Rate limited' }), {
            status: 429,
          }),
      )

      const result = await client.fetchRandomCard()

      expect(result).toEqual({ error: 'Rate limited' })
    })

    test('should surface a fetch error when the request throws', async () => {
      mockHttp.mock('https://api.scryfall.com/cards/random', () => {
        throw new Error('connection reset')
      })

      const result = await client.fetchRandomCard()

      expect(result).toEqual({ error: 'connection reset' })
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
    function searchUrl(name: string) {
      return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${name}"`) + '+unique%3Aprints'}&order=released`
    }

    test('returns null representative and cheapest on API error', async () => {
      mockHttp.mock(searchUrl('Error Card'), () => {
        return new Response('Not Found', { status: 404 })
      })

      const result = await client.fetchRepresentativePrints('Error Card', ['usd', 'tix'])

      expect(result.usd?.representative).toBeNull()
      expect(result.tix?.representative).toBeNull()
    })

    test('fetches all pages and returns cheapest from all pages', async () => {
      // Page 1: card 'a' (usd=2.00) — representative selected from here
      // Page 2: card 'b' (usd=0.50) — cheaper, becomes cheapest
      const page2Url = 'https://api.scryfall.com/cards/search?page=2'

      mockHttp.mock(searchUrl('Paginated Card'), () => {
        return new Response(
          JSON.stringify({
            data: [makePricedCard('a', { usd: '2.00' })],
            has_more: true,
            next_page: page2Url,
          }),
        )
      })

      mockHttp.mock(page2Url, () => {
        return new Response(
          JSON.stringify({
            data: [makePricedCard('b', { usd: '0.50' })],
            has_more: false,
          }),
        )
      })

      const result = await client.fetchRepresentativePrints('Paginated Card', ['usd'])

      expect(result.usd?.representative?.id).toBe('a')
      expect(result.usd?.cheapest?.id).toBe('b')
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

describe('classifyFetchCard', () => {
  test('classifies null as not-found', () => {
    expect(classifyFetchCard(null)).toEqual({ kind: 'not-found' })
  })

  test('classifies a fetch error as failed with its message', () => {
    expect(classifyFetchCard({ error: 'Scryfall is down' })).toEqual({
      kind: 'failed',
      message: 'Scryfall is down',
    })
  })

  test('classifies a card as the card outcome', () => {
    const card = makeScryfallCard({ name: 'Lightning Bolt' })
    expect(classifyFetchCard(card)).toEqual({ kind: 'card', card })
  })
})

describe('comparePrintings', () => {
  function makePrinting(set: string, collectorNumber: string, releasedAt?: string): ScryfallCard {
    return makeScryfallCard({
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

const makeGamesCard = (games: string[]): ScryfallCard => makeScryfallCard({ games })

describe('isToken', () => {
  type IsTokenCase = { label: string; card: ScryfallCard; expected: boolean }
  const cases: IsTokenCase[] = [
    { label: 'token layout', card: makeScryfallCard({ layout: 'token' }), expected: true },
    {
      label: 'double_faced_token layout',
      card: makeScryfallCard({ layout: 'double_faced_token' }),
      expected: true,
    },
    {
      label: 'cached card with Token in type_line (no layout field)',
      card: makeScryfallCard({ type_line: 'Token Creature — Cat Soldier' }),
      expected: true,
    },
    { label: 'normal card layout', card: makeScryfallCard({ layout: 'normal' }), expected: false },
    {
      label: 'layout absent and type_line has no Token',
      card: makeScryfallCard(),
      expected: false,
    },
    {
      // e.g. a hypothetical card named "Tokenmaker" would not match \bToken\b in type_line
      label: 'type_line contains Token only as substring',
      card: makeScryfallCard({ type_line: 'Artifact — Tokenmaker' }),
      expected: false,
    },
  ]

  test.each(cases)('$label → $expected', ({ card, expected }) => {
    expect(isToken(card)).toBe(expected)
  })
})

describe('isArtSeries', () => {
  type IsArtSeriesCase = { label: string; card: ScryfallCard; expected: boolean }
  const cases: IsArtSeriesCase[] = [
    {
      label: 'art_series layout',
      card: makeScryfallCard({ layout: 'art_series', type_line: 'Card // Card', set: 'aznr' }),
      expected: true,
    },
    { label: 'normal card layout', card: makeScryfallCard({ layout: 'normal' }), expected: false },
    {
      // The set-code shape alone must not decide it — real cards live in 4-letter sets too.
      label: 'normal card in an a-prefixed set',
      card: makeScryfallCard({ layout: 'normal', set: 'aznr' }),
      expected: false,
    },
    { label: 'layout absent', card: makeScryfallCard(), expected: false },
  ]

  test.each(cases)('$label → $expected', ({ card, expected }) => {
    expect(isArtSeries(card)).toBe(expected)
  })
})

describe('isArenaOnly', () => {
  type IsArenaOnlyCase = { games: string[]; expected: boolean }
  const cases: IsArenaOnlyCase[] = [
    { games: ['arena'], expected: true },
    { games: ['paper'], expected: false },
    { games: ['paper', 'arena'], expected: false },
    { games: ['mtgo'], expected: false },
    { games: [], expected: false },
  ]

  test.each(cases)('games=$games → $expected', ({ games, expected }) => {
    expect(isArenaOnly(makeGamesCard(games))).toBe(expected)
  })
})

describe('getCardGames', () => {
  type GetCardGamesCase = { label: string; printings: string[][]; expected: string[] }
  const cases: GetCardGamesCase[] = [
    {
      label: 'returns union of games across printings',
      printings: [['paper'], ['mtgo']],
      expected: ['mtgo', 'paper'],
    },
    {
      label: 'deduplicates games',
      printings: [
        ['paper', 'arena'],
        ['paper', 'mtgo'],
      ],
      expected: ['arena', 'mtgo', 'paper'],
    },
    { label: 'returns empty for no printings', printings: [], expected: [] },
    { label: 'returns empty for cards with empty games', printings: [[]], expected: [] },
  ]

  test.each(cases)('$label', ({ printings, expected }) => {
    expect(getCardGames(printings.map(makeGamesCard)).sort()).toEqual(expected)
  })
})

describe('computeRepresentativePrints — price selection', () => {
  test('picks representative (latest within 1.5x median) for each currency', () => {
    // Printings ordered newest first (index 0 = newest)
    // USD prices: 1.00, 2.00, 3.00 → median 2.00, threshold 3.00 → first card (1.00) chosen
    // TIX prices: only card 'c' has tix → only 1 candidate, median = 1.50 → chosen
    const cards = [
      makePricedCard('a', { usd: '1.00', eur: '0.80' }),
      makePricedCard('b', { usd: '2.00', eur: '1.60' }),
      makePricedCard('c', { usd: '3.00', eur: '2.40', tix: '1.50' }),
    ]

    const result = computeRepresentativePrints(cards, cards, ['usd', 'eur', 'tix'])

    // USD: median of [1,2,3]=2, threshold=3; first card 1.00 ≤ 3 → representative='a', cheapest='a'
    expect(result.usd?.representative?.id).toBe('a')
    expect(result.usd?.cheapest?.id).toBe('a')
    // EUR: median of [0.80,1.60,2.40]=1.60, threshold=2.40; first card 0.80 ≤ 2.40 → 'a'
    expect(result.eur?.representative?.id).toBe('a')
    // TIX: only one candidate (card 'c', 1.50), median=1.50, threshold=2.25; chosen
    expect(result.tix?.representative?.id).toBe('c')
    expect(result.tix?.cheapest?.id).toBe('c')
  })

  test('skips the latest card when its price exceeds 1.5x median', () => {
    // USD prices: 10.00, 2.00, 2.00 → median 2.00, threshold 3.00
    // card 'a' (10.00) exceeds threshold, so representative picks 'b' (2.00)
    const cards = [
      makePricedCard('a', { usd: '10.00' }),
      makePricedCard('b', { usd: '2.00' }),
      makePricedCard('c', { usd: '2.00' }),
    ]

    const result = computeRepresentativePrints(cards, cards, ['usd'])

    expect(result.usd?.representative?.id).toBe('b')
    expect(result.usd?.cheapest?.id).toBe('b')
  })

  test('considers at most 5 candidates per currency for representative selection', () => {
    // 6 cards with tix prices; only the first 5 feed the median.
    // Capped: [100,100,100,1,1] → median 100, threshold 150 → newest card 'a' (100) qualifies.
    // Uncapped, 'f' would drag the median to 50.5 (threshold 75.75), pushing the
    // representative down to 'd' — so asserting 'a' pins the 5-candidate cap.
    const cards = [
      makePricedCard('a', { tix: '100.00' }),
      makePricedCard('b', { tix: '100.00' }),
      makePricedCard('c', { tix: '100.00' }),
      makePricedCard('d', { tix: '1.00' }),
      makePricedCard('e', { tix: '1.00' }),
      makePricedCard('f', { tix: '1.00' }),
    ]

    const result = computeRepresentativePrints(cards, cards, ['tix'])

    expect(result.tix?.representative?.id).toBe('a')
    // Cheapest scans ALL printings, uncapped.
    expect(result.tix?.cheapest?.id).toBe('d')
  })

  test('only computes requested currencies', () => {
    const cards = [makePricedCard('a', { usd: '1.00', eur: '0.90', tix: '0.10' })]

    const result = computeRepresentativePrints(cards, cards, ['usd'])

    expect(result.usd?.representative?.id).toBe('a')
    expect(result.eur).toBeUndefined()
    expect(result.tix).toBeUndefined()
  })

  test('returns null representative and cheapest when no cards have prices', () => {
    const cards = [makePricedCard('a', {}), makePricedCard('b', {})]

    const result = computeRepresentativePrints(cards, cards, ['usd', 'tix'])

    expect(result.usd?.representative).toBeNull()
    expect(result.usd?.cheapest).toBeNull()
    expect(result.tix?.representative).toBeNull()
    expect(result.tix?.cheapest).toBeNull()
  })
})

describe('computeRepresentativePrints — banned printings', () => {
  function makeBannablePrinting(set: string, collectorNumber: string, usd: string): ScryfallCard {
    return makeScryfallCard({
      id: `${set}-${collectorNumber}`,
      set,
      collector_number: collectorNumber,
      prices: { usd },
    })
  }

  // Newest first. Without bans the representative is the newest within 1.5x median.
  const printings = [
    makeBannablePrinting('sld', '123', '1.00'),
    makeBannablePrinting('mh2', '42', '2.00'),
    makeBannablePrinting('lea', '161', '3.00'),
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
    const upper = [
      makeBannablePrinting('SLD', '123', '1.00'),
      makeBannablePrinting('mh2', '42', '2.00'),
    ]
    const result = computeRepresentativePrints(upper, upper, ['usd'], new Set(['sld:123']))
    expect(result.usd?.representative?.id).toBe('mh2-42')
  })

  test('without bans the newest eligible printing is featured', () => {
    const result = computeRepresentativePrints(printings, printings, ['usd'])
    expect(result.usd?.representative?.id).toBe('sld-123')
  })
})
