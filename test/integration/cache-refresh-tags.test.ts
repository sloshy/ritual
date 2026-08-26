import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level.
import '../../src/scryfall'
import { registerCacheCommand } from '../../src/commands/cache'
import { ExitCode } from '../../src/util/errors'
import { runInProcess } from './helpers/cli'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'

/**
 * Wiring pin for `cache refresh-tags`: a download that did not happen has to
 * reach the exit code. The command used to print "Tag refresh aborted" and exit
 * 0, so no script or cron job could tell a failed refresh from a good one.
 */
describe('cache refresh-tags (Integration)', () => {
  const originalFetch = globalThis.fetch
  let workspace: BoundWorkspace

  beforeAll(async () => {
    workspace = await bindWorkspace({ clearCardCache: true })
    // Every Scryfall request fails, including the bulk manifest the tag
    // download starts with.
    globalThis.fetch = (() =>
      Promise.resolve(new Response('nope', { status: 500 }))) as unknown as typeof fetch
  })

  afterAll(async () => {
    globalThis.fetch = originalFetch
    await workspace.dispose()
  })

  test('a failed tag download exits 1 and says so', async () => {
    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => void errors.push(args.join(' '))

    let code: number
    try {
      code = await runInProcess(registerCacheCommand, ['cache', 'refresh-tags'])
    } finally {
      console.error = originalError
    }

    expect(code).toBe(ExitCode.RuntimeError)
    // Ties the exit code to the intended path: a workspace or cache-lock failure
    // inside the action would otherwise produce an identical RuntimeError.
    expect(errors.join('\n')).toContain('Failed to refresh tags')
  })
})
