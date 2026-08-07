import { describe, expect, test } from 'bun:test'
import {
  FEED_VERSION,
  parseCacheFeed,
  type CacheFeedDocument,
  type CacheFeedEntry,
} from '../../src/cache-feed/feed'

function makeEntry(overrides: Partial<CacheFeedEntry> = {}): CacheFeedEntry {
  return {
    kind: 'default-cards',
    fileName: 'default-cards-20260705.jsonl.gz',
    infoHash: 'a'.repeat(40),
    magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
    length: 1234,
    sha256: 'b'.repeat(64),
    scryfallUpdatedAt: '2026-07-05T09:00:00Z',
    publishedAt: '2026-07-05T10:00:00Z',
    fileUrl: 'https://feed.example/files/default-cards-20260705.jsonl.gz',
    torrentUrl: `https://feed.example/torrents/${'a'.repeat(40)}.torrent`,
    ...overrides,
  }
}

function makeFeed(entries: CacheFeedEntry[] = [makeEntry()]): CacheFeedDocument {
  return { version: FEED_VERSION, generatedAt: '2026-07-05T10:00:00Z', entries }
}

describe('parseCacheFeed', () => {
  test('round-trips a valid document', () => {
    const feed = makeFeed()
    expect(parseCacheFeed(JSON.parse(JSON.stringify(feed)))).toEqual(feed)
  })

  test('accepts an empty entries array', () => {
    expect(parseCacheFeed(makeFeed([]))).toEqual(makeFeed([]))
  })

  test.each([
    [null, 'expected an object'],
    [[], 'expected an object'],
    ['nope', 'expected an object'],
  ])('rejects non-object payload %p', (payload, expected) => {
    const result = parseCacheFeed(payload)
    expect(typeof result).toBe('string')
    expect(result as string).toContain(expected)
  })

  test('rejects an unsupported version', () => {
    const result = parseCacheFeed({ ...makeFeed(), version: 2 })
    expect(result as string).toContain('unsupported version 2')
  })

  test('rejects a missing generatedAt', () => {
    const { generatedAt: _generatedAt, ...rest } = makeFeed()
    expect(parseCacheFeed(rest) as string).toContain('generatedAt')
  })

  test('rejects a non-array entries field', () => {
    expect(parseCacheFeed({ ...makeFeed(), entries: {} }) as string).toContain('entries array')
  })

  test('rejects an entry with an unknown kind', () => {
    const result = parseCacheFeed(makeFeed([makeEntry({ kind: 'rulings' as never })]))
    expect(result as string).toContain("unknown kind 'rulings'")
  })

  test('accepts an all-cards entry — the every-language card bulk kind', () => {
    const feed = makeFeed([
      makeEntry(),
      makeEntry({ kind: 'all-cards', fileName: 'all-cards-20260705.jsonl.gz' }),
    ])
    expect(parseCacheFeed(JSON.parse(JSON.stringify(feed)))).toEqual(feed)
  })

  test.each([
    'fileName',
    'infoHash',
    'magnet',
    'sha256',
    'scryfallUpdatedAt',
    'publishedAt',
    'fileUrl',
    'torrentUrl',
  ] as const)('rejects an entry missing %s', (field) => {
    const entry = makeEntry({ [field]: '' })
    const result = parseCacheFeed(makeFeed([entry]))
    expect(result as string).toContain(`missing a string ${field}`)
  })

  test('rejects an entry with a non-positive length', () => {
    const result = parseCacheFeed(makeFeed([makeEntry({ length: 0 })]))
    expect(result as string).toContain('positive numeric length')
  })

  test('reports the index of the offending entry', () => {
    const result = parseCacheFeed(makeFeed([makeEntry(), makeEntry({ sha256: '' })]))
    expect(result as string).toContain('entry 1')
  })
})
