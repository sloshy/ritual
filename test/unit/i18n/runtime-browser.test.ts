import { afterEach, describe, expect, test } from 'bun:test'
import { localeTag } from '../../../src/i18n/locale-tag-message'
import { coerceCatalog } from '../../../src/i18n/catalog'
import { createLocaleApplier, ensureLocaleLoaded } from '../../../src/i18n/dictionary-fetch'
import {
  DEFAULT_LOCALE,
  getDictionary,
  resetI18nRuntime,
  resolveBrowserLocale,
} from '../../../src/i18n/runtime'
import { captureConsole } from '../../helpers/capture'
import { withSyntheticLocaleAsync } from '../../helpers/sync-text'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'

/**
 * Browser-side delivery: the precedence chain a page resolves its locale
 * through, and the one same-origin fetch that backs it. The CLI's chain lives
 * in `src/cli/locale.ts` and is tested separately — the two share the
 * runtime but not their tiers.
 */

let stubbed: StubbedFetch | undefined

/** Replace the global `fetch` for one test; `afterEach` puts the real one back. */
function stubLocaleFetch(handler: (url: string) => Response): StubbedFetch {
  stubbed?.restore()
  stubbed = stubFetch({ '': (request) => handler(request.url) })
  return stubbed
}

afterEach(() => {
  stubbed?.restore()
  stubbed = undefined
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
    stubLocaleFetch(() => {
      called = true
      return new Response('{}')
    })
    expect(await ensureLocaleLoaded(localeTag('en'))).toBe(localeTag('en'))
    expect(called).toBe(false)
  })

  test('fetches a dictionary once, same-origin, and registers it', async () => {
    const urls: string[] = []
    stubLocaleFetch((url) => {
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

  test('degrades to English when the dictionary cannot be fetched, and says why', async () => {
    const { lines } = await captureConsole(['warn'], async () => {
      stubLocaleFetch(() => new Response('nope', { status: 404 }))
      expect(await ensureLocaleLoaded(localeTag('de-AT'))).toBe(DEFAULT_LOCALE)
    })
    expect(getDictionary(localeTag('de-AT'))).toBeUndefined()
    expect(lines.warn).toEqual([
      'Could not load the de-AT dictionary from locales/de-AT.json; using English. HTTP 404',
    ])
  })

  test('the warning is worded in the UI language already in force', async () => {
    // The language being switched *away from* — the one the reader can read.
    const { lines } = await captureConsole(['warn'], async () => {
      await withSyntheticLocaleAsync(
        'xx',
        {
          'errors.i18n.dictionary.loadFailed': 'KEIN {locale} VON {url}',
          'errors.i18n.dictionary.httpStatus': 'STATUS {status}',
        },
        async () => {
          stubLocaleFetch(() => new Response('nope', { status: 503 }))
          expect(await ensureLocaleLoaded(localeTag('ja'))).toBe(DEFAULT_LOCALE)
        },
      )
    })
    expect(lines.warn).toEqual(['KEIN ja VON locales/ja.json STATUS 503'])
  })

  test('an aborted fetch degrades quietly, with no warning', async () => {
    const { lines } = await captureConsole(['warn'], async () => {
      stubLocaleFetch(() => {
        throw new DOMException('aborted', 'AbortError')
      })
      const controller = new AbortController()
      expect(await ensureLocaleLoaded(localeTag('de-AT'), { signal: controller.signal })).toBe(
        DEFAULT_LOCALE,
      )
    })
    // The one failure path that deliberately says nothing: an abort is the app
    // navigating away, not a broken deployment.
    expect(lines.warn).toEqual([])
  })

  test('passes an AbortSignal through to fetch', async () => {
    const stub = stubLocaleFetch(() => new Response('{}'))
    const controller = new AbortController()
    await ensureLocaleLoaded(localeTag('de-AT'), { signal: controller.signal })
    expect(stub.sent[0]?.init?.signal).toBe(controller.signal)
  })

  test('a basePath prefixes the request, for a site not served from the root', async () => {
    const urls: string[] = []
    stubLocaleFetch((url) => {
      urls.push(url)
      return new Response('{}')
    })
    await ensureLocaleLoaded(localeTag('ja'), { basePath: '/site/' })
    expect(urls).toEqual(['/site/locales/ja.json'])
  })
})

describe('ensureLocaleLoaded — unreadable replies', () => {
  test('a reply that is not JSON degrades to English and says why', async () => {
    const { lines } = await captureConsole(['warn'], async () => {
      stubLocaleFetch(() => new Response('<html>not a dictionary</html>'))
      expect(await ensureLocaleLoaded(localeTag('de-AT'))).toBe(DEFAULT_LOCALE)
    })
    expect(getDictionary(localeTag('de-AT'))).toBeUndefined()
    expect(lines.warn).toHaveLength(1)
    expect(lines.warn[0]).toStartWith(
      'Could not load the de-AT dictionary from locales/de-AT.json; using English. SyntaxError',
    )
  })
})

/**
 * A `fetch` whose replies the test settles by hand, in any order — what two
 * dictionary requests racing over a real network look like.
 */
function deferredFetch(): { settle: (url: string, body: unknown) => void; restore: () => void } {
  const original = globalThis.fetch
  const pending = new Map<string, (response: Response) => void>()
  globalThis.fetch = ((input: string | URL | Request) =>
    new Promise<Response>((resolve) => {
      pending.set(input instanceof Request ? input.url : input.toString(), resolve)
    })) as typeof fetch
  return {
    settle: (url, body) => pending.get(url)?.(new Response(JSON.stringify(body))),
    restore: () => {
      globalThis.fetch = original
    },
  }
}

describe('createLocaleApplier', () => {
  test('a call a later one overtook applies nothing, even when its fetch settles last', async () => {
    const network = deferredFetch()
    try {
      const applied: string[] = []
      const apply = createLocaleApplier((usable) => applied.push(usable))

      // The reader picks German, then Japanese; German's dictionary arrives last.
      const first = apply(localeTag('de'))
      const second = apply(localeTag('ja'))
      await Bun.sleep(0)
      network.settle('locales/ja.json', { 'ui.dialog.cancel': 'キャンセル' })
      expect(await second).toBe(localeTag('ja'))
      network.settle('locales/de.json', { 'ui.dialog.cancel': 'Abbrechen' })
      expect(await first).toBeUndefined()

      expect(applied).toEqual([localeTag('ja')])
    } finally {
      network.restore()
    }
  })

  test('an aborted call applies nothing, not even the English it degrades to', async () => {
    const applied: string[] = []
    const apply = createLocaleApplier((usable) => applied.push(usable))
    stubLocaleFetch(() => {
      throw new DOMException('aborted', 'AbortError')
    })
    const controller = new AbortController()
    controller.abort()
    expect(await apply(localeTag('de'), controller.signal)).toBeUndefined()
    expect(applied).toEqual([])
  })

  test('a lone call applies what it loaded', async () => {
    const applied: string[] = []
    const apply = createLocaleApplier((usable) => applied.push(usable))
    stubLocaleFetch(() => new Response(JSON.stringify({ 'ui.dialog.cancel': 'Abbrechen' })))
    expect(await apply(localeTag('de'))).toBe(localeTag('de'))
    expect(applied).toEqual([localeTag('de')])
  })
})
