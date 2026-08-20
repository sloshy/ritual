import { describe, expect, test } from 'bun:test'
import {
  createAdminListShareSource,
  type AdminJsonFetcher,
} from '../../../src/admin/site/share-source'

/** A fetcher returning a fixed body, recording the URLs it was asked for. */
type FixedFetcher = { fetcher: AdminJsonFetcher; urls: string[] }

function fixedFetcher(body: unknown): FixedFetcher {
  const urls: string[] = []
  return {
    urls,
    fetcher: (url) => {
      urls.push(url)
      return Promise.resolve(body)
    },
  }
}

describe('createAdminListShareSource', () => {
  test('the deck branch flattens sections and builds keys from the load body', async () => {
    const { fetcher, urls } = fixedFetcher({
      success: true,
      deck: {
        sections: [
          {
            name: 'Mainboard',
            cards: [{ name: 'Lightning Bolt', set: 'LEA', collectorNumber: '161' }],
          },
          { name: 'Sideboard', cards: [{ name: 'Mystery Card' }] },
        ],
      },
      cards: {},
    })
    const source = createAdminListShareSource(fetcher)
    const keys = await source.load({ type: 'deck', slug: 'my deck' })
    expect(urls).toEqual(['/api/deck/my%20deck'])
    expect(keys).not.toBeNull()
    expect([...(keys?.printings ?? [])]).toEqual(['lea:161'])
    expect([...(keys?.names ?? [])].sort()).toEqual(['lightning bolt', 'mystery card'])
  })

  test.each(['collection', 'wanted'] as const)(
    'the flat-list branch reads entries directly (%s)',
    async (type) => {
      const { fetcher, urls } = fixedFetcher({
        success: true,
        entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263' }],
        cards: {},
      })
      const source = createAdminListShareSource(fetcher)
      const keys = await source.load({ type, slug: 'binder' })
      expect(urls).toEqual([`/api/${type}/binder`])
      expect([...(keys?.printings ?? [])]).toEqual(['c21:263'])
      expect([...(keys?.names ?? [])]).toEqual(['sol ring'])
    },
  )

  test('an error body (success: false) yields null', async () => {
    const { fetcher } = fixedFetcher({ success: false, message: 'not found' })
    const source = createAdminListShareSource(fetcher)
    expect(await source.load({ type: 'deck', slug: 'gone' })).toBeNull()
    expect(await source.load({ type: 'collection', slug: 'gone' })).toBeNull()
  })

  test('a throwing fetcher yields null instead of a rejection', async () => {
    const source = createAdminListShareSource(() => Promise.reject(new Error('offline')))
    expect(await source.load({ type: 'wanted', slug: 'wish' })).toBeNull()
  })
})
