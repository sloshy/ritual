import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { BulkRefreshPrompt, RefreshMode, RefreshPolicy } from '../../src/cache/refresh'
import {
  prepareCardSessionCache,
  type CardSessionCacheDeps,
} from '../../src/commands/session/config'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

/**
 * The empty-cache preload offer a card-entry session makes, decided by the
 * injected `RefreshPolicy` like every other bulk-download gate: `ask` puts the
 * question to the policy's confirm, `auto` downloads outright, and
 * `no-bulk`/`never` never offer. Bound to a workspace because the offer names
 * what the configured `defaultLanguage` downloads.
 */
describe('prepareCardSessionCache on an empty cache (Integration)', () => {
  let ws: BoundWorkspace

  beforeEach(async () => {
    ws = await bindWorkspace({
      init: true,
      clearCardCache: true,
      config: { defaultLanguage: 'en' },
    })
  })

  afterEach(async () => {
    resetLogger()
    await ws.dispose()
  })

  type Run = {
    asked: BulkRefreshPrompt[]
    preloads: number
    loads: number
    deps: CardSessionCacheDeps
    logger: MemoryLogger
  }

  function run(): Run {
    const logger = new MemoryLogger()
    setLogger(logger)
    const state: Run = { asked: [], preloads: 0, loads: 0, deps: {}, logger }
    state.deps = {
      isEmpty: async () => state.preloads === 0,
      preload: async () => void state.preloads++,
      loadCardNames: async () => (state.loads++, ['Sol Ring']),
    }
    return state
  }

  function policy(r: Run, mode: RefreshMode, answer: boolean): RefreshPolicy {
    return { mode, confirm: async (prompt) => (r.asked.push(prompt), answer) }
  }

  test('ask: an accepted offer preloads, then loads the names', async () => {
    const r = run()
    const names = await prepareCardSessionCache(policy(r, 'ask', true), undefined, false, r.deps)

    expect(names).toEqual(['Sol Ring'])
    expect(r.asked).toHaveLength(1)
    expect(r.asked[0]).toMatchObject({ initial: true })
    expect(r.asked[0]!.message).toContain('pre-cache Scryfall data for all English MTG cards')
    expect(r.preloads).toBe(1)
    expect(r.loads).toBe(1)
  })

  test('ask: a declined offer refuses the session without loading card names', async () => {
    const r = run()
    const names = await prepareCardSessionCache(policy(r, 'ask', false), undefined, false, r.deps)

    expect(names).toBeNull()
    expect(r.asked).toHaveLength(1)
    expect(r.preloads).toBe(0)
    expect(r.loads).toBe(0)
    expect(process.exitCode).toBe(1)
  })

  test.each(['never', 'no-bulk'] as const)(
    '%s: neither offers nor preloads, and refuses the session',
    async (mode) => {
      const r = run()
      const names = await prepareCardSessionCache(policy(r, mode, true), undefined, false, r.deps)

      expect(names).toBeNull()
      expect(r.asked).toEqual([])
      expect(r.preloads).toBe(0)
      expect(r.loads).toBe(0)
      expect(process.exitCode).toBe(1)
    },
  )

  test('auto: preloads without asking', async () => {
    const r = run()
    const names = await prepareCardSessionCache(policy(r, 'auto', false), undefined, false, r.deps)

    expect(names).toEqual(['Sol Ring'])
    expect(r.asked).toEqual([])
    expect(r.preloads).toBe(1)
  })

  test('a preload that fails is reported and the session is still refused', async () => {
    const r = run()
    r.deps.preload = async () => {
      throw new Error('offline')
    }
    const names = await prepareCardSessionCache(policy(r, 'ask', true), undefined, false, r.deps)

    expect(names).toBeNull()
    expect(r.loads).toBe(0)
    expect(
      r.logger.entries.some(
        (entry) =>
          entry.level === 'error' &&
          typeof entry.args[0] === 'string' &&
          entry.args[0].includes('Failed to preload all cards:'),
      ),
    ).toBeTrue()
  })

  test('a non-English defaultLanguage names the every-language bulk in the offer', async () => {
    await ws.dispose()
    ws = await bindWorkspace({
      init: true,
      clearCardCache: true,
      config: { defaultLanguage: 'ja' },
    })
    const r = run()
    await prepareCardSessionCache(policy(r, 'ask', false), undefined, false, r.deps)

    expect(r.asked).toHaveLength(1)
    expect(r.asked[0]!.message).toContain("all MTG cards in every language (defaultLanguage 'ja'")
  })
})
