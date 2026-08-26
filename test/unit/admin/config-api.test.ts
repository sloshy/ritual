import { afterEach, describe, expect, test } from 'bun:test'
import { fetchRitualConfig } from '../../../src/admin/site/config-api'
import { getDefaultRitualConfig } from '../../../src/config/ritual-config'

const originalFetch = globalThis.fetch

/** Install a fetch stub that counts calls and resolves with a config payload. */
function stubFetch(): { calls: () => number } {
  let calls = 0
  globalThis.fetch = ((): Promise<Response> => {
    calls++
    return Promise.resolve(Response.json({ success: true, config: getDefaultRitualConfig() }))
  }) as unknown as typeof fetch
  return { calls: () => calls }
}

describe('fetchRitualConfig', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('concurrent callers share one request; later callers fetch fresh', async () => {
    const stub = stubFetch()

    // Two hooks mounting on the same page fire before either request settles —
    // they must coalesce into a single GET.
    const [a, b] = await Promise.all([fetchRitualConfig(), fetchRitualConfig()])
    expect(stub.calls()).toBe(1)
    expect(a).toEqual(getDefaultRitualConfig())
    expect(b).toEqual(getDefaultRitualConfig())

    // A call after settlement is a fresh fetch (per-page-mount refresh).
    await fetchRitualConfig()
    expect(stub.calls()).toBe(2)
  })

  test('a failed request returns null and does not stick to later callers', async () => {
    let calls = 0
    globalThis.fetch = ((): Promise<Response> => {
      calls++
      return calls === 1 ? Promise.reject(new Error('offline')) : stubResponse()
    }) as unknown as typeof fetch
    const stubResponse = () =>
      Promise.resolve(Response.json({ success: true, config: getDefaultRitualConfig() }))

    expect(await fetchRitualConfig()).toBeNull()
    // The settled (failed) request must not be cached as in-flight forever.
    expect(await fetchRitualConfig()).toEqual(getDefaultRitualConfig())
  })
})
