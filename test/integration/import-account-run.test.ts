import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import { registerImportAccountCommand } from '../../src/commands/import-account'
import type { ArchidektClient, ArchidektDeckSimple } from '../../src/clients/ArchidektClient'
import type { DeckData } from '../../src/list/deck'
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
}

function fakeClient(options: FakeClientOptions): ArchidektClient {
  const client = {
    fetchPublicDecks: async (): Promise<ArchidektDeckSimple[]> => options.decks,
    fetchOwnDecks: async (): Promise<ArchidektDeckSimple[]> => options.decks,
    fetchDeck: async (deckId: string): Promise<DeckData> => {
      const deck = options.decksById?.[deckId]
      if (deck === undefined) throw new Error(`Deck ${deckId} is private`)
      return deck
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
  const program = new Command()
  program.exitOverride()
  registerImportAccountCommand(program, { createClient: () => client })
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
})
