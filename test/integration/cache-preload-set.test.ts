import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { registerCacheCommand } from '../../src/commands/cache'
import { cardCache } from '../../src/cache'
import { runInProcess } from '../helpers/cli'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { makeScryfallCard } from '../test-utils'
import { ExitCode } from '../../src/util/errors'
import { captureConsole } from '../helpers/capture'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'

/**
 * `ritual cache preload-set` is the one caller that walks a whole Scryfall
 * result set (`ALL_PAGES`); every other search stops at one page. Only an
 * in-process run can observe how many pages were actually requested, so the
 * command is driven through commander against a stubbed Scryfall.
 */
describe('cache preload-set (Integration)', () => {
  let workspace: BoundWorkspace
  let scryfall: StubbedFetch

  beforeAll(async () => {
    workspace = await bindWorkspace({ clearCardCache: true })
    scryfall = stubFetch({
      'https://api.scryfall.com': ({ url }) => {
        // Scryfall answers an unknown set code with a 404 "nothing matched".
        if (url.includes(encodeURIComponent('set:zzzznotaset'))) {
          return new Response('{}', { status: 404 })
        }
        if (url.includes(encodeURIComponent('set:down'))) {
          return new Response(JSON.stringify({ details: 'Service unavailable' }), { status: 503 })
        }
        if (url.includes('page=2')) {
          return Response.json({
            has_more: false,
            data: [makeScryfallCard({ id: '2', name: 'Second Page Card', set: 'khm' })],
          })
        }
        return Response.json({
          has_more: true,
          next_page: 'https://api.scryfall.com/cards/search?page=2',
          data: [makeScryfallCard({ id: '1', name: 'First Page Card', set: 'khm' })],
        })
      },
    })
  })

  afterAll(async () => {
    scryfall.restore()
    await workspace.dispose()
  })

  test('walks every result page, so a whole set lands in the cache', async () => {
    scryfall.sent.length = 0
    const code = await runPreloadSet('KHM')

    expect(code).toBe(0)
    // The set code is lowercased before it reaches Scryfall.
    expect(scryfall.sent[0]?.url).toContain(encodeURIComponent('set:khm'))
    expect(scryfall.sent).toHaveLength(2)
    expect((await cardCache.get('First Page Card'))?.[0]?.name).toBe('First Page Card')
    expect((await cardCache.get('Second Page Card'))?.[0]?.name).toBe('Second Page Card')
  })

  /** Run the subcommand and report the exit code it set. */
  async function runPreloadSet(setCode: string): Promise<number> {
    return runInProcess(registerCacheCommand, ['cache', 'preload-set', setCode])
  }

  /** Run `preload-set`, capturing what it wrote to stderr alongside its exit code. */
  async function preloadSetWithErrors(setCode: string): Promise<{ code: number; stderr: string }> {
    const { result: code, lines } = await captureConsole(['error'], () => runPreloadSet(setCode))
    return { code, stderr: lines.error.join('\n') }
  }

  test('an unknown set code exits non-zero instead of reporting 0 cards cached', async () => {
    scryfall.sent.length = 0
    const { code, stderr } = await preloadSetWithErrors('zzzznotaset')

    expect(code).toBe(ExitCode.NotFound)
    // The message names the code the user typed, uppercased, and where to look.
    expect(stderr).toContain("No cards found for set 'ZZZZNOTASET'")
    expect(stderr).toContain('https://scryfall.com/sets')
  })

  test('an HTTP failure exits 1, as the docs promise', async () => {
    scryfall.sent.length = 0
    const { code, stderr } = await preloadSetWithErrors('down')

    expect(code).toBe(ExitCode.RuntimeError)
    // Distinct from the unknown-set wording: the set may well exist.
    expect(stderr).toContain("Failed to preload set 'DOWN'")
    expect(stderr).not.toContain('check the set code')
  })
})
