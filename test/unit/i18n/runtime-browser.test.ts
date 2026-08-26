import { afterEach, describe, expect, test } from 'bun:test'
import { localeTag } from '../../../src/i18n/locale-tag'
import {
  coerceCatalog,
  DEFAULT_LOCALE,
  ensureLocaleLoaded,
  getDictionary,
  resetI18nRuntime,
  resolveBrowserLocale,
} from '../../../src/i18n/runtime'

/**
 * Browser-side delivery: the precedence chain a page resolves its locale
 * through, and the one same-origin fetch that backs it. The CLI's chain lives
 * in `src/cli/locale.ts` and is tested separately — the two share the
 * runtime but not their tiers.
 */

const realFetch = globalThis.fetch

/** The URL a stubbed `fetch` was called with, whatever form the argument took. */
function requestedUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Replace the global `fetch` for one test; `afterEach` puts the real one back. */
function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(handler(requestedUrl(input)))) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  resetI18nRuntime()
})

describe('resolveBrowserLocale', () => {
  const available = ['en', 'de-AT', 'ja'].map(localeTag)

  test('the test seam beats every other tier', () => {
    expect(
      resolveBrowserLocale({
        override: 'ja',
        query: 'de-AT',
        stored: 'de-AT',
        preferred: ['de-AT'],
        configured: 'de-AT',
        available,
      }),
    ).toBe(localeTag('ja'))
  })

  test('a ?locale= query beats a stored choice', () => {
    expect(
      resolveBrowserLocale({ query: 'ja', stored: 'de-AT', configured: 'de-AT', available }),
    ).toBe(localeTag('ja'))
  })

  test('a stored choice beats the browser preference list', () => {
    expect(resolveBrowserLocale({ stored: 'ja', preferred: ['de-AT'], available })).toBe(
      localeTag('ja'),
    )
  })

  test('the browser preference list beats the site default', () => {
    expect(resolveBrowserLocale({ preferred: ['ja'], configured: 'de-AT', available })).toBe(
      localeTag('ja'),
    )
  })

  test('a browser preference is negotiated down to its language', () => {
    // `de-DE` is not published; `de-AT` is the same language and is.
    expect(resolveBrowserLocale({ preferred: ['de-DE'], configured: 'ja', available })).toBe(
      localeTag('de-AT'),
    )
  })

  test('an English preference still outranks a site baked in another language', () => {
    // negotiateLocale terminates at English either way, so this is the case
    // that distinguishes a genuine match from a fallthrough.
    expect(resolveBrowserLocale({ preferred: ['en-GB'], configured: 'ja', available })).toBe(
      localeTag('en'),
    )
  })

  test('an unmatched browser preference falls through to the site default', () => {
    expect(resolveBrowserLocale({ preferred: ['fr-CA'], configured: 'ja', available })).toBe(
      localeTag('ja'),
    )
  })

  test('the site default is honored verbatim, and English is the floor', () => {
    expect(resolveBrowserLocale({ configured: 'ja', available })).toBe(localeTag('ja'))
    expect(resolveBrowserLocale({ available })).toBe(DEFAULT_LOCALE)
  })

  test('a malformed or blank value at any tier is skipped, not fatal', () => {
    expect(
      resolveBrowserLocale({ override: '  ', query: 'not a tag', stored: 'ja', available }),
    ).toBe(localeTag('ja'))
  })
})

describe('coerceCatalog', () => {
  test('keeps well-formed entries and drops the rest', () => {
    const catalog = coerceCatalog({
      plain: 'text',
      plural: { $plural: 'count', other: '{count} x' },
      select: { $select: 'kind', deck: 'Deck' },
      numeric: 3,
      nested: { $select: 'kind', deck: { $plural: 'count', other: 'x' } },
      undiscriminated: { one: 'x' },
      list: ['a'],
    })
    expect(Object.keys(catalog).sort()).toEqual(['plain', 'plural', 'select'])
  })

  test('a document that is not an object is an empty catalog, never a throw', () => {
    expect(coerceCatalog(null)).toEqual({})
    expect(coerceCatalog(['a'])).toEqual({})
    expect(coerceCatalog('nope')).toEqual({})
  })
})

describe('ensureLocaleLoaded', () => {
  test('never fetches English — it is inline in the bundle', async () => {
    let called = false
    stubFetch(() => {
      called = true
      return new Response('{}')
    })
    expect(await ensureLocaleLoaded(localeTag('en'))).toBe(localeTag('en'))
    expect(called).toBe(false)
  })

  test('fetches a dictionary once, same-origin, and registers it', async () => {
    const urls: string[] = []
    stubFetch((url) => {
      urls.push(url)
      return new Response(JSON.stringify({ 'site.toolbar.sortBy': 'Sortieren nach' }))
    })

    expect(await ensureLocaleLoaded(localeTag('de-AT'))).toBe(localeTag('de-AT'))
    expect(urls).toEqual(['locales/de-AT.json'])
    expect(getDictionary(localeTag('de-AT'))?.['site.toolbar.sortBy']).toBe('Sortieren nach')

    // Already loaded: no second request.
    expect(await ensureLocaleLoaded(localeTag('de-AT'))).toBe(localeTag('de-AT'))
    expect(urls).toHaveLength(1)
  })

  test('degrades to English when the dictionary cannot be fetched', async () => {
    stubFetch(() => new Response('nope', { status: 404 }))
    expect(await ensureLocaleLoaded(localeTag('de-AT'))).toBe(DEFAULT_LOCALE)
    expect(getDictionary(localeTag('de-AT'))).toBeUndefined()
  })

  test('an aborted fetch degrades quietly, with no warning', async () => {
    const warn = console.warn
    const warnings: unknown[] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      stubFetch(() => {
        throw new DOMException('aborted', 'AbortError')
      })
      const controller = new AbortController()
      expect(await ensureLocaleLoaded(localeTag('de-AT'), { signal: controller.signal })).toBe(
        DEFAULT_LOCALE,
      )
      // The one failure path that deliberately says nothing: an abort is the app
      // navigating away, not a broken deployment.
      expect(warnings).toEqual([])
    } finally {
      console.warn = warn
    }
  })

  test('passes an AbortSignal through to fetch', async () => {
    let seen: AbortSignal | undefined
    const realFetch = globalThis.fetch
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined
      return Promise.resolve(new Response('{}'))
    }) as unknown as typeof fetch
    try {
      const controller = new AbortController()
      await ensureLocaleLoaded(localeTag('de-AT'), { signal: controller.signal })
      expect(seen).toBe(controller.signal)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  test('a basePath prefixes the request, for a site not served from the root', async () => {
    const urls: string[] = []
    stubFetch((url) => {
      urls.push(url)
      return new Response('{}')
    })
    await ensureLocaleLoaded(localeTag('ja'), { basePath: '/site/' })
    expect(urls).toEqual(['/site/locales/ja.json'])
  })
})
