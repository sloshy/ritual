import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { Command } from 'commander'
import { registerCacheCommand } from '../../src/commands/cache'
import { cardCache } from '../../src/cache'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'
import { makeScryfallCard } from '../test-utils'

/**
 * `ritual cache preload-set` is the one caller that walks a whole Scryfall
 * result set (`ALL_PAGES`); every other search stops at one page. Only an
 * in-process run can observe how many pages were actually requested, so the
 * command is driven through commander against a stubbed Scryfall.
 */
describe('cache preload-set (Integration)', () => {
  const originalFetch = globalThis.fetch
  let workspace: BoundWorkspace
  let requestedUrls: string[] = []

  beforeAll(async () => {
    workspace = await bindWorkspace({ clearCardCache: true })
    const stub = (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      requestedUrls.push(url)
      if (url.includes('page=2')) {
        return Promise.resolve(
          Response.json({
            has_more: false,
            data: [makeScryfallCard({ id: '2', name: 'Second Page Card', set: 'khm' })],
          }),
        )
      }
      return Promise.resolve(
        Response.json({
          has_more: true,
          next_page: 'https://api.scryfall.com/cards/search?page=2',
          data: [makeScryfallCard({ id: '1', name: 'First Page Card', set: 'khm' })],
        }),
      )
    }
    globalThis.fetch = stub as typeof fetch
  })

  afterAll(async () => {
    globalThis.fetch = originalFetch
    await workspace.dispose()
  })

  test('walks every result page, so a whole set lands in the cache', async () => {
    // process.exitCode is process-global; capture it so neither a neighbour's
    // value nor this run's leaks into the suite's own exit code.
    const originalExitCode = process.exitCode
    requestedUrls = []
    const program = new Command()
    registerCacheCommand(program)
    await program.parseAsync(['cache', 'preload-set', 'KHM'], { from: 'user' })

    // A clean commander run never sets a failure code (it leaves the value unset,
    // or whatever success value the runner already had).
    expect(process.exitCode).toBeFalsy()
    // The set code is lowercased before it reaches Scryfall.
    expect(requestedUrls[0]).toContain(encodeURIComponent('set:khm'))
    expect(requestedUrls).toHaveLength(2)
    expect((await cardCache.get('First Page Card'))?.[0]?.name).toBe('First Page Card')
    expect((await cardCache.get('Second Page Card'))?.[0]?.name).toBe('Second Page Card')
    process.exitCode = originalExitCode
  })
})
