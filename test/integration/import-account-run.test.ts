import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  registerImportAccountCommand,
  type ImportAccountDeps,
} from '../../src/commands/import-account'
import { describeRateLimitWait } from '../../src/sync/common'
import type { SyncMessage } from '../../src/sync/message'
import {
  pseudoCatalog,
  pseudoPlural,
  pseudoString,
  withGuardedLocaleAsync,
} from '../helpers/sync-text'
import {
  ArchidektClient,
  type ArchidektDeckList,
  type ArchidektDeckSimple,
} from '../../src/clients/ArchidektClient'
import type { DeckData, ImportedDeck } from '../../src/list/deck'
import { ExitCode } from '../../src/util/errors'
import { setNoInputOverride } from '../../src/util/no-input'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { captureConsole, captureStream } from '../helpers/capture'
import { captureExitCode } from '../helpers/cli'

/**
 * `import-account` past its flag validation, driven in-process with an injected
 * Archidekt client.
 *
 * The spawned-CLI suite (`import-account-cli.test.ts`) covers the flag and
 * usage-error surface, which resolves before any request. What only this layer
 * reaches is everything after the fetch: the no-decks message, the structured
 * payload's counts, the per-deck statuses, and the dry-run mapping — all of
 * which used to be untestable because the command built its client inline.
 */

/** A stand-in for the deck-fetching subset of `ArchidektClient` the command uses. */
type FakeClientOptions = {
  decks: ArchidektDeckSimple[]
  /** Deck payload per Archidekt deck id; a missing id throws, i.e. a failed deck. */
  decksById?: Record<string, DeckData>
  /** Category names the source states that Ritual refuses, for every deck. */
  refusedCategories?: string[]
}

function fakeClient(options: FakeClientOptions): ArchidektClient {
  const client = {
    fetchPublicDecks: async (): Promise<ArchidektDeckList> => ({ decks: options.decks }),
    fetchOwnDecks: async (): Promise<ArchidektDeckList> => ({ decks: options.decks }),
    fetchImportedDeck: async (deckId: string): Promise<ImportedDeck> => {
      const deck = options.decksById?.[deckId]
      if (deck === undefined) throw new Error(`Deck ${deckId} is private`)
      return { deck, categories: [], refusedCategories: options.refusedCategories ?? [] }
    },
  }
  return client as unknown as ArchidektClient
}

function listedDeck(id: number, name: string): ArchidektDeckSimple {
  return { id, name, updatedAt: '2026-01-01', deckFormat: 3, owner: { username: 'someuser' } }
}

function deckData(name: string): DeckData {
  return { name, sections: [{ name: 'Main', cards: [{ quantity: 4, name: 'Mountain' }] }] }
}

/** What one `import-account` run wrote, and the exit code it set. */
type RunOutput = { stdout: string; stderr: string; exitCode: number }

/**
 * Run `import-account` with an injected client, capturing what it wrote.
 *
 * The console rather than a `MemoryLogger`: the action installs its own
 * scripting logger over whatever is current, and that logger reports through
 * `console.warn`/`console.error`. The payload goes to `process.stdout`, which
 * Bun's `console` does not route through — hence the two nested captures.
 */
async function run(client: ArchidektClient, argv: string[]): Promise<RunOutput> {
  return runWith(() => client, argv)
}

/** {@link run}, building the client through the command's own `createClient` seam. */
async function runWith(
  createClient: NonNullable<ImportAccountDeps['createClient']>,
  argv: string[],
): Promise<RunOutput> {
  const program = new Command()
  program.exitOverride()
  registerImportAccountCommand(program, { createClient })
  let reported: string[] = []
  let exitCode = 0
  const stdout = await captureStream('stdout', async () => {
    exitCode = await captureExitCode(async () => {
      reported = (
        await captureConsole(['warn', 'error'], () =>
          program.parseAsync(['node', 'ritual', 'import-account', ...argv]),
        )
      ).all
    })
  })
  return { stdout, stderr: reported.map((line) => `${line}\n`).join(''), exitCode }
}

describe('import-account past its flag validation (Integration)', () => {
  let workspace: BoundWorkspace
  beforeEach(async () => {
    workspace = await bindWorkspace()
    // The global `--no-input` flag lives on the root program, not the
    // subcommand; set the value it would resolve to directly.
    setNoInputOverride(true)
  })

  afterEach(async () => {
    setNoInputOverride(undefined)
    await workspace.dispose()
  })

  test('an account with no decks says so, without claiming the user is unknown', async () => {
    const { stdout, stderr } = await run(fakeClient({ decks: [] }), [
      'someuser',
      '--all',
      '--output',
      'json',
    ])

    // Archidekt cannot distinguish an unknown user from one with no public
    // decks, so the message must name both rather than guess.
    expect(stderr).toContain('No public decks found')
    expect(stderr).toContain('does not distinguish an unknown user')
    type Payload = { username: string; found: number; selected: number; decks: unknown[] }
    const payload = JSON.parse(stdout) as Payload
    expect(payload).toMatchObject({ username: 'someuser', found: 0, selected: 0, decks: [] })
  })

  test('the structured payload counts imported and failed decks separately', async () => {
    const client = fakeClient({
      decks: [listedDeck(1, 'Burn'), listedDeck(2, 'Private One')],
      decksById: { '1': deckData('Burn') },
    })

    const { stdout, exitCode: exit } = await run(client, ['someuser', '--all', '--output', 'json'])

    type DeckResult = { id: number; status: string; action?: string; error?: string }
    type Payload = {
      found: number
      selected: number
      imported: number
      failed: number
      skipped: number
      dryRun: boolean
      decks: DeckResult[]
    }
    const payload = JSON.parse(stdout) as Payload
    expect(payload).toMatchObject({
      found: 2,
      selected: 2,
      imported: 1,
      failed: 1,
      skipped: 0,
      dryRun: false,
    })
    expect(payload.decks[0]).toMatchObject({ id: 1, status: 'imported', action: 'created' })
    expect(payload.decks[1]).toMatchObject({ id: 2, status: 'failed' })
    // A partial run must not look clean to a script.
    expect(exit).toBe(ExitCode.RuntimeError)
    expect(await Bun.file(path.join(workspace.dir, 'decks', 'Burn.md')).exists()).toBeTrue()
  })

  test('a deck’s advisories and error are English plus their keys in the payload', async () => {
    // A conflict on one deck (its file is already there) and refused category
    // names on the other: both reach the payload as message triples.
    await fs.mkdir(path.join(workspace.dir, 'decks'), { recursive: true })
    await fs.writeFile(path.join(workspace.dir, 'decks', 'Burn.md'), '# Burn\n\n## Main\n')
    const client = fakeClient({
      decks: [listedDeck(1, 'Burn'), listedDeck(2, 'Ramp')],
      decksById: { '1': deckData('Burn'), '2': deckData('Ramp') },
      refusedCategories: ['Mana, Rocks'],
    })

    const { stdout } = await run(client, ['someuser', '--all', '--output', 'json'])

    type Payload = { decks: Record<string, unknown>[] }
    const [burn, ramp] = (JSON.parse(stdout) as Payload).decks
    expect(burn).toMatchObject({
      status: 'failed',
      error: "Import conflict for 'Burn.md'. Re-run with --overwrite or --yes to replace it.",
      errorKey: 'cli.import.conflict',
      errorParams: { target: 'Burn.md' },
    })
    expect(ramp).toMatchObject({
      status: 'imported',
      advisories: [
        {
          message:
            'Skipped categories Ritual cannot store (a category is non-empty plain text that cannot contain a comma or a control character): "Mana, Rocks"',
          messageKey: 'domain.import.categoriesRefused',
          messageParams: { names: { list: ['"Mana, Rocks"'], join: 'unit' } },
        },
      ],
    })
  })

  test('--no-sync-printings strips the printings Archidekt states', async () => {
    const foilDeck: DeckData = {
      name: 'Foil Deck',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'foil' },
          ],
        },
      ],
    }
    await run(fakeClient({ decks: [listedDeck(1, 'Foil Deck')], decksById: { '1': foilDeck } }), [
      'someuser',
      '--all',
      '--no-sync-printings',
    ])
    const onDisk = await fs.readFile(path.join(workspace.dir, 'decks', 'Foil Deck.md'), 'utf-8')
    expect(onDisk).toContain('1 Sol Ring &1')
    expect(onDisk).not.toContain('LTC')
    expect(onDisk).not.toContain('[foil]')
  })

  test('under --no-input with neither flag, the printings are kept and it says so', async () => {
    const foilDeck: DeckData = {
      name: 'Foil Deck',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'foil' },
          ],
        },
      ],
    }
    const { stderr } = await run(
      fakeClient({ decks: [listedDeck(1, 'Foil Deck')], decksById: { '1': foilDeck } }),
      ['someuser', '--all'],
    )
    // The whole suite runs under setNoInputOverride(true), so this is the
    // defaulted path; the run must say the choice was defaulted, not chosen.
    expect(stderr).toContain('Keeping the exact printings the source lists')
    const onDisk = await fs.readFile(path.join(workspace.dir, 'decks', 'Foil Deck.md'), 'utf-8')
    expect(onDisk).toContain('1 Sol Ring (LTC:284) [foil] &1')
  })

  test('a dry run reports `planned` and writes nothing', async () => {
    const client = fakeClient({
      decks: [listedDeck(1, 'Burn')],
      decksById: { '1': deckData('Burn') },
    })

    const { stdout } = await run(client, ['someuser', '--all', '--dry-run', '--output', 'json'])

    type Payload = { dryRun: boolean; imported: number; decks: { status: string }[] }
    const payload = JSON.parse(stdout) as Payload
    // `planned` still counts as imported, so a preview's totals match the real run's.
    expect(payload).toMatchObject({ dryRun: true, imported: 1 })
    expect(payload.decks[0]?.status).toBe('planned')
    expect(await fs.readdir(path.join(workspace.dir, 'decks'))).toEqual([])
  })

  test('an existing deck without --overwrite is a usage error, reported per deck', async () => {
    const client = fakeClient({
      decks: [listedDeck(1, 'Burn')],
      decksById: { '1': deckData('Burn') },
    })
    await run(client, ['someuser', '--all', '--output', 'json'])

    const { stdout, exitCode: exit } = await run(client, ['someuser', '--all', '--output', 'json'])

    type Payload = { failed: number; decks: { status: string; error?: string }[] }
    const payload = JSON.parse(stdout) as Payload
    expect(payload.failed).toBe(1)
    expect(payload.decks[0]?.error).toContain('--overwrite')
    // A conflict is a usage error, not a runtime one — the exit code says which.
    expect(exit).toBe(ExitCode.UsageError)
  })

  /** A real client over `fetch`, unpaced — what `createClient` builds in production, minus the network. */
  function clientAnswering(
    fetch: (url: string | URL) => Promise<Response>,
  ): (onWait: (message: SyncMessage) => void) => ArchidektClient {
    return (onWait) =>
      new ArchidektClient(
        { fetch },
        { minRequestIntervalMs: 0, onRateLimitWait: (wait) => onWait(describeRateLimitWait(wait)) },
      )
  }

  /** A deck listing that keeps linking to the page it already served. */
  const REPEATING_LIST = async (url: string | URL): Promise<Response> =>
    String(url).includes('/api/decks/v3/')
      ? Response.json({
          results: [{ id: 1, name: 'Burn', deckFormat: 3 }],
          next: 'https://archidekt.com/api/decks/v3/?ownerUsername=someuser&page=2',
        })
      : new Response('{"detail":"Not found."}', { status: 404 })

  test('a deck list Archidekt cut short is listIncomplete in the payload, and said on stderr', async () => {
    const { stdout, stderr } = await runWith(clientAnswering(REPEATING_LIST), [
      'someuser',
      '--all',
      '--dry-run',
      '--output',
      'json',
    ])

    const payload = JSON.parse(stdout) as Record<string, unknown>
    const cutShort = {
      message:
        'Archidekt served a next-page link it had already served (https://archidekt.com/api/decks/v3/?ownerUsername=someuser&page=2); stopped after 2 decks.',
      messageKey: 'domain.sync.archidekt.pageRepeated',
      messageParams: {
        url: 'https://archidekt.com/api/decks/v3/?ownerUsername=someuser&page=2',
        decks: { messageKey: 'domain.count.decks', messageParams: { count: 2 } },
      },
    }
    expect(payload).toMatchObject({ found: 2, listIncomplete: cutShort })
    expect(stderr).toContain(cutShort.message)
  })

  test('under another UI language the stderr line follows it, and the payload stays English', async () => {
    const { stdout, stderr } = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
      runWith(clientAnswering(REPEATING_LIST), [
        'someuser',
        '--all',
        '--dry-run',
        '--output',
        'json',
      ]),
    )

    const payload = JSON.parse(stdout) as { listIncomplete?: SyncMessage }
    expect(payload.listIncomplete?.message).toStartWith('Archidekt served a next-page link')
    const decks = pseudoPlural('domain.count.decks').replace('{count}', '2')
    expect(stderr).toContain(
      pseudoString('domain.sync.archidekt.pageRepeated')
        .replace('{url}', 'https://archidekt.com/api/decks/v3/?ownerUsername=someuser&page=2')
        .replace('{decks}', decks),
    )
  })

  test('a deck Archidekt fails to serve is a failed deck, keyed', async () => {
    const fetch = async (url: string | URL): Promise<Response> =>
      String(url).includes('/api/decks/v3/')
        ? Response.json({ results: [{ id: 1, name: 'Burn' }], next: null })
        : new Response('{"detail":"Not found."}', { status: 404 })

    const { stdout } = await runWith(clientAnswering(fetch), [
      'someuser',
      '--all',
      '--output',
      'json',
    ])

    type Payload = { decks: Record<string, unknown>[] }
    expect((JSON.parse(stdout) as Payload).decks[0]).toEqual({
      id: 1,
      name: 'Burn',
      status: 'failed',
      error: 'Failed to fetch Archidekt deck 1 (HTTP 404): Not found.',
      errorKey: 'domain.sync.archidekt.deckFailedWithReason',
      errorParams: { deckId: '1', status: 404, reason: 'Not found.' },
    })
  })

  test('a deck list Archidekt fails to serve is a keyed runtime error', async () => {
    const client = new ArchidektClient(
      { fetch: async () => new Response('{"detail":"Service unavailable."}', { status: 503 }) },
      { minRequestIntervalMs: 0 },
    )

    let exit = 0
    const stderr = await captureStream('stderr', async () => {
      exit = (await run(client, ['someuser', '--all', '--output', 'json'])).exitCode
    })

    expect(JSON.parse(stderr)).toEqual({
      error: {
        code: 'runtime_error',
        message:
          'Failed to fetch the public decks of Archidekt user someuser (HTTP 503): Service unavailable.',
        messageKey: 'domain.sync.archidekt.publicDecksFailedWithReason',
        messageParams: { username: 'someuser', status: 503, reason: 'Service unavailable.' },
      },
    })
    expect(exit).toBe(ExitCode.RuntimeError)
  })
})
