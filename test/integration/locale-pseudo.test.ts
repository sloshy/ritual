import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCALE_ENV, ensureBinary, repoRoot, runCli, withTempDir } from './helpers/cli'
import { en } from '../../src/i18n/messages/en'
import { MALFORMED_MOVE_BUNDLE, MALFORMED_MOVE_ENGLISH } from '../helpers/change-problem'
import type { LocaleCatalog } from '../../src/i18n/types'
import { writeDeckFile, writeWantedFile } from '../helpers/workspace'
import { jpDiagnosticAt, jpDiagnosticEnglish } from '../helpers/card-line'
import { buildCacheFeed, type FeedArtifact } from '../helpers/cache-feed'
import { bulkCard, gzipJsonLines } from '../test-utils'

/**
 * The pseudo-locale end to end, through the real binary.
 *
 * `en-XA` is generated from English by `scripts/generate-locales.ts` — accented,
 * padded, and bracketed — so it answers the one question no English assertion
 * can: *did this string actually go through `t()`?* A message that did comes out
 * bracketed; a literal that was never routed stays plain ASCII.
 *
 * The `--help` case is the load-bearing one. Commander evaluates every
 * `.description()` / `.option()` string at registration time, which is why the
 * command tree is built inside `buildProgram()` after `initI18n()` rather than
 * at module scope. If that ordering ever regresses — a locale resolved in
 * `preAction`, say — help renders in English while everything else translates,
 * and only this test notices.
 *
 * Expected strings are read from the generated catalog rather than pasted in, so
 * the assertion follows the English source and the generator instead of pinning
 * a snapshot of accented text that no one can proofread.
 */

const PSEUDO = 'en-XA'

/** Env that asks for the pseudo-locale, on top of the suite's scrubbed baseline. */
const PSEUDO_ENV: Record<string, string | undefined> = { ...LOCALE_ENV, RITUAL_LOCALE: PSEUDO }

let pseudoCatalog: LocaleCatalog | null = null

/**
 * The generated `en-XA` dictionary. Read lazily and only after the binary is
 * ready, because the same build step that compiles the binary is what writes it.
 */
async function pseudo(): Promise<LocaleCatalog> {
  if (pseudoCatalog !== null) return pseudoCatalog
  await ensureBinary()
  const raw = await fs.readFile(path.join(repoRoot, 'locales', `${PSEUDO}.json`), 'utf-8')
  pseudoCatalog = JSON.parse(raw) as LocaleCatalog
  return pseudoCatalog
}

/** The pseudo-localized form of a plain-string message, for a `toContain`. */
async function pseudoText(key: string): Promise<string> {
  const value = (await pseudo())[key]
  if (typeof value !== 'string') {
    throw new Error(`${key} is not a plain-string message in the ${PSEUDO} catalog`)
  }
  return value
}

/**
 * Collapse every whitespace run to a single space.
 *
 * Commander re-wraps help text to the terminal width, so a message long enough
 * to break across lines would never match verbatim — and the pseudo-locale pads
 * everything by 40% precisely to make text long. Normalizing both sides keeps
 * the assertion about *which* text was rendered rather than about layout.
 */
function unwrap(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/** The `--output json` error envelope, as a script or agent parses it. */
type ErrorEnvelopeJson = {
  error: { code: string; messageKey?: string; message: string; details?: unknown }
}

/** Run a command that fails and return its parsed error envelope. */
async function runFailing(
  args: string[],
  dir: string,
  env: Record<string, string | undefined>,
): Promise<ErrorEnvelopeJson> {
  const result = await runCli(args, dir, env)
  expect(result.exitCode).not.toBe(0)
  return JSON.parse(result.stderr) as ErrorEnvelopeJson
}

/** A cache feed served from this process: its URL, and how to stop it. */
type ServedFeed = { url: string; stop: () => Promise<void> }

/**
 * Serve a one-card cache feed on a loopback port, for `cache feed fetch --url`
 * to download over plain HTTP.
 */
async function serveCacheFeed(): Promise<ServedFeed> {
  const artifacts: FeedArtifact[] = [
    {
      kind: 'default-cards',
      fileName: 'default-cards.jsonl.gz',
      body: gzipJsonLines([bulkCard()]),
    },
    {
      kind: 'oracle-tags',
      fileName: 'oracle-tags.jsonl.gz',
      body: gzipJsonLines([
        { object: 'tag', id: 't1', label: 'Ramp', slug: 'ramp', type: 'oracle' },
      ]),
    },
    {
      kind: 'art-tags',
      fileName: 'art-tags.jsonl.gz',
      body: gzipJsonLines([
        { object: 'tag', id: 'a1', label: 'Ring', slug: 'ring', type: 'illustration' },
      ]),
    },
  ]
  // Bound first: the feed document names its files by the server's own origin.
  let files = new Map<string, Uint8Array>()
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      const body = files.get(request.url)
      return body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(body.slice())
    },
  })
  const origin = `http://127.0.0.1:${server.port}`
  const built = buildCacheFeed(origin, artifacts, '2026-06-04T00:00:00.000Z')
  files = new Map(built.files)
  files.set(`${origin}/feed.json`, new TextEncoder().encode(JSON.stringify(built.feed)))
  return { url: `${origin}/feed.json`, stop: () => server.stop(true) }
}

describe('pseudo-locale (Integration)', () => {
  test('RITUAL_LOCALE=en-XA renders help in the pseudo-locale', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['--help'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(0)
      // The program description is registered before any option is parsed, so
      // seeing it bracketed is the proof that the locale was resolved before
      // the command tree was built.
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.program.description'))
      // Options registered on the root program, and a subcommand summary
      // registered by one of the `register*Command` calls, both follow.
      expect(result.stdout).toMatch(/--locale <tag>\s+\[/)
      expect(result.stdout).toMatch(/--base-dir <path>\s+\[/)
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.locale.summary'))
    })
  })

  test("Commander's own help strings are localized, not just Ritual's", async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['--help'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(0)
      // Section headings arrive through `configureHelp({ styleTitle })`, the
      // built-in flag descriptions through `.version()` / `.helpOption()`, and
      // the group headings from `commandsGroup(t(…))`. None of the three is a
      // string Ritual would otherwise author, so each is only bracketed if its
      // hook is actually wired.
      expect(result.stdout).toContain(await pseudoText('help.commander.usageTitle'))
      expect(result.stdout).toContain(await pseudoText('help.commander.optionsTitle'))
      expect(result.stdout).toContain(await pseudoText('help.commander.commandsTitle'))
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.commander.version'))
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.commander.help'))
      expect(result.stdout).toContain(await pseudoText('help.group.lists'))
    })
  })

  test("Commander's parse errors are localized, suggestion included", async () => {
    await withTempDir(async (dir) => {
      // `outputError` is handed a finished sentence rather than its arguments,
      // so these two prove the re-parse: the frame is bracketed while the flag
      // and command names inside it are untouched.
      const unknownOption = await runCli(['--bogos'], dir, PSEUDO_ENV)
      expect(unknownOption.exitCode).toBe(2)
      expect(unwrap(unknownOption.stderr)).toContain(
        (await pseudoText('help.commander.unknownOption')).replace('{flag}', '--bogos'),
      )

      // An unknown command close to a real one appends the "did you mean" tail,
      // which is split off and localized separately from the frame.
      const unknownCommand = await runCli(['dif'], dir, PSEUDO_ENV)
      expect(unknownCommand.exitCode).toBe(2)
      expect(unwrap(unknownCommand.stderr)).toContain(
        (await pseudoText('help.commander.unknownCommand')).replace('{name}', 'dif'),
      )
      expect(unwrap(unknownCommand.stderr)).toContain(
        (await pseudoText('help.commander.didYouMean')).replace('{suggestion}', 'diff'),
      )
    })
  })

  test("Commander's English is byte-identical to the unhooked library", async () => {
    await withTempDir(async (dir) => {
      // The catalog copies Commander's own literals, so an English run must be
      // indistinguishable from one with no hooks installed at all.
      const help = await runCli(['--help'], dir)
      expect(help.stdout.startsWith('Usage: ritual [options] [command]\n')).toBe(true)
      expect(help.stdout).toContain('\nOptions:\n')
      expect(help.stdout).toContain('output the version number')
      expect(help.stdout).toContain('display help for command')

      const unknownOption = await runCli(['--bogos'], dir)
      expect(unknownOption.stderr).toBe("error: unknown option '--bogos'\n")

      const unknownCommand = await runCli(['dif'], dir)
      expect(unknownCommand.stderr).toBe("error: unknown command 'dif'\n(Did you mean diff?)\n")

      const missingArgument = await runCli(['diff', 'a'], dir)
      expect(missingArgument.stderr).toBe("error: missing required argument 'listB'\n")

      const excess = await runCli(['lists', 'x', 'y'], dir)
      expect(excess.stderr).toBe(
        "error: too many arguments for 'lists'. Expected 0 arguments but got 2: x, y.\n",
      )
    })
  })

  test('--locale reaches help too, not just RITUAL_LOCALE', async () => {
    await withTempDir(async (dir) => {
      // The flag is read by the argv pre-scan, which runs before Commander
      // exists — the piece of locale resolution that has no other observable
      // effect.
      const result = await runCli(['--locale', PSEUDO, '--help'], dir)

      expect(result.exitCode).toBe(0)
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.program.description'))
    })
  })

  test('subcommand help is pseudo-localized as well', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['locale', '--help'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(0)
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.locale.summary'))
    })
  })

  test('English help is unchanged — the pseudo-locale is opt-in', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['--help'], dir)

      expect(result.exitCode).toBe(0)
      expect(unwrap(result.stdout)).toContain(en['help.program.description'])
      expect(unwrap(result.stdout)).toContain(en['help.locale.summary'])
    })
  })

  test('--output json keeps code and messageKey stable while message follows the locale', async () => {
    await withTempDir(async (dir) => {
      const english = await runFailing(['diff', 'a', 'b', '--output', 'json'], dir, LOCALE_ENV)
      const translated = await runFailing(['diff', 'a', 'b', '--output', 'json'], dir, PSEUDO_ENV)

      // The machine contract: neither the error code nor the key moves with the
      // language, so a script or agent matching on either keeps working.
      expect(english.error.code).toBe('not_found')
      expect(translated.error.code).toBe(english.error.code)
      expect(english.error.messageKey).toBe('errors.resolveList.noLists')
      expect(translated.error.messageKey).toBe(english.error.messageKey)

      // The prose is the only part that moves.
      expect(english.error.message).toBe(en['errors.resolveList.noLists'])
      expect(translated.error.message).toBe(await pseudoText('errors.resolveList.noLists'))
    })
  })

  test('a card-cache gate words its advice in the CLI’s language', async () => {
    await withTempDir(async (dir) => {
      // An empty cache under `--refresh never`: the price command's own lead-in,
      // then the cache layer's shared remedy, both through the catalog.
      const result = await runCli(['price', '--refresh', 'never'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(1)
      const advice = (await pseudoText('cli.cacheGate.emptyAdvice')).replace(
        '{lead}',
        await pseudoText('cli.price.emptyCache'),
      )
      expect(unwrap(result.stderr)).toContain(unwrap(advice))
    })
  })

  test('a malformed cache-server address is refused in the CLI’s language', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['cache', 'status'], dir, {
        ...PSEUDO_ENV,
        RITUAL_CACHE_SERVER: 'localhost',
      })

      expect(result.exitCode).toBe(2)
      expect(unwrap(result.stderr)).toContain(
        unwrap(await pseudoText('cli.cacheServer.addressInvalid')),
      )
    })
  })

  test('exit codes are locale-invariant', async () => {
    await withTempDir(async (dir) => {
      const english = await runCli(['diff', 'a', 'b'], dir, LOCALE_ENV)
      const translated = await runCli(['diff', 'a', 'b'], dir, PSEUDO_ENV)

      expect(translated.exitCode).toBe(english.exitCode)
      expect(english.exitCode).not.toBe(0)
    })
  })

  test('import words a skipped line in the CLI’s language, and keeps --output json English', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'decklist.txt'), 'Lightning Bolt\n2 Mountain\n')
      const skipped = (await pseudoText('domain.import.text.malformedLine')).replace(
        '{line}',
        'Lightning Bolt',
      )

      const text = await runCli(
        ['import', 'decklist.txt', '--type', 'deck', '--no-input'],
        dir,
        PSEUDO_ENV,
      )
      expect(text.exitCode).toBe(1)
      expect(unwrap(text.stderr)).toContain(unwrap(skipped))

      // The payload is for scripts: English plus the key, whatever the CLI speaks.
      const json = await runCli(
        ['import', 'decklist.txt', '--type', 'deck', '--no-input', '--yes', '--output', 'json'],
        dir,
        PSEUDO_ENV,
      )
      expect(json.exitCode).toBe(1)
      const payload = JSON.parse(json.stdout) as { warnings: unknown[] }
      expect(payload.warnings).toEqual([
        {
          message: 'Skipped malformed line: Lightning Bolt',
          messageKey: 'domain.import.text.malformedLine',
          messageParams: { line: 'Lightning Bolt' },
        },
      ])
    })
  })

  test('import words a card-line diagnostic in the CLI’s language, its tree English for json', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'decklist.txt'), '1 Lightning Bolt [jp]\n2 Mountain\n')
      // The grammar's code, worded by the catalog: its sentence and its hint
      // both come out pseudo-localized, the tokens they quote untouched.
      const refusal = (await pseudoText('domain.card.line.unknownToken')).replace('{token}', '[jp]')
      const hint = (await pseudoText('domain.card.line.hint.didYouMean')).replace(
        '{language}',
        'ja',
      )

      const text = await runCli(
        ['import', 'decklist.txt', '--type', 'deck', '--no-input'],
        dir,
        PSEUDO_ENV,
      )
      expect(text.exitCode).toBe(1)
      expect(unwrap(text.stderr)).toContain(unwrap(refusal))
      expect(unwrap(text.stderr)).toContain(unwrap(hint))
      expect(text.stderr).not.toContain('Unrecognized token')

      const json = await runCli(
        ['import', 'decklist.txt', '--type', 'deck', '--no-input', '--yes', '--output', 'json'],
        dir,
        PSEUDO_ENV,
      )
      const payload = JSON.parse(json.stdout) as { warnings: unknown[] }
      expect(json.exitCode).toBe(1)
      expect(payload.warnings).toEqual([{ message: jpDiagnosticEnglish(1), ...jpDiagnosticAt(1) }])
    })
  })

  test('import words a CSV refusal in the CLI’s language, its key kept for json', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'cards.csv'), 'Name,Set\nSol Ring,C19\n')
      const args = ['import', 'cards.csv', '--type', 'deck', '--name', 'Cards']
      const spec = ['--deck-format', 'commander', '--columns', 'name=1,quantity=9']
      const forms = (await pseudo())['domain.import.csv.columnMissing']
      if (typeof forms !== 'object' || forms === null || !('other' in forms)) {
        throw new Error('domain.import.csv.columnMissing has no other form in en-XA')
      }
      const refusal = String(forms.other)
        .replace('{column}', '9')
        .replace('{field}', 'quantity')
        .replace('{count}', '2')

      const text = await runCli([...args, ...spec], dir, PSEUDO_ENV)
      expect(text.exitCode).toBe(2)
      expect(unwrap(text.stderr)).toContain(unwrap(refusal))

      const json = await runFailing([...args, ...spec, '--output', 'json'], dir, PSEUDO_ENV)
      expect(json.error.messageKey).toBe('domain.import.csv.columnMissing')
      expect(json.error).toMatchObject({
        messageParams: { column: 9, field: 'quantity', count: 2 },
      })
    })
  })

  test('import keeps a nested refusal’s params English in the json envelope', async () => {
    await withTempDir(async (dir) => {
      // An unparseable CSV: the parser's own refusal nests inside the command's.
      await fs.writeFile(path.join(dir, 'bad.csv'), 'Name\nSol Ring,"unclosed\n')
      const json = await runFailing(
        [
          'import',
          'bad.csv',
          '--type',
          'wanted',
          '--name',
          'Bad',
          '--columns',
          'name=1',
          '--output',
          'json',
        ],
        dir,
        PSEUDO_ENV,
      )
      expect(json.error.messageKey).toBe('cli.import.csvParseFailed')
      // The nested refusal is flattened to its English, like the key: invariant.
      expect(json.error).toMatchObject({
        messageParams: { reason: 'Unterminated quoted field starting on line 2' },
      })
      expect(unwrap(json.error.message)).toContain(
        unwrap((await pseudoText('domain.import.csv.unterminatedQuote')).replace('{line}', '2')),
      )
    })
  })

  test('import nests a deck service’s keyed failure, its English kept for json', async () => {
    // A stand-in deck service: any URL naming mtggoldfish.com is dispatched to
    // the MTGGoldfish importer, and this one answers every page with a 404.
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response('', { status: 404, statusText: 'Not Found' }),
    })
    try {
      await withTempDir(async (dir) => {
        const url = `http://127.0.0.1:${server.port}/mtggoldfish.com/deck/1`
        const json = await runFailing(
          ['import', url, '--no-input', '--sync-printings', '--quiet', '--output', 'json'],
          dir,
          PSEUDO_ENV,
        )
        expect(json.error.messageKey).toBe('cli.import.failed')
        expect(json.error).toMatchObject({
          messageParams: { reason: 'Failed to fetch MTGGoldfish page: 404 Not Found' },
        })
        const reason = (await pseudoText('domain.import.url.mtgGoldfishPageFailed'))
          .replace('{status}', '404')
          .replace('{statusText}', 'Not Found')
        expect(unwrap(json.error.message)).toContain(unwrap(reason))
      })
    } finally {
      await server.stop(true)
    }
  })

  test('import-changes prints a failed list’s reason in the CLI’s language', async () => {
    await withTempDir(async (dir) => {
      // The reason comes back from the admin save path as English plus its key;
      // text mode re-renders the key, so it is bracketed like the rest.
      const bundle = {
        format: 'ritual-change-bundle',
        version: 3,
        exportedAt: '2026-06-04T00:00:00.000Z',
        moves: [],
        lists: [
          {
            kind: 'wanted',
            slug: 'gone',
            name: 'Gone',
            changes: [{ id: 'a1', timestamp: 1, action: 'add', cardName: 'Brainstorm' }],
          },
        ],
      }
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(bundle))
      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(1)
      // The workspace holds no wanted lists at all, so the resolver says so.
      const forms = (await pseudo())['errors.resolveList.noListsOfType']
      if (typeof forms !== 'object' || forms === null || !('wanted' in forms)) {
        throw new Error('errors.resolveList.noListsOfType has no wanted branch in en-XA')
      }
      const reason = String(forms.wanted)
      expect(unwrap(result.stderr)).toContain(unwrap(reason))
    })
  })

  test('import-changes words an invalid bundle in the CLI’s language, key kept for json', async () => {
    await withTempDir(async (dir) => {
      // The validator returns a structured problem; the CLI words it — the move
      // it is about included — in its own language.
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(MALFORMED_MOVE_BUNDLE))
      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(2)
      const subject = (await pseudoText('domain.changes.subject.part'))
        .replace(
          '{subject}',
          (await pseudoText('domain.changes.subject.bundleMove')).replace('{move}', '1'),
        )
        .replace('{part}', 'from')
      const reason = (await pseudoText('domain.changes.problem.notObject')).replace(
        '{subject}',
        subject,
      )
      expect(unwrap(result.stderr)).toContain(unwrap(reason))

      const json = await runFailing(
        ['import-changes', 'edits.json', '--yes', '--output', 'json'],
        dir,
        PSEUDO_ENV,
      )
      expect(json.error.messageKey).toBe('cli.importChanges.invalidBundle')
      // Its `message` follows the CLI's language, reason included…
      expect(unwrap(json.error.message)).toContain(unwrap(reason))
      // The params are locale-invariant: the reason is the English sentence.
      expect(json.error).toMatchObject({
        messageParams: { reason: MALFORMED_MOVE_ENGLISH },
      })
    })
  })
  test('new words an unusable list name in the CLI’s language, its key kept for json', async () => {
    await withTempDir(async (dir) => {
      const refusal = (await pseudoText('domain.list.name.unusable')).replace('{name}', '???')
      const text = await runCli(['new', 'collection', '???'], dir, PSEUDO_ENV)
      expect(text.exitCode).toBe(2)
      expect(unwrap(text.stderr)).toContain(unwrap(refusal))

      const json = await runFailing(
        ['new', 'collection', '???', '--output', 'json'],
        dir,
        PSEUDO_ENV,
      )
      expect(json.error.code).toBe('usage_error')
      expect(json.error.messageKey).toBe('domain.list.name.unusable')
      expect(json.error.message).toBe(refusal)
    })
  })

  test('a cache ingest prints the Scryfall client’s lines in the CLI’s language', async () => {
    await withTempDir(async (dir) => {
      // A local cache feed: the one way to drive a real card-cache ingest
      // through the binary without reaching Scryfall.
      const feed = await serveCacheFeed()
      try {
        const result = await runCli(
          ['cache', 'feed', 'fetch', '--url', feed.url, '--no-p2p', '--no-seed'],
          dir,
          PSEUDO_ENV,
        )
        expect(result.exitCode).toBe(0)

        const output = unwrap(`${result.stdout}\n${result.stderr}`)
        expect(output).toContain(unwrap(await pseudoText('cli.scryfall.buildingTagIndex')))
        expect(output).toContain(unwrap(await pseudoText('cli.scryfall.feedIngestDone')))
        // A counted line, its singular form picked in the CLI's language.
        const processed = (await pseudo())['cli.scryfall.processedCards']
        if (typeof processed !== 'object' || processed === null || !('one' in processed)) {
          throw new Error('cli.scryfall.processedCards has no "one" form in en-XA')
        }
        expect(output).toContain(unwrap(String(processed.one).replace('{count}', '1')))
        // Vacuity guard: the English lines are not there.
        expect(output).not.toContain(en['cli.scryfall.feedIngestDone'])
      } finally {
        await feed.stop()
      }
    })
  })

  test('move names its lists in the CLI’s language while the changelog keeps them English', async () => {
    await withTempDir(async (dir) => {
      await writeWantedFile(dir, 'needs', { entries: [{ name: 'Demonic Tutor', cardId: 1 }] })
      await writeDeckFile(dir, 'target', {
        name: 'Target Deck',
        cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
      })
      const result = await runCli(
        ['move', 'Demonic', 'Tutor', '--from', 'wanted:needs', '--to', 'deck:target'],
        dir,
        PSEUDO_ENV,
      )
      expect(result.exitCode).toBe(0)

      // The success line names both lists through `domain.change.listRef`, so
      // each is bracketed like the sentence around it.
      const forms = (await pseudo())['domain.change.listRef']
      if (
        typeof forms !== 'object' ||
        forms === null ||
        !('wanted' in forms) ||
        !('deck' in forms)
      ) {
        throw new Error('domain.change.listRef has no wanted/deck branches in en-XA')
      }
      const from = String(forms.wanted).replace('{name}', 'needs')
      const to = String(forms.deck).replace('{name}', 'Target Deck')
      const output = unwrap(result.stdout)
      expect(output).toContain(unwrap(from))
      expect(output).toContain(unwrap(to))
      // Vacuity guard: the localized labels are not the English ones.
      expect(output).not.toContain("Wanted list 'needs'")

      // The persisted move lines keep the English labels, byte for byte.
      const sourceLog = await fs.readFile(path.join(dir, 'wanted', 'needs.changes.md'), 'utf-8')
      expect(sourceLog).toContain("to Deck 'Target Deck'")
      const targetLog = await fs.readFile(path.join(dir, 'decks', 'target.changes.md'), 'utf-8')
      expect(targetLog).toContain("from Wanted list 'needs'")
    })
  })

  test('a malformed ritual.config.json is refused in the CLI’s language', async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, 'ritual.config.json')
      await fs.writeFile(configPath, '[]\n')
      const result = await runCli(['lists'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(1)
      // The parser's reason nests as a message of its own, so both halves are
      // in the pseudo-locale.
      const refusal = (await pseudoText('domain.config.fileNotJson'))
        .replace('{path}', configPath)
        .replace('{reason}', await pseudoText('domain.config.fileNotObject'))
      expect(result.stderr).toContain(refusal)
    })
  })

  test('the uiLocale pre-read tolerates a file that does not parse, and the OS decides', async () => {
    await withTempDir(async (dir) => {
      // The broken file asks for the pseudo-locale, but a file that does not
      // parse cannot be read for it — and the boot-time pre-read must not fail
      // over it either: the loader's refusal is what reports it.
      const configPath = path.join(dir, 'ritual.config.json')
      await fs.writeFile(configPath, '{ "uiLocale": "en-XA", ')
      const noLocale = { ...LOCALE_ENV, RITUAL_LOCALE: undefined }

      // An environment naming no language: English.
      const english = await runCli(['lists'], dir, noLocale)
      expect(english.exitCode).toBe(1)
      expect(english.stderr).toStartWith('ritual.config.json is not valid JSON: ')

      // An environment naming the pseudo-locale: the refusal follows it.
      const detected = await runCli(['lists'], dir, { ...noLocale, LANG: 'en_XA.UTF-8' })
      expect(detected.exitCode).toBe(1)
      const prefix = (await pseudoText('domain.config.fileNotJson')).split('{path}')[0] ?? ''
      expect(prefix).not.toBe('')
      expect(detected.stderr).toStartWith(`${prefix}${configPath}`)
    })
  })

  test('an ignored RITUAL_LOCALE is warned about in the language that won, reason nested', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'ritual.config.json'), JSON.stringify({ uiLocale: PSEUDO }))
      const result = await runCli(['lists'], dir, { ...LOCALE_ENV, RITUAL_LOCALE: 'zz-ZZ' })

      const warning = (await pseudoText('cli.locale.envIgnored'))
        .replace('{variable}', 'RITUAL_LOCALE')
        .replace(
          '{error}',
          (await pseudoText('domain.config.uiLocaleUnknown')).replace('{tag}', 'zz-ZZ'),
        )
      expect(unwrap(result.stderr)).toContain(unwrap(warning))
    })
  })

  test('a field the config loader ignores is warned about in the file’s own language', async () => {
    await withTempDir(async (dir) => {
      // A file that parses is read for its `uiLocale` before it is loaded, so
      // the loader's warning about another field is already in that language.
      await fs.writeFile(
        path.join(dir, 'ritual.config.json'),
        JSON.stringify({ uiLocale: PSEUDO, searchDebounceMs: -1 }),
      )
      const result = await runCli(['lists'], dir, { ...LOCALE_ENV, RITUAL_LOCALE: undefined })

      const warning = (await pseudoText('domain.config.ignoringInvalid'))
        .replace('{field}', 'searchDebounceMs')
        .replace(
          '{reason}',
          (await pseudoText('domain.config.mustBeNonNegativeInteger')).replace(
            '{field}',
            'searchDebounceMs',
          ),
        )
      expect(unwrap(result.stderr)).toContain(unwrap(warning))
    })
  })

  test('a --base-dir that does not exist is refused in the CLI’s language', async () => {
    await withTempDir(async (dir) => {
      const missing = path.join(dir, 'nope')
      const result = await runCli(['lists', '--base-dir', missing], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(2)
      expect(unwrap(result.stderr)).toContain(
        unwrap((await pseudoText('cli.baseDir.missing')).replace('{path}', missing)),
      )
    })
  })

  test('export words a column refusal in the CLI’s language, the column ids untouched', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['export', '--all', '--columns', 'name,price'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(2)
      // The export engine returns a code; the CLI words it through the catalog.
      const [lead = ''] = (await pseudoText('domain.export.problem.columnUnknown'))
        .replace('{column}', 'price')
        .split('{columns}')
      expect(lead).not.toBe('')
      expect(unwrap(result.stderr)).toContain(unwrap(lead))
      expect(result.stderr).not.toContain('Unknown column')
      // The ids offered are what `--columns` takes, in any language.
      expect(result.stderr).toContain('collectorNumber')
    })
  })

  test('diff words a list’s unreadable line in the CLI’s language, English plus key for json', async () => {
    await withTempDir(async (dir) => {
      await writeWantedFile(dir, 'needs', { entries: [{ name: 'Demonic Tutor', cardId: 1 }] })
      await writeDeckFile(dir, 'target', {
        sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Demonic Tutor' }] }],
      })
      // A line the deck parser cannot read, appended by hand.
      await fs.appendFile(path.join(dir, 'decks', 'target.md'), '\nnot a card line\n')
      const args = ['diff', 'wanted:needs', 'deck:target']

      const text = await runCli(args, dir, PSEUDO_ENV)
      expect(text.exitCode).toBe(0)
      // The frame around the parser's own sentence comes from the catalog.
      const frame = (await pseudoText('domain.export.warning.inList')).split('{warning}')[0] ?? ''
      expect(frame).not.toBe('{list}: ')
      expect(unwrap(text.stderr)).toContain(unwrap(frame.replace('{list}', 'target')))

      // The payload is for scripts: English plus the key, whatever the CLI speaks.
      const json = await runCli([...args, '--output', 'json'], dir, PSEUDO_ENV)
      expect(json.exitCode).toBe(0)
      const payload = JSON.parse(json.stdout) as { warnings: Record<string, unknown>[] }
      expect(payload.warnings).toHaveLength(1)
      expect(payload.warnings[0]).toMatchObject({
        messageKey: 'domain.export.warning.inList',
        // The deck parser's own message nests keyed, its English kept.
        messageParams: {
          list: 'target',
          warning: {
            messageKey: 'domain.import.text.malformedLine',
            messageParams: { line: 'not a card line' },
          },
        },
      })
      expect(String(payload.warnings[0]?.message)).toStartWith('target: ')
      expect(String(payload.warnings[0]?.message)).toContain('not a card line')
    })
  })

  test('config set words a refusal in the CLI’s language, its params English for json', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['config', 'set', 'decksDir', 'a', 'b', '--output', 'json'],
        dir,
        PSEUDO_ENV,
      )
      expect(result.exitCode).toBe(2)
      const json = JSON.parse(result.stderr) as ErrorEnvelopeJson
      expect(json.error.code).toBe('usage_error')
      expect(json.error.messageKey).toBe('cli.config.tooManyValues')
      // The nested type name is flattened to its English, like the key.
      expect(json.error).toMatchObject({
        messageParams: { property: 'decksDir', typeName: 'string', count: 2 },
      })
      const forms = (await pseudo())['cli.config.tooManyValues']
      if (typeof forms !== 'object' || forms === null || !('other' in forms)) {
        throw new Error('cli.config.tooManyValues has no other form in en-XA')
      }
      const typeNames = (await pseudo())['cli.config.fieldType']
      if (typeof typeNames !== 'object' || typeNames === null || !('string' in typeNames)) {
        throw new Error('cli.config.fieldType has no string branch in en-XA')
      }
      expect(json.error.message).toBe(
        String(forms.other)
          .replace('{property}', 'decksDir')
          .replace('{typeName}', String(typeNames.string))
          .replace('{count}', '2'),
      )
    })
  })
})
