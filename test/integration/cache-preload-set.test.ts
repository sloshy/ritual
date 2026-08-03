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
import { ExitCode } from '../../src/commands/scripting'

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
      // Scryfall answers an unknown set code with a 404 "nothing matched".
      if (url.includes(encodeURIComponent('set:zzzznotaset'))) {
        return Promise.resolve(new Response('{}', { status: 404 }))
      }
      if (url.includes(encodeURIComponent('set:down'))) {
        return Promise.resolve(
          new Response(JSON.stringify({ details: 'Service unavailable' }), { status: 503 }),
        )
      }
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

  /** Run the subcommand and report the exit code it set, restoring the process's. */
  async function runPreloadSet(setCode: string): Promise<number> {
    const originalExitCode = process.exitCode
    process.exitCode = 0
    const program = new Command()
    registerCacheCommand(program)
    await program.parseAsync(['cache', 'preload-set', setCode], { from: 'user' })
    const code = process.exitCode
    process.exitCode = originalExitCode
    return typeof code === 'number' ? code : 0
  }

  /** Run `preload-set`, capturing what it wrote to stderr alongside its exit code. */
  async function preloadSetWithErrors(setCode: string): Promise<{ code: number; stderr: string }> {
    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => void errors.push(args.join(' '))
    try {
      return { code: await runPreloadSet(setCode), stderr: errors.join('\n') }
    } finally {
      console.error = originalError
    }
  }

  test('an unknown set code exits non-zero instead of reporting 0 cards cached', async () => {
    requestedUrls = []
    const { code, stderr } = await preloadSetWithErrors('zzzznotaset')

    expect(code).toBe(ExitCode.NotFound)
    // The message names the code the user typed, uppercased, and where to look.
    expect(stderr).toContain("No cards found for set 'ZZZZNOTASET'")
    expect(stderr).toContain('https://scryfall.com/sets')
  })

  test('an HTTP failure exits 1, as the docs promise', async () => {
    requestedUrls = []
    const { code, stderr } = await preloadSetWithErrors('down')

    expect(code).toBe(ExitCode.RuntimeError)
    // Distinct from the unknown-set wording: the set may well exist.
    expect(stderr).toContain("Failed to preload set 'DOWN'")
    expect(stderr).not.toContain('check the set code')
  })
})
