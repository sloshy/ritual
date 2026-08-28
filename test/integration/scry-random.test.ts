import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { Command } from 'commander'
import { registerScryCommand } from '../../src/commands/scry'
import { makeScryfallCard } from '../test-utils'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'
import { captureExitCode } from '../helpers/cli'
import { captureStream } from '../helpers/capture'
import type { ScryfallCard } from '../../src/scryfall/types'

/**
 * In-process scry runs against a stubbed Scryfall random endpoint: the
 * /cards/random URL (and its q= filter) can only be observed by intercepting
 * the fetch, which a spawned binary gives no hook for. Search paging has its
 * own suite in cli-scripting.test.ts; this one covers the --random dispatch.
 */
describe('scry --random (Integration)', () => {
  let scryfall: StubbedFetch
  let responseStatus = 200

  /** The URLs this run asked Scryfall for, in order. */
  const requestedUrls = (): string[] => scryfall.sent.map((request) => request.url)

  beforeAll(() => {
    scryfall = stubFetch({
      'https://api.scryfall.com': () =>
        responseStatus !== 200
          ? new Response('not found', { status: responseStatus })
          : Response.json(makeScryfallCard({ name: `Random Card ${scryfall.sent.length}` })),
    })
  })

  afterAll(() => {
    scryfall.restore()
  })

  afterEach(() => {
    responseStatus = 200
  })

  /** One in-process `scry` run: the exit code it set and what it printed. */
  type ScryRun = { code: number; stdout: string; stderr: string }

  async function runScry(args: string[]): Promise<ScryRun> {
    scryfall.sent.length = 0
    let code = 0
    let stderr = ''
    const stdout = await captureStream('stdout', async () => {
      stderr = await captureStream('stderr', async () => {
        const program = new Command()
        registerScryCommand(program)
        code = await captureExitCode(() => program.parseAsync(['scry', ...args], { from: 'user' }))
      })
    })
    return { code, stdout, stderr }
  }

  test('--random fetches /cards/random and emits a bare card', async () => {
    const { code, stdout } = await runScry(['--random'])

    expect(requestedUrls()).toHaveLength(1)
    expect(requestedUrls()[0]).toContain('/cards/random')
    const card = JSON.parse(stdout) as ScryfallCard
    expect(card.name).toBe('Random Card 1')
    expect(code).toBe(0)
  })

  test('the query doubles as the random filter', async () => {
    const { code } = await runScry(['t:instant', '--random'])

    expect(requestedUrls()[0]).toContain('/cards/random?q=t%3Ainstant')
    expect(code).toBe(0)
  })

  test('--count 2 fetches twice and emits an array', async () => {
    const { code, stdout } = await runScry(['--random', '--count', '2'])

    expect(requestedUrls()).toHaveLength(2)
    const cards = JSON.parse(stdout) as ScryfallCard[]
    expect(Array.isArray(cards)).toBe(true)
    expect(cards.map((card) => card.name)).toEqual(['Random Card 1', 'Random Card 2'])
    expect(code).toBe(0)
  })

  test('--output text renders one Name (SET) line per card', async () => {
    const { code, stdout } = await runScry(['--random', '--count', '2', '--output', 'text'])

    const lines = stdout.split('\n').filter((line) => line.length > 0)
    expect(lines).toEqual(['Random Card 1 (TST)', 'Random Card 2 (TST)'])
    expect(code).toBe(0)
  })

  test('--random with --pages is a usage error before any fetch', async () => {
    const { code, stderr } = await runScry(['--random', '--pages', '2'])

    expect(requestedUrls()).toHaveLength(0)
    expect(code).toBe(2)
    const errorJson = JSON.parse(stderr) as { error: { code: string; message: string } }
    expect(errorJson.error.code).toBe('usage_error')
    expect(errorJson.error.message).toBe('--pages cannot be used with --random.')
  })

  test('a 404 from the random endpoint is a not-found', async () => {
    responseStatus = 404
    const { code, stderr } = await runScry(['nonsense-filter', '--random'])

    expect(code).toBe(3)
    const errorJson = JSON.parse(stderr) as { error: { code: string; message: string } }
    expect(errorJson.error.code).toBe('not_found')
    expect(errorJson.error.message).toBe('No card found for the supplied random filter.')
  })
})

/**
 * `--output json` must emit ONE document however many pages a run walks. Writing
 * a page's JSON as it arrives yields N concatenated documents, which no JSON
 * parser accepts; `ndjson` streams per page because that is its contract.
 */
describe('scry --output json across pages (Integration)', () => {
  let scryfall: StubbedFetch

  beforeAll(() => {
    scryfall = stubFetch({
      'https://api.scryfall.com': (request) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
        return Response.json({
          object: 'list',
          has_more: page < 3,
          data: [makeScryfallCard({ name: `Page ${page} Card` })],
        })
      },
    })
  })

  afterAll(() => {
    scryfall.restore()
  })

  /** Run one `scry` in-process and report everything it wrote to stdout. */
  async function runScry(args: string[]): Promise<string> {
    scryfall.sent.length = 0
    const program = new Command()
    registerScryCommand(program)
    return captureStream('stdout', () => program.parseAsync(['scry', ...args], { from: 'user' }))
  }

  test('a three-page run emits one parseable JSON array', async () => {
    const stdout = await runScry(['t:instant', '--pages', '3'])

    expect(scryfall.sent).toHaveLength(3)
    const cards = JSON.parse(stdout) as ScryfallCard[]
    expect(cards.map((card) => card.name)).toEqual(['Page 1 Card', 'Page 2 Card', 'Page 3 Card'])
  })

  test('a single-page scripted run emits the same array shape, not Scryfall’s envelope', async () => {
    // The common scripted call: no --pages, no TTY, so maxPages is 1. It used to
    // pass Scryfall's raw `{ object: "list", data: [...] }` straight through,
    // making the document shape depend on how many pages the run happened to
    // walk — the one thing a scripted caller cannot branch on.
    const stdout = await runScry(['t:instant'])

    expect(scryfall.sent).toHaveLength(1)
    const cards = JSON.parse(stdout) as ScryfallCard[]
    expect(Array.isArray(cards)).toBeTrue()
    expect(cards.map((card) => card.name)).toEqual(['Page 1 Card'])
  })

  test('--fields projects the cards inside that one array', async () => {
    const stdout = await runScry(['t:instant', '--pages', '2', '--fields', 'name'])

    const cards = JSON.parse(stdout) as Partial<ScryfallCard>[]
    expect(cards).toEqual([{ name: 'Page 1 Card' }, { name: 'Page 2 Card' }])
  })

  test('ndjson still streams one document per card', async () => {
    const stdout = await runScry(['t:instant', '--pages', '2', '--output', 'ndjson'])

    const printed = stdout.split('\n').filter((line) => line.length > 0)
    expect(printed).toHaveLength(2)
    expect((JSON.parse(printed[0]!) as ScryfallCard).name).toBe('Page 1 Card')
  })
})
