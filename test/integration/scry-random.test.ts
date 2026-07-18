import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { Command } from 'commander'
import { registerScryCommand } from '../../src/commands/scry'
import { makeScryfallCard } from '../test-utils'
import type { ScryfallCard } from '../../src/types'

/**
 * In-process scry runs against a stubbed Scryfall random endpoint: the
 * /cards/random URL (and its q= filter) can only be observed by intercepting
 * the fetch, which a spawned binary gives no hook for. Search paging has its
 * own suite in cli-scripting.test.ts; this one covers the --random dispatch.
 */
describe('scry --random (Integration)', () => {
  const originalFetch = globalThis.fetch
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  let requestedUrls: string[] = []
  let responseStatus = 200
  let stdout = ''
  let stderr = ''

  beforeAll(() => {
    const stub = (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      requestedUrls.push(url)
      if (responseStatus !== 200) {
        return Promise.resolve(new Response('not found', { status: responseStatus }))
      }
      return Promise.resolve(
        Response.json(makeScryfallCard({ name: `Random Card ${requestedUrls.length}` })),
      )
    }
    globalThis.fetch = stub as typeof fetch
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      return true
    }
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      return true
    }
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  })

  afterEach(() => {
    process.exitCode = 0
    responseStatus = 200
  })

  async function runScry(args: string[]): Promise<void> {
    requestedUrls = []
    stdout = ''
    stderr = ''
    const program = new Command()
    registerScryCommand(program)
    await program.parseAsync(['scry', ...args], { from: 'user' })
  }

  test('--random fetches /cards/random and emits a bare card', async () => {
    await runScry(['--random'])

    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]).toContain('/cards/random')
    const card = JSON.parse(stdout) as ScryfallCard
    expect(card.name).toBe('Random Card 1')
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('the query doubles as the random filter', async () => {
    await runScry(['t:instant', '--random'])

    expect(requestedUrls[0]).toContain('/cards/random?q=t%3Ainstant')
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('--count 2 fetches twice and emits an array', async () => {
    await runScry(['--random', '--count', '2'])

    expect(requestedUrls).toHaveLength(2)
    const cards = JSON.parse(stdout) as ScryfallCard[]
    expect(Array.isArray(cards)).toBe(true)
    expect(cards.map((card) => card.name)).toEqual(['Random Card 1', 'Random Card 2'])
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('--output text renders one Name (SET) line per card', async () => {
    await runScry(['--random', '--count', '2', '--output', 'text'])

    const lines = stdout.split('\n').filter((line) => line.length > 0)
    expect(lines).toEqual(['Random Card 1 (TST)', 'Random Card 2 (TST)'])
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('--random with --pages is a usage error before any fetch', async () => {
    await runScry(['--random', '--pages', '2'])

    expect(requestedUrls).toHaveLength(0)
    expect(process.exitCode ?? 0).toBe(2)
    const errorJson = JSON.parse(stderr) as { error: { code: string; message: string } }
    expect(errorJson.error.code).toBe('usage_error')
    expect(errorJson.error.message).toBe('--pages cannot be used with --random.')
  })

  test('a 404 from the random endpoint is a not-found', async () => {
    responseStatus = 404
    await runScry(['nonsense-filter', '--random'])

    expect(process.exitCode ?? 0).toBe(3)
    const errorJson = JSON.parse(stderr) as { error: { code: string; message: string } }
    expect(errorJson.error.code).toBe('not_found')
    expect(errorJson.error.message).toBe('No card found for the supplied random filter.')
  })
})
