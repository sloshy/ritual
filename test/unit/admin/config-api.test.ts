import { afterEach, describe, expect, test } from 'bun:test'
import { fetchRitualConfig } from '../../../src/admin/site/config-api'
import { getDefaultRitualConfig } from '../../../src/config/ritual-config'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'

let stubbed: StubbedFetch | undefined

/** Install a fetch stub that resolves with a config payload; `.sent` counts the calls. */
function stubConfig(): StubbedFetch {
  stubbed = stubFetch({
    '': () => Response.json({ success: true, config: getDefaultRitualConfig() }),
  })
  return stubbed
}

describe('fetchRitualConfig', () => {
  afterEach(() => {
    stubbed?.restore()
    stubbed = undefined
  })

  test('concurrent callers share one request; later callers fetch fresh', async () => {
    const stub = stubConfig()

    // Two hooks mounting on the same page fire before either request settles —
    // they must coalesce into a single GET.
    const [a, b] = await Promise.all([fetchRitualConfig(), fetchRitualConfig()])
    expect(stub.sent).toHaveLength(1)
    expect(a).toEqual(getDefaultRitualConfig())
    expect(b).toEqual(getDefaultRitualConfig())

    // A call after settlement is a fresh fetch (per-page-mount refresh).
    await fetchRitualConfig()
    expect(stub.sent).toHaveLength(2)
  })

  test('a failed request returns null and does not stick to later callers', async () => {
    let calls = 0
    stubbed = stubFetch({
      '': () => {
        if (++calls === 1) throw new Error('offline')
        return Response.json({ success: true, config: getDefaultRitualConfig() })
      },
    })

    expect(await fetchRitualConfig()).toBeNull()
    // The settled (failed) request must not be cached as in-flight forever.
    expect(await fetchRitualConfig()).toEqual(getDefaultRitualConfig())
  })
})
