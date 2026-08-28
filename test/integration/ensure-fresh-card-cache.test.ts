import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ensureFreshCardCache } from '../../src/cache/freshness'
import type { BulkRefreshPrompt } from '../../src/cache/refresh'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

/**
 * `ensureFreshCardCache` reads the *global* card cache (its `deps.cache` is
 * deliberately unused), so its empty-cache branch is pinned against a bound
 * workspace rather than a stub: the injected policy's confirm — not a prompt
 * the gate opens itself — is what decides the offer.
 */
describe('ensureFreshCardCache on an empty cache (Integration)', () => {
  let workspace: BoundWorkspace

  beforeEach(async () => {
    workspace = await bindWorkspace({ clearCardCache: true })
  })

  afterEach(async () => {
    await workspace.dispose()
  })

  test('under ask, the injected confirm decides; declining reports not ready', async () => {
    const asked: BulkRefreshPrompt[] = []
    let preloads = 0

    const result = await ensureFreshCardCache(
      { mode: 'ask', confirm: async (prompt) => (asked.push(prompt), false) },
      { preload: async () => void preloads++ },
    )

    expect(asked).toHaveLength(1)
    expect(asked[0]!.initial).toBe(true)
    expect(preloads).toBe(0)
    expect(result).toEqual({ ready: false, cardCount: 0 })
  })

  test('under never, nothing is asked or downloaded', async () => {
    let preloads = 0
    const result = await ensureFreshCardCache(
      {
        mode: 'never',
        confirm: async () => {
          throw new Error('must not ask')
        },
      },
      { preload: async () => void preloads++ },
    )
    expect(preloads).toBe(0)
    expect(result.ready).toBe(false)
  })
})
