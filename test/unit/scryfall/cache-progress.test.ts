import { describe, expect, test, beforeEach } from 'bun:test'
import { ScryfallClient } from '../../../src/scryfall'
import type { CacheRefreshEvent } from '../../../src/scryfall'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { tIn } from '../../../src/i18n/t'
import { renderSyncMessage, SyncMessageError } from '../../../src/sync/message'
import { keyedMessage } from '../../helpers/api-message'
import {
  expectLocaleInForce,
  foreignLocales,
  withSyntheticLocaleAsync,
} from '../../helpers/sync-text'
import {
  ART_TAGS_URI,
  BULK_META_URL,
  DEFAULT_CARDS_URI,
  ORACLE_TAGS_URI,
  MockHttpClient,
  InMemoryCacheManager,
  MemoryFileSystemClient,
  MemoryLogger,
  bulkCard,
  bulkMetaBody,
  gzipJsonLines,
  gzipJsonLinesResponse,
  setLogger,
} from '../../test-utils'

describe('preloadCache progress reporting', () => {
  let logger: MemoryLogger
  let http: MockHttpClient
  let cache: InMemoryCacheManager<ScryfallCard[]>
  let client: ScryfallClient

  beforeEach(() => {
    logger = new MemoryLogger()
    setLogger(logger)
    http = new MockHttpClient()
    cache = new InMemoryCacheManager<ScryfallCard[]>(0)
    http.mock(BULK_META_URL, () => Response.json(bulkMetaBody()))
    http.mock(ORACLE_TAGS_URI, () => gzipJsonLinesResponse([]))
    http.mock(ART_TAGS_URI, () => gzipJsonLinesResponse([]))
    http.mock(DEFAULT_CARDS_URI, () => gzipJsonLinesResponse([bulkCard()]))
    client = new ScryfallClient(http, cache, new MemoryFileSystemClient())
  })

  test('reports the refresh stages in order', async () => {
    const events: CacheRefreshEvent[] = []
    await client.preloadCache({ onProgress: (event) => events.push(event) })

    const stages = events.map((e) => e.stage)
    expect(stages[0]).toBe('metadata')
    expect(stages[1]).toBe('tags')
    expect(stages).toContain('download')
    expect(stages.indexOf('save')).toBeGreaterThan(stages.indexOf('download'))
    expect(stages.at(-1)).toBe('done')
    // Every report carries text a client can render.
    expect(events.every((e) => e.message.length > 0)).toBeTrue()
  })

  test('carries a download percentage when the compressed size is known', async () => {
    const events: CacheRefreshEvent[] = []
    await client.preloadCache({ onProgress: (event) => events.push(event) })

    // `gzipJsonLinesResponse` sets content-length, so the ingest knows the scale.
    const percentages = events
      .filter((e) => e.stage === 'download' && e.percentage !== undefined)
      .map((e) => e.percentage)
    expect(percentages.length).toBeGreaterThan(0)
    expect(percentages.at(-1)).toBe(100)
  })

  test('reports how much arrived, with no percentage, when the size is unknown', async () => {
    // A chunked body: no content-length, so no scale to report against.
    const bytes = gzipJsonLines([bulkCard()])
    http.mock(
      DEFAULT_CARDS_URI,
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes)
              controller.close()
            },
          }),
        ),
    )
    const events: CacheRefreshEvent[] = []
    await client.preloadCache({ onProgress: (event) => events.push(event) })

    const downloads = events.filter((event) => event.stage === 'download')
    // No "Download size" line either: there is no size to state.
    expect(downloads).toEqual([
      {
        stage: 'download',
        message: `Processing: ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MiB`,
        messageKey: 'domain.cache.refresh.processingUnsized',
        messageParams: { received: { sizeBytes: bytes.byteLength } },
      },
    ])
  })

  test.each(foreignLocales())(
    'reports each step in English plus its key, its sizes nested, while the console reads $tag',
    async ({ tag, catalog }) => {
      const events: CacheRefreshEvent[] = []
      // Each rendered while the locale is in force: the runtime drops the
      // synthetic dictionary on the way out.
      const local = await withSyntheticLocaleAsync(tag, catalog, async (locale) => {
        expectLocaleInForce(locale)
        await client.preloadCache({ onProgress: (event) => events.push(event) })
        expectLocaleInForce(locale)
        const last = events.findLast((event) => event.stage === 'download')
        return {
          line: last === undefined ? '' : renderSyncMessage(last, locale),
          processed: tIn(locale, 'cli.scryfall.processedCards', { count: 1 }),
        }
      })

      // Every report: a known key, and English that is exactly what it renders to.
      expect(events.length).toBeGreaterThan(0)
      for (const event of events) keyedMessage(event)

      // The download's size rides as a size param, not as a pre-rendered figure,
      // so the admin page can print it with the reader's decimal mark.
      const totalBytes = gzipJsonLines([bulkCard()]).byteLength
      const mib = (totalBytes / 1024 / 1024).toFixed(2)
      const last = events.findLast((event) => event.stage === 'download')
      expect(last).toEqual({
        stage: 'download',
        percentage: 100,
        message: `Processing: 100% (${mib}/${mib} MiB)`,
        messageKey: 'domain.cache.refresh.processing',
        messageParams: {
          percentage: 100,
          received: { sizeBytes: totalBytes },
          total: { sizeBytes: totalBytes },
        },
      })

      // The console, meanwhile, speaks the process's own language: the same
      // line rendered in it (the pseudo-locale rewords it, German changes its
      // decimal mark), and the CLI's own lines from the catalog. A memory
      // logger is no terminal, so the progress line is a whole line, not a redraw.
      const lines = logger.entries.map((entry) => String(entry.args[0]))
      expect(local.line).not.toBe(last?.message)
      expect(lines).toContain(`${local.line}\n`)
      expect(lines).toContain(local.processed)
    },
  )

  // These two are the phase's headline change: `preloadCache` used to swallow a
  // failed refresh and report success. The `await` is load-bearing — without it
  // the assertion is a floating promise and the test passes however the call
  // settles — and so is the message matcher, which is what keeps an unrelated
  // throw (a missing stub, say) from satisfying "it rejected".
  test('rejects when the bulk metadata fetch fails instead of reporting success', async () => {
    http.mock(BULK_META_URL, () => new Response('nope', { status: 500 }))

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.preloadCache()).rejects.toThrow('Failed to fetch bulk manifest: 500')
  })

  test('rejects when the card bulk download fails', async () => {
    http.mock(DEFAULT_CARDS_URI, () => new Response('nope', { status: 500 }))

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.preloadCache()).rejects.toThrow('Failed to fetch bulk data: 500')
  })

  test('a bulk that is not JSONL fails the refresh with the line, English plus its key', async () => {
    http.mock(DEFAULT_CARDS_URI, () => new Response(Bun.gzipSync('{"name": "Sol Ring"\n')))
    const error = await client.preloadCache().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SyncMessageError)
    expect((error as SyncMessageError).syncMessage).toEqual({
      message: 'Invalid JSONL: line 1 is not valid JSON',
      messageKey: 'domain.cache.refresh.invalidJsonLine',
      messageParams: { line: 1 },
    })
  })
})
