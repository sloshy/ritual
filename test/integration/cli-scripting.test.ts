import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { Command } from 'commander'
import { registerScryCommand } from '../../src/commands/scry'
import { setNoInputOverride } from '../../src/no-input'
import { makeScryfallCard } from '../test-utils'
import { runCli, withTempDir } from './helpers/cli'
import { writeDeckFile } from './helpers/workspace'

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

  test('import conflict under --no-input returns runtime exit code', async () => {
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

      const result = await runCli(['import', sourcePath, '--no-input'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Import conflict')
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

  test('import-csv with piped stdin and missing flags fails instead of prompting', async () => {
    await withTempDir(async (dir) => {
      const csvPath = path.join(dir, 'cards.csv')
      await Bun.write(csvPath, 'name,quantity\nSol Ring,2\n')

      const result = await runCli(['import-csv', csvPath], dir, { RITUAL_NO_INPUT: undefined })

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

  test('import-csv --output json emits the structured result and keeps exit 1 on partial failure', async () => {
    await withTempDir(async (dir) => {
      const csvPath = path.join(dir, 'cards.csv')
      await Bun.write(csvPath, 'name,quantity\nSol Ring,2\nBad Row,not-a-number\n')

      const result = await runCli(
        [
          'import-csv',
          csvPath,
          '--type',
          'deck',
          '--name',
          'Json Deck',
          '--format',
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
      }
      expect(payload.imported).toBe(2)
      expect(payload.failed).toBe(1)
      expect(payload.failures).toHaveLength(1)
      expect(payload.failures[0]?.line).toBe(3)
      expect(payload.mode).toBe('create')
      expect(await Bun.file(payload.filePath).exists()).toBeTrue()
      const deck = await fs.readFile(payload.filePath, 'utf-8')
      expect(deck).toContain('2 Sol Ring &1')
    })
  })

  test('bare export with prompts disabled is a usage error with a hint', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['export'], dir, { RITUAL_NO_INPUT: '1' })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--all')
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
  const originalFetch = globalThis.fetch
  const originalWrite = process.stdout.write.bind(process.stdout)
  let fetchedPages: number
  let stdout: string

  beforeAll(() => {
    setNoInputOverride(true)
    const stub = (input: string | URL | Request): Promise<Response> => {
      fetchedPages++
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const page = new URL(url).searchParams.get('page') ?? '?'
      // Always more pages: only the cap (or a prompt decline) may stop the loop.
      return Promise.resolve(
        Response.json({
          object: 'list',
          has_more: true,
          data: [makeScryfallCard({ name: `Page ${page} Card` })],
        }),
      )
    }
    globalThis.fetch = stub as typeof fetch
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      return true
    }
  })

  afterAll(() => {
    setNoInputOverride(undefined)
    globalThis.fetch = originalFetch
    process.stdout.write = originalWrite
  })

  afterEach(() => {
    process.exitCode = 0
  })

  async function runScry(args: string[]): Promise<void> {
    fetchedPages = 0
    stdout = ''
    const program = new Command()
    registerScryCommand(program)
    await program.parseAsync(['scry', ...args], { from: 'user' })
  }

  test('fetches exactly one page when prompts are unavailable', async () => {
    await runScry(['type:creature'])

    expect(fetchedPages).toBe(1)
    expect(stdout).toContain('Page 1 Card')
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('--pages caps the fetch without prompting', async () => {
    await runScry(['type:creature', '--pages', '3'])

    expect(fetchedPages).toBe(3)
    expect(stdout).toContain('Page 3 Card')
    expect(process.exitCode ?? 0).toBe(0)
  })

  test('--quiet does not change paging: still one page, no prompt', async () => {
    await runScry(['type:creature', '--quiet'])

    expect(fetchedPages).toBe(1)
    expect(process.exitCode ?? 0).toBe(0)
  })
})
