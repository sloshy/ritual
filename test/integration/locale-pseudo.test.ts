import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCALE_ENV, ensureBinary, repoRoot, runCli, withTempDir } from './helpers/cli'
import { spawnCacheServer, spawnFeedHost } from './helpers/cache-server'
import { en } from '../../src/i18n/messages/en'
import { MALFORMED_MOVE_BUNDLE, MALFORMED_MOVE_ENGLISH } from '../helpers/change-problem'
import type { LocaleCatalog } from '../../src/i18n/types'
import { writeDeckFile, writeWantedFile } from '../helpers/workspace'
import { jpDiagnosticAt, jpDiagnosticEnglish } from '../helpers/card-line'
import { buildCacheFeed, type FeedArtifact } from '../helpers/cache-feed'
import { bulkCard, gzipJsonLines, makeScryfallCard } from '../test-utils'
import { seedCardCache } from './helpers/seed'
import { OFFLINE_ENV } from './helpers/offline-env'
import { serveBulkUpstream } from './helpers/scryfall-bulk'

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

/** One branch of a `$select` / `$plural` message in the pseudo catalog. */
async function pseudoBranch(key: string, branch: string): Promise<string> {
  const value = (await pseudo())[key]
  if (typeof value !== 'object' || value === null || !(branch in value)) {
    throw new Error(`${key} has no ${branch} branch in the ${PSEUDO} catalog`)
  }
  return String((value as Record<string, unknown>)[branch])
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

/**
 * A `--deny-http` cache server's answer to a price it would have to download:
 * English with its key, whatever the server's language.
 */
const DENIED_PRICE = {
  status: 500,
  body: {
    success: false,
    message: en['domain.cache.serverReply.httpDenied'],
    messageKey: 'domain.cache.serverReply.httpDenied',
  },
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

/** `cache feed host` flags for a test: a local upstream, a feed dir, no BitTorrent. */
function feedHostArgs(bulkApiUrl: string, feedDir: string, ...extra: string[]): string[] {
  return ['--no-seed', '--upstream', bulkApiUrl, '--dir', feedDir, ...extra]
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

  test('a malformed --locale is refused in RITUAL_LOCALE’s language, not English', async () => {
    await withTempDir(async (dir) => {
      // The pre-scan reads the bad flag before Commander rejects it; it must
      // fall through to the variable rather than shadow it, or the refusal
      // below comes out in English.
      const result = await runCli(['--locale', 'de_DE', 'lists'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(2)
      // The frame, then the flag parser's own reason (its nested tag-parser
      // reason included) — every part in the variable's language.
      const frame = (await pseudoText('help.commander.invalidOptionArgument'))
        .replace('{flags}', '--locale <tag>')
        .replace('{value}', 'de_DE')
      const reason = (await pseudoText('domain.config.uiLocaleMalformed')).replace(
        '{reason}',
        (await pseudoText('errors.i18n.localeTag.invalid')).replace('{value}', 'de_DE'),
      )
      expect(unwrap(result.stderr)).toContain(`${frame} ${reason}`)
      expect(result.stderr).not.toContain('is invalid')
      expect(result.stderr).not.toContain('invalid locale tag')
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

  test('a cache server logs in its own language and answers in English with the key', async () => {
    await withTempDir(async (dir) => {
      const server = await spawnCacheServer({
        cwd: dir,
        args: ['--deny-http', '--verbose'],
        env: PSEUDO_ENV,
      })
      let elsewhere: unknown
      let price: unknown
      let log: string
      try {
        const answer = async (route: string): Promise<unknown> => {
          const response = await fetch(`${server.url}${route}`, {
            signal: AbortSignal.timeout(5000),
          })
          return { status: response.status, body: (await response.json()) as unknown }
        }
        elsewhere = await answer('/elsewhere')
        // A price the empty cache does not hold needs a download --deny-http refuses.
        price = await answer('/cache/prices/Sol%20Ring:usd')
      } finally {
        log = (await server.stop()).stdout
      }

      // The replies go to another Ritual process, whatever this server's language.
      expect(elsewhere).toEqual({
        status: 404,
        body: {
          success: false,
          message: en['domain.cache.serverReply.notFound'],
          messageKey: 'domain.cache.serverReply.notFound',
        },
      })
      expect(price).toEqual(DENIED_PRICE)
      // The operator log is this server's, read in its language behind the
      // untranslated `[cache-server]` marker; the access log is machine fields.
      expect(log).toContain(`[cache-server] ${await pseudoText('cli.cacheServer.httpDenied')}`)
      expect(log).toContain(
        (await pseudoText('cli.cacheServer.listening')).replace('{url}', server.url),
      )
      expect(log).toMatch(
        /^\[cache-server\] method=GET path=\/elsewhere status=404 durationMs=\d+$/m,
      )
    })
  }, 20000)

  test('a feed host logs in its own language and answers in English with the key', async () => {
    await withTempDir(async (dir) => {
      const upstream = serveBulkUpstream()
      let elsewhere: unknown
      let log: string
      try {
        // No seeding: the HTTP side is what this pins, and BitTorrent stays out of it.
        const host = await spawnFeedHost({
          cwd: dir,
          args: feedHostArgs(upstream.bulkApiUrl, path.join(dir, 'feed'), '--verbose'),
          env: PSEUDO_ENV,
        })
        try {
          const response = await fetch(`${host.url}/elsewhere`, {
            signal: AbortSignal.timeout(5000),
          })
          elsewhere = { status: response.status, body: (await response.json()) as unknown }
        } finally {
          log = (await host.stop()).stdout
        }
      } finally {
        await upstream.stop()
      }

      // The reply goes to another program, whatever this host's language.
      expect(elsewhere).toEqual({
        status: 404,
        body: {
          success: false,
          message: en['domain.cache.feedReply.notFound'],
          messageKey: 'domain.cache.feedReply.notFound',
        },
      })
      // The operator log is the host's, in its language behind the untranslated
      // `[cache-feed]` marker: a counted line takes the plural's branch.
      expect(log).toContain(
        `[cache-feed] ${(await pseudoBranch('cli.cacheFeed.published', 'other')).replace('{count}', '3')}`,
      )
      expect(log).toContain(`[cache-feed] ${await pseudoText('cli.cacheFeed.seedingDisabled')}`)
      // The access log is machine fields, never words.
      expect(log).toMatch(/^\[cache-feed\] method=GET path=\/elsewhere status=404 durationMs=\d+$/m)
    })
  }, 30000)

  test('a feed host that cannot reach Scryfall nests the reason in its own language', async () => {
    await withTempDir(async (dir) => {
      const feedDir = path.join(dir, 'feed')
      // Scryfall's manifest answers 503: the host's first refresh fails.
      const down = serveBulkUpstream({
        manifestStatus: { status: 503, statusText: 'Service Unavailable' },
      })
      const up = serveBulkUpstream()
      const reason = (await pseudoText('domain.cache.refresh.manifestFailed'))
        .replace('{status}', '503')
        .replace('{statusText}', 'Service Unavailable')
      try {
        // With no feed to fall back on, the host exits 1.
        const first = await runCli(
          ['cache', 'feed', 'host', '--port', '45998', ...feedHostArgs(down.bulkApiUrl, feedDir)],
          dir,
          PSEUDO_ENV,
        )
        expect(first.exitCode).toBe(1)
        expect(first.stderr).toContain(
          `[cache-feed] ${(await pseudoText('cli.cacheFeed.initialFeedFailed')).replace('{error}', reason)}`,
        )
        expect(first.stderr).not.toContain('Failed to fetch bulk manifest')

        // With a feed published before, it keeps serving it and says why.
        const seeded = await spawnFeedHost({
          cwd: dir,
          args: feedHostArgs(up.bulkApiUrl, feedDir),
          env: PSEUDO_ENV,
        })
        await seeded.stop()
        const fallback = await spawnFeedHost({
          cwd: dir,
          args: feedHostArgs(down.bulkApiUrl, feedDir),
          env: PSEUDO_ENV,
        })
        const log = (await fallback.stop()).stdout
        expect(log).toContain(
          `[cache-feed] ${(await pseudoText('cli.cacheFeed.refreshFailed')).replace('{reason}', reason)}`,
        )
        expect(log).not.toContain('Failed to fetch bulk manifest')
      } finally {
        await Promise.all([down.stop(), up.stop()])
      }
    })
  }, 60000)

  test('a cache server flag conflict is refused in the CLI’s language', async () => {
    await withTempDir(async (dir) => {
      // `--deny-http` and a spare port: a regression that started the server
      // anyway must neither reach the network nor take the default port.
      const result = await runCli(
        [
          'cache',
          'server',
          '--deny-http',
          '--port',
          '45999',
          '--cache-source',
          'scryfall',
          '--url',
          'https://feed.example/feed.json',
        ],
        dir,
        PSEUDO_ENV,
      )

      expect(result.exitCode).toBe(2)
      expect(unwrap(result.stderr)).toContain(
        unwrap(await pseudoText('cli.cache.feedUrlNeedsFeedSource')),
      )
    })
  })

  test('sell words a missing buylist in the CLI’s language, its params English for json', async () => {
    await withTempDir(async (dir) => {
      // A card cache, so the run reaches the buylist gate; no Card Kingdom feed.
      await seedCardCache(dir, { 'Sol Ring': [makeScryfallCard({ name: 'Sol Ring' })] })
      const args = ['sell', '--refresh', 'never']

      const text = await runCli(args, dir, { ...PSEUDO_ENV, ...OFFLINE_ENV })
      expect(text.exitCode).toBe(1)
      // The lead sentence nests, and the flag and size are params the
      // translation cannot touch.
      const advice = (await pseudoText('domain.cache.cardKingdom.missingAdvice'))
        .replace('{lead}', await pseudoText('domain.cache.cardKingdom.noFeed'))
        .replace('{flag}', '--refresh auto')
        .replace('{size}', '70')
      expect(unwrap(text.stderr)).toContain(unwrap(advice))
      expect(text.stderr).not.toContain('Re-run with')

      const json = await runFailing([...args, '--output', 'json'], dir, {
        ...PSEUDO_ENV,
        ...OFFLINE_ENV,
      })
      expect(json.error.code).toBe('runtime_error')
      expect(json.error.messageKey).toBe('domain.cache.cardKingdom.missingAdvice')
      // A script re-renders the key from params flattened to English.
      expect(json.error).toMatchObject({
        messageParams: {
          lead: en['domain.cache.cardKingdom.noFeed'],
          flag: '--refresh auto',
          size: 70,
        },
      })
      // The envelope's message follows the CLI's language; only the key and
      // params are invariant.
      expect(unwrap(json.error.message)).toBe(unwrap(advice))

      // `price` reaches the same gate for the Card Kingdom store.
      const price = await runFailing(
        ['price', '--source', 'cardkingdom', '--refresh', 'never', '--output', 'json'],
        dir,
        { ...PSEUDO_ENV, ...OFFLINE_ENV },
      )
      expect(price.error.messageKey).toBe('domain.cache.cardKingdom.missingAdvice')
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

  test('self-update words a --tag that is not a release in the CLI’s language', async () => {
    await withTempDir(async (dir) => {
      // The tag parser's own refusal is the reason Commander's frame quotes.
      const result = await runCli(['self-update', '--tag', 'nightly'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(2)
      const frame = (await pseudoText('help.commander.invalidOptionArgument'))
        .replace('{flags}', '--tag <tag>')
        .replace('{value}', 'nightly')
      const reason = (await pseudoText('cli.selfUpdate.error.invalidTag')).replace(
        '{tag}',
        'nightly',
      )
      expect(unwrap(result.stderr)).toContain(unwrap(`${frame} ${reason}`))
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

  test('detect-changes --hash-only words its dry-run lines in the CLI’s language, the payload untouched', async () => {
    await withTempDir(async (dir) => {
      await writeDeckFile(dir, 'pseudo', {
        sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }],
      })
      const file = path.join('decks', 'pseudo.md')
      const args = ['detect-changes', '--hash-only', '--dry-run']

      const text = await runCli(args, dir, PSEUDO_ENV)
      expect(text.exitCode).toBe(0)
      // The path and the digest are data; the frame around them is the catalog's.
      const [lead = ''] = (await pseudoBranch('cli.detectChanges.hashLine', 'dryRun'))
        .replace('{file}', file)
        .split('{hash}')
      expect(lead).not.toBe(`${file}: `)
      expect(text.stdout).toContain(lead)
      expect(text.stdout).not.toContain(`[dry-run] ${file}`)
      const count = (await pseudoBranch('domain.count.files', 'one')).replace('{count}', '1')
      const summary = (await pseudoBranch('cli.detectChanges.stamped', 'dryRun')).replace(
        '{count}',
        count,
      )
      expect(text.stdout).toContain(summary)

      // The payload carries no prose: the same bytes whatever the CLI speaks.
      const english = await runCli([...args, '--output', 'json'], dir, LOCALE_ENV)
      const translated = await runCli([...args, '--output', 'json'], dir, PSEUDO_ENV)
      expect(english.exitCode).toBe(0)
      expect(translated.exitCode).toBe(0)
      const payload: unknown = JSON.parse(english.stdout)
      expect(payload).toMatchObject({ mode: 'hash-only', dryRun: true, stamped: [{ file }] })
      expect(JSON.parse(translated.stdout)).toEqual(payload)
    })
  })

  describe('export joins conflicting flags the way the CLI’s language lists them', () => {
    const TWO = ['--columns', 'name', '--no-header']
    const THREE = [...TWO, '--quote-all']
    const DE_ENV: Record<string, string | undefined> = { ...LOCALE_ENV, RITUAL_LOCALE: 'de' }
    const frame = en['cli.export.formatFlagConflict']

    /** The refusal `export --format text` prints for these flags, under `env`. */
    async function refusalFor(
      flags: string[],
      env: Record<string, string | undefined>,
    ): Promise<string> {
      let stderr = ''
      await withTempDir(async (dir) => {
        const result = await runCli(['export', '--all', '--format', 'text', ...flags], dir, env)
        expect(result.exitCode).toBe(2)
        stderr = unwrap(result.stderr)
      })
      return stderr
    }

    test.each([
      ['two flags', TWO, '--columns and --no-header'],
      ['three flags', THREE, '--columns, --no-header, and --quote-all'],
    ])('in English, %s', async (_name, flags, joined) => {
      const stderr = await refusalFor(flags, LOCALE_ENV)
      expect(stderr).toContain(
        unwrap(frame.replace('{flags}', joined).replaceAll('{format}', 'text')),
      )
    })

    test.each([
      ['two flags', TWO, '--columns und --no-header'],
      ['three flags', THREE, '--columns, --no-header und --quote-all'],
    ])('in German, which has no dictionary, %s', async (_name, flags, joined) => {
      // No German catalog: the frame stays English, but the list is German's.
      const stderr = await refusalFor(flags, DE_ENV)
      expect(stderr).toContain(
        unwrap(frame.replace('{flags}', joined).replaceAll('{format}', 'text')),
      )
    })

    test('in the pseudo-locale, the frame is the catalog’s and the flags stay as typed', async () => {
      const stderr = await refusalFor(THREE, PSEUDO_ENV)
      const expected = (await pseudoText('cli.export.formatFlagConflict'))
        .replace('{flags}', '--columns, --no-header, and --quote-all')
        .replaceAll('{format}', 'text')
      expect(stderr).toContain(unwrap(expected))
    })
  })

  test('a --no-input refusal is worded in the CLI’s language, its envelope params English', async () => {
    await withTempDir(async (dir) => {
      await writeDeckFile(dir, 'pseudo', {
        sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }],
      })
      const json = await runFailing(['delete', 'deck:pseudo', '--output', 'json'], dir, PSEUDO_ENV)
      expect(json.error.code).toBe('usage_error')
      expect(json.error.messageKey).toBe('errors.input.required')
      // The non-TTY spawn is the reason; both nested parts flatten to English.
      expect(json.error).toMatchObject({
        messageParams: {
          subject: 'pass --confirm <name>',
          reason: en['cli.prompt.reason.noTty'],
        },
      })
      const subject = (await pseudoText('cli.prompt.subject.pass')).replace(
        '{what}',
        '--confirm <name>',
      )
      expect(json.error.message).toBe(
        (await pseudoText('errors.input.required'))
          .replace('{subject}', subject)
          .replace('{reason}', await pseudoText('cli.prompt.reason.noTty')),
      )
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
