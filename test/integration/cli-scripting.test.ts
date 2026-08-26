import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { cardCache } from '../../src/cache'
import { getBaseDir, setBaseDir } from '../../src/config/base-dir'
import { Command } from 'commander'
import { registerCardCommand } from '../../src/commands/card'
import { registerScryCommand } from '../../src/commands/scry'
import { setNoInputOverride } from '../../src/util/no-input'
import { makeScryfallCard } from '../test-utils'
import { runCli, withTempDir } from './helpers/cli'
import { stubFetch, type StubbedFetch } from './helpers/stub-fetch'
import { writeDeckFile } from './helpers/workspace'

/** Seed a card cache with priced printings so `price` has something to total. */
async function seedPriceCache(dir: string): Promise<void> {
  const originalBase = getBaseDir()
  setBaseDir(dir)
  try {
    await cardCache.bulkSet({
      'Sol Ring': [makeScryfallCard({ name: 'Sol Ring', prices: { usd: '1.50' } })],
    })
  } finally {
    setBaseDir(originalBase)
  }
}

describe('CLI scripting behavior (Integration)', () => {
  test('price returns structured json error with not-found exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['price', 'missing-deck', '--deck', '--output', 'json'], dir)

      expect(result.exitCode).toBe(3)
      expect(result.stdout).toBe('')

      const errorJson = JSON.parse(result.stderr) as {
        error: { code: string; message: string }
      }
      expect(errorJson.error.code).toBe('not_found')
      expect(errorJson.error.message).toContain('No deck')
    })
  })

  test('price with an empty cache reports a structured runtime error', async () => {
    await withTempDir(async (dir) => {
      await writeDeckFile(dir, 'sample', {
        frontMatter: { name: 'sample' },
        cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
      })
      const result = await runCli(['price', '--summary', '--output', 'json'], dir)

      expect(result.exitCode).toBe(1)
      const errorJson = JSON.parse(result.stderr) as {
        error: { code: string; message: string }
      }
      expect(errorJson.error.code).toBe('runtime_error')
      expect(errorJson.error.message).toContain('card cache is empty')
    })
  })

  test('import unsupported url returns usage exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['import', 'https://example.com/decks/123', '--no-input'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('URL not supported')
    })
  })

  test('import moxfield url without user agent returns usage exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['import', 'https://moxfield.com/decks/abc123', '--no-input'],
        dir,
        { MOXFIELD_USER_AGENT: undefined },
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Moxfield-approved user agent string')
      expect(result.stderr).toContain('Contact Moxfield support')
    })
  })

  test('import conflict without a resolution flag is a usage error', async () => {
    await withTempDir(async (dir) => {
      const decksDir = path.join(dir, 'decks')
      await fs.mkdir(decksDir, { recursive: true })
      // sanitizeListFileName preserves case and spaces, so the pre-existing file
      // must match the source's `name:` frontmatter verbatim (plus `.md`) for the
      // conflict check to fire.
      await Bun.write(path.join(decksDir, 'Conflict Deck.md'), '# Existing deck\n')

      const sourcePath = path.join(dir, 'source.txt')
      await Bun.write(
        sourcePath,
        `---
name: "Conflict Deck"
---
## Main
1 Sol Ring
`,
      )

      // Piped stdin alone (no --no-input) is enough: the conflict prompt can
      // never run, so it must be the documented usage error either way.
      const noInput = await runCli(['import', sourcePath, '--no-input'], dir)
      expect(noInput.exitCode).toBe(2)
      expect(noInput.stderr).toContain('Import conflict')
      expect(noInput.stderr).toContain('--overwrite or --yes')

      const piped = await runCli(['import', sourcePath, '--type', 'deck'], dir)
      expect(piped.exitCode).toBe(2)
      expect(piped.stderr).toContain('Import conflict')
    })
  })

  test('import text file with --type wanted writes a wanted list', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'wants.txt')
      await Bun.write(sourcePath, '2 Lightning Bolt (lea:161)\n')

      const result = await runCli(['import', sourcePath, '--type', 'wanted', '--no-input'], dir)

      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'wanted', 'wants.md'), 'utf-8')
      expect(content).toContain('- Lightning Bolt (LEA:161) &1')
      expect(content).toContain('- Lightning Bolt (LEA:161) &2')
    })
  })

  test('import url with non-deck --type returns usage exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['import', 'https://archidekt.com/decks/12345', '--type', 'collection'],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('URL imports only support decks')
    })
  })

  test('import with invalid --type returns usage exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['import', 'cards.txt', '--type', 'binder'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Invalid list type 'binder'")
    })
  })

  test('import defaults a typeless text import to a deck under --no-input', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'cards.txt')
      await Bun.write(sourcePath, '1 Sol Ring\n')

      const result = await runCli(['import', sourcePath, '--no-input'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('importing as a deck')
      expect(await Bun.file(path.join(dir, 'decks', 'cards.md')).exists()).toBeTrue()
    })
  })

  test('import --quiet drops the chatter but still writes the list', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'cards.txt')
      await Bun.write(sourcePath, '1 Sol Ring\n')

      const result = await runCli(['import', sourcePath, '--no-input', '--quiet'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(await Bun.file(path.join(dir, 'decks', 'cards.md')).exists()).toBeTrue()
    })
  })

  test('import -y no longer implies headless: a piped run still fails when a prompt is needed', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'cards.txt')
      await Bun.write(sourcePath, '1 Sol Ring\n')

      // Without --no-input, a typeless text import wants the list-type prompt;
      // with no terminal on stdin the prompt guard must fail the run instead of
      // silently defaulting (which only --no-input opts into) or hanging.
      const result = await runCli(['import', sourcePath, '--yes'], dir, {
        RITUAL_NO_INPUT: undefined,
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Input required')
      expect(await Bun.file(path.join(dir, 'decks', 'cards.md')).exists()).toBeFalse()
    })
  })

  test('import-account with prompts disabled and no --all is a usage error', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['import-account', 'someuser', '--no-input'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--all')
    })
  })

  // A `.csv` extension routes the source through the CSV flow, whose scripted
  // gate requires the CSV flags — a text-file import would have defaulted to a
  // deck instead of asking for --columns.
  test('import of a .csv with piped stdin and missing flags fails instead of prompting', async () => {
    await withTempDir(async (dir) => {
      const csvPath = path.join(dir, 'cards.csv')
      await Bun.write(csvPath, 'name,quantity\nSol Ring,2\n')

      const result = await runCli(['import', csvPath], dir, { RITUAL_NO_INPUT: undefined })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--type')
      expect(result.stderr).toContain('--name')
      expect(result.stderr).toContain('--columns')
      // Nothing was imported.
      const entries = await fs.readdir(dir)
      expect(entries).not.toContain('decks')
      expect(entries).not.toContain('collections')
      expect(entries).not.toContain('wanted')
    })
  })

  test('csv import --output json emits the structured result and keeps exit 1 on partial failure', async () => {
    await withTempDir(async (dir) => {
      const csvPath = path.join(dir, 'cards.csv')
      await Bun.write(csvPath, 'name,quantity\nSol Ring,2\nBad Row,not-a-number\n')

      const result = await runCli(
        [
          'import',
          csvPath,
          '--type',
          'deck',
          '--name',
          'Json Deck',
          '--deck-format',
          'commander',
          '--columns',
          'name=1,quantity=2',
          '--output',
          'json',
        ],
        dir,
      )

      // The valid rows are written, but the failed row keeps the run non-zero.
      expect(result.exitCode).toBe(1)
      const payload = JSON.parse(result.stdout) as {
        imported: number
        failed: number
        failures: { line: number; reason: string }[]
        filePath: string
        mode: string
        dryRun: boolean
      }
      expect(payload.imported).toBe(2)
      expect(payload.failed).toBe(1)
      expect(payload.failures).toHaveLength(1)
      expect(payload.failures[0]?.line).toBe(3)
      expect(payload.mode).toBe('create')
      expect(payload.dryRun).toBeFalse()
      expect(await Bun.file(payload.filePath).exists()).toBeTrue()
      const deck = await fs.readFile(payload.filePath, 'utf-8')
      expect(deck).toContain('2 Sol Ring &1')
    })
  })

  test('--csv forces the CSV flow for a file without a .csv extension', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'cards.txt')
      await Bun.write(sourcePath, 'Lightning Bolt,2\n')

      const result = await runCli(
        [
          'import',
          sourcePath,
          '--csv',
          '--type',
          'wanted',
          '--name',
          'To Buy',
          '--columns',
          'name=1,quantity=2',
          '--no-header',
          '--no-input',
        ],
        dir,
      )

      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'wanted', 'To Buy.md'), 'utf-8')
      expect(content).toContain('- Lightning Bolt &1')
      expect(content).toContain('- Lightning Bolt &2')
    })
  })

  test('csv-only flags are rejected for URL sources', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['import', 'https://archidekt.com/decks/12345', '--columns', 'name=1', '--no-input'],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--columns')
      expect(result.stderr).toContain('does not apply to URL imports')
    })
  })

  test('csv-only flags are rejected for plain text sources', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'cards.txt')
      await Bun.write(sourcePath, '1 Sol Ring\n')

      const result = await runCli(['import', sourcePath, '--columns', 'name=1', '--no-input'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--columns')
      expect(result.stderr).toContain('requires a CSV source')
      expect(await Bun.file(path.join(dir, 'decks', 'cards.md')).exists()).toBeFalse()
    })
  })

  test('--moxfield-user-agent is rejected for CSV sources', async () => {
    await withTempDir(async (dir) => {
      const csvPath = path.join(dir, 'cards.csv')
      await Bun.write(csvPath, 'name,quantity\nSol Ring,1\n')

      const result = await runCli(
        [
          'import',
          csvPath,
          '--moxfield-user-agent',
          'Tester Ritual/1.0',
          '--type',
          'wanted',
          '--name',
          'To Buy',
          '--columns',
          'name=1',
          '--no-input',
        ],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--moxfield-user-agent')
      expect(result.stderr).toContain('does not apply to CSV imports')
      const entries = await fs.readdir(dir)
      expect(entries).not.toContain('wanted')
    })
  })

  test('text-file import --output json emits the structured summary on clean stdout', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'wants.txt')
      await Bun.write(sourcePath, '1 Lightning Bolt (lea:161)\n')

      const result = await runCli(
        ['import', sourcePath, '--type', 'wanted', '--output', 'json', '--no-input'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      // stdout must be exactly the payload — info chatter belongs on stderr.
      const payload = JSON.parse(result.stdout) as {
        source: string
        listType: string
        name: string
        filePath: string
        action: string
        dryRun: boolean
      }
      expect(payload.source).toBe(sourcePath)
      expect(payload.listType).toBe('wanted')
      expect(payload.name).toBe('wants')
      expect(payload.filePath.endsWith(path.join('wanted', 'wants.md'))).toBeTrue()
      expect(payload.action).toBe('created')
      expect(payload.dryRun).toBeFalse()
      expect(await Bun.file(payload.filePath).exists()).toBeTrue()
    })
  })

  test('csv import --dry-run validates the run but writes nothing', async () => {
    await withTempDir(async (dir) => {
      const csvPath = path.join(dir, 'cards.csv')
      await Bun.write(csvPath, 'name,quantity\nSol Ring,2\n')

      const result = await runCli(
        [
          'import',
          csvPath,
          '--type',
          'deck',
          '--name',
          'Dry Deck',
          '--deck-format',
          'commander',
          '--columns',
          'name=1,quantity=2',
          '--dry-run',
          '--output',
          'json',
        ],
        dir,
      )

      expect(result.exitCode).toBe(0)
      const payload = JSON.parse(result.stdout) as {
        imported: number
        filePath: string
        mode: string
        dryRun: boolean
      }
      expect(payload.imported).toBe(2)
      expect(payload.mode).toBe('create')
      expect(payload.dryRun).toBeTrue()
      expect(await Bun.file(payload.filePath).exists()).toBeFalse()
      const entries = await fs.readdir(dir)
      expect(entries).not.toContain('decks')
    })
  })

  // Sub-fix: warnings that mean content was lost survive structured output.
  // A skipped card line means the totals exclude cards, so the line reaches
  // stderr in every output mode *and* the payload carries it.
  test('price reports parser warnings on stderr and in the payload', async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
      await fs.writeFile(
        path.join(dir, 'decks', 'scraps.md'),
        '---\nname: Scraps\nformat: modern\n---\n\n## Main\n1 Sol Ring &1\nsideboard ideas: maybe a counterspell\n',
      )
      await seedPriceCache(dir)

      const result = await runCli(['price', 'scraps', '--deck', '--output', 'json'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('sideboard ideas: maybe a counterspell')
      const payload = JSON.parse(result.stdout) as { warnings: string[] }
      expect(payload.warnings.join('\n')).toContain('sideboard ideas: maybe a counterspell')
    })
  })

  test('bare export with prompts disabled is a usage error with a hint', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['export'], dir, { RITUAL_NO_INPUT: '1' })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--all')
    })
  })

  // A malformed cache-server address is bad configuration however it arrives:
  // the flag is rejected by its argParser, the env var by the preAction hook,
  // and both land on the same usage exit code and message.
  test('a malformed --cache-server is a usage error', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['lists', '--cache-server', 'garbage'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('hostname and port')
    })
  })

  test('a malformed RITUAL_CACHE_SERVER is the same usage error', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['lists'], dir, { RITUAL_CACHE_SERVER: 'garbage' })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('hostname and port')
    })
  })

  // A blank env var reads as "unset" (the usual environment convention), while
  // explicitly passing a blank flag value is a bad value like any other.
  test('a blank RITUAL_CACHE_SERVER is ignored, a blank --cache-server is not', async () => {
    await withTempDir(async (dir) => {
      const ignored = await runCli(['lists'], dir, { RITUAL_CACHE_SERVER: '   ' })
      expect(ignored.exitCode).toBe(0)

      const rejected = await runCli(['lists', '--cache-server', '   '], dir)
      expect(rejected.exitCode).toBe(2)
      expect(rejected.stderr).toContain('non-empty hostname and port')
    })
  })
})

/**
 * In-process scry runs against a stubbed Scryfall search endpoint: the paging
 * cap can only be observed by counting page fetches, which a spawned binary
 * gives no hook for (the search URL is hardcoded). Prompts are forced off via
 * the no-input override, pinning the non-interactive side of the paging gate;
 * the interactive side lives in test/unit/commands/scry.test.ts.
 */
describe('scry paging (Integration)', () => {
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalErrorWrite = process.stderr.write.bind(process.stderr)
  let scryfall: StubbedFetch
  let stdout: string
  let stderr: string

  /** Pages this run fetched — one request per page, so the record is the count. */
  const fetchedPages = (): number => scryfall.sent.length

  beforeAll(() => {
    setNoInputOverride(true)
    scryfall = stubFetch({
      'https://api.scryfall.com': (request) => {
        const params = new URL(request.url).searchParams
        const page = params.get('page') ?? '?'
        // Always more pages: only the cap (or a prompt decline) may stop the loop.
        if (params.get('format') === 'csv') {
          // Scryfall renders CSV server-side; scry must pass the body through
          // untouched apart from stripping repeated headers on later pages. A
          // full page (175 rows) is what marks a CSV response as "more remain".
          const rows = Array.from(
            { length: 175 },
            (_unused, index) => `Page ${page} Card ${index + 1},tst`,
          )
          return new Response(`name,set\n${rows.join('\n')}\n`, {
            headers: { 'content-type': 'text/csv' },
          })
        }
        return Response.json({
          object: 'list',
          has_more: true,
          total_cards: 4210,
          data: [makeScryfallCard({ name: `Page ${page} Card` })],
        })
      },
    })
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
    setNoInputOverride(undefined)
    scryfall.restore()
    process.stdout.write = originalWrite
    process.stderr.write = originalErrorWrite
  })

  afterEach(() => {
    process.exitCode = 0
  })

  async function runScry(args: string[]): Promise<void> {
    scryfall.sent.length = 0
    stdout = ''
    stderr = ''
    const program = new Command()
    // Matches index.ts: a usage error throws instead of calling process.exit,
    // which would take the test runner down with it.
    program.exitOverride()
    registerScryCommand(program)
    await program.parseAsync(['scry', ...args], { from: 'user' })
  }

  test('fetches exactly one page when prompts are unavailable', async () => {
    await runScry(['type:creature'])

    expect(fetchedPages()).toBe(1)
    expect(stdout).toContain('Page 1 Card')
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('--pages caps the fetch without prompting', async () => {
    await runScry(['type:creature', '--pages', '3'])

    expect(fetchedPages()).toBe(3)
    expect(stdout).toContain('Page 3 Card')
    expect(process.exitCode ?? 0).toBe(0)
  })

  // A capped run that stopped with results left must say so: the notice is a
  // content-loss warning, so it goes to stderr in every output mode and there
  // is no `--quiet` to hide it with.
  test('a capped run reports the truncation on stderr, keeping stdout parseable', async () => {
    await runScry(['type:creature', '--pages', '2'])

    expect(stderr.trim()).toBe('Fetched 2 of 4210 results (pages 1-2); use --pages <n> for more.')
    expect(stdout).not.toContain('use --pages')
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('scry registers no --quiet flag', async () => {
    const error = await runScry(['type:creature', '--quiet']).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("unknown option '--quiet'")
  })

  // The search path renders text itself rather than dumping the raw Scryfall
  // list envelope; the random path's rendering is pinned in scry-random.test.ts.
  test('--output text renders one `Name (SET)` line per card', async () => {
    await runScry(['type:creature', '--output', 'text'])

    expect(stdout.trim()).toBe('Page 1 Card (TST)')
    expect(stdout).not.toContain('"object"')
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('--output csv asks Scryfall for CSV and writes it through unchanged', async () => {
    await runScry(['type:creature', '--output', 'csv'])

    const requested = scryfall.sent[0]
    expect(requested).toBeDefined()
    expect(new URL(requested?.url ?? '').searchParams.get('format')).toBe('csv')
    expect(stdout.split('\n')[0]).toBe('name,set')
    expect(stdout).toContain('Page 1 Card 1,tst')
    expect(process.exitCode ?? 0).toBe(0)
  })

  // Every page carries its own header row; only the first one belongs in a
  // single concatenated CSV stream.
  test('--output csv strips the repeated header on later pages', async () => {
    await runScry(['type:creature', '--output', 'csv', '--pages', '2'])

    expect(fetchedPages()).toBe(2)
    expect(stdout.split('\n').filter((line) => line === 'name,set')).toHaveLength(1)
    expect(stdout).toContain('Page 2 Card 1,tst')
    expect(process.exitCode ?? 0).toBe(0)
  })
})

/**
 * In-process `card` runs against a stubbed Scryfall `cards/named` endpoint. The
 * batch contract is about output *shape*, which only a captured stdout can pin;
 * a spawned binary would need real network access to produce any.
 */
describe('card batch output (Integration)', () => {
  const originalWrite = process.stdout.write.bind(process.stdout)
  let scryfall: StubbedFetch
  let stdout: string

  beforeAll(() => {
    scryfall = stubFetch({
      'https://api.scryfall.com': (request) => {
        const params = new URL(request.url).searchParams
        const name = params.get('exact') ?? params.get('fuzzy') ?? 'Unknown'
        return Response.json(makeScryfallCard({ name }))
      },
    })
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      return true
    }
  })

  afterAll(() => {
    scryfall.restore()
    process.stdout.write = originalWrite
  })

  afterEach(() => {
    process.exitCode = 0
  })

  async function runCard(args: string[]): Promise<void> {
    scryfall.sent.length = 0
    stdout = ''
    const program = new Command()
    program.exitOverride()
    registerCardCommand(program)
    await program.parseAsync(['card', ...args], { from: 'user' })
  }

  test('--output json emits one array for a batch and a bare object for one name', async () => {
    await withTempDir(async (dir) => {
      const namesPath = path.join(dir, 'names.txt')
      await Bun.write(namesPath, 'Sol Ring\nCounterspell\n')

      await runCard(['--from-file', namesPath])
      const batch = JSON.parse(stdout) as { name: string }[]
      expect(Array.isArray(batch)).toBeTrue()
      expect(batch.map((card) => card.name)).toEqual(['Sol Ring', 'Counterspell'])

      await runCard(['Sol Ring'])
      const single = JSON.parse(stdout) as { name: string }
      expect(Array.isArray(single)).toBeFalse()
      expect(single.name).toBe('Sol Ring')
    })
  })

  test('--output ndjson streams one document per card', async () => {
    await withTempDir(async (dir) => {
      const namesPath = path.join(dir, 'names.txt')
      await Bun.write(namesPath, 'Sol Ring\nCounterspell\n')

      await runCard(['--from-file', namesPath, '--output', 'ndjson'])

      const lines = stdout.trim().split('\n')
      expect(lines).toHaveLength(2)
      expect((JSON.parse(lines[1] ?? '{}') as { name: string }).name).toBe('Counterspell')
    })
  })

  test('card registers no --quiet flag', async () => {
    const error = await runCard(['Sol Ring', '--quiet']).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("unknown option '--quiet'")
  })
})
