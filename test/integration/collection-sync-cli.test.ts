import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Command } from 'commander'
import { cardCache } from '../../src/cache'
import { scryfallIdIndex } from '../../src/cache/scryfall-id-index'
import { registerCollectionSyncCommand } from '../../src/commands/collection-sync'
import type { ArchidektCollectionRecord } from '../../src/importers/archidekt-collection'
import { MemoryLogger, resetLogger, setLogger } from '../../src/logger'
import { reloadRitualConfig } from '../../src/ritual-config'
import { collectionPage, record } from '../unit/collection-sync/fixtures'
import {
  BOLT,
  BULK_URL,
  COLLECTION_URL,
  seedCollectionCardCache,
  SEARCH_URL,
  signIn,
  SOL_RING,
  stubArchidekt,
  TEST_ACCOUNT,
  uploadedCsvRows,
  UPLOAD_URL,
  UPSERT_URL,
  type StubbedRequest,
  type StubRoute,
  seededScryfallId,
} from './helpers/archidekt'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import {
  bindWorkspace,
  createWorkspace,
  removeWorkspace,
  writeCollectionFile,
  writeConfig,
  type BoundWorkspace,
} from './helpers/workspace'

/**
 * End-to-end coverage for `ritual collection-sync`: one representative path per
 * direction against a stubbed Archidekt, plus the flag wiring and exit codes.
 * The diff and planning semantics are unit-tested against the engine
 * (test/unit/collection-sync/), so what is pinned here is what only the command
 * can be wrong about — which files a run writes, where `--into` and the
 * `collectionSync.pullTarget` config key send a pull's additions, what a push
 * puts on the wire, and that a dry run writes nothing at all.
 *
 * Nothing here touches the network: every Archidekt endpoint is served by a
 * stubbed `fetch` that rejects any URL a test did not route, and the card cache
 * is seeded in-process so no Scryfall lookup is attempted either.
 */

let ws: BoundWorkspace
let dir: string
let originalFetch: typeof globalThis.fetch
let logger: MemoryLogger
/** Every request the run made, recorded by the stub the test installed. */
let sent: StubbedRequest[]

/** Install the stub and point `sent` at its recording. */
function stubFetch(routes: Record<string, StubRoute>): void {
  sent = stubArchidekt(routes)
}

/**
 * Run the command in-process (the built binary cannot be handed a stubbed
 * Archidekt) and return the exit code it set, leaving the test process's own
 * exit code clean.
 */
async function runSync(args: string[]): Promise<number> {
  const program = new Command()
  program.exitOverride()
  registerCollectionSyncCommand(program)
  process.exitCode = 0
  await program.parseAsync(['collection-sync', ...args], { from: 'user' })
  const exitCode = process.exitCode ?? 0
  process.exitCode = 0
  return exitCode
}

/** Everything the run logged, as one string. */
function logged(): string {
  return logger.entries.map((entry) => entry.args.map((arg) => String(arg)).join(' ')).join('\n')
}

function collectionPath(name: string): string {
  return path.join(dir, 'collections', `${name}.md`)
}

async function readList(name: string): Promise<string> {
  return fs.readFile(collectionPath(name), 'utf-8')
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  )
}

describe('collection-sync CLI (Integration)', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ init: true })
    dir = ws.dir
    originalFetch = globalThis.fetch
    // No test may reach the network: a route a test forgot — or a token refresh
    // attempt — must fail loudly rather than call Archidekt for real.
    stubFetch({})
    logger = new MemoryLogger()
    setLogger(logger)
    await seedCollectionCardCache()
    await signIn(dir, { ...TEST_ACCOUNT })
    await writeCollectionFile(dir, 'binder', {
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    resetLogger()
    cardCache.invalidate()
    scryfallIdIndex.reset()
    await ws.dispose()
  })

  /** Serve a collection holding `records`; the only endpoint a pull needs. */
  function stubCollection(...records: ArchidektCollectionRecord[]): void {
    stubFetch({ [COLLECTION_URL]: () => Response.json(collectionPage(records)) })
  }

  test('pulls a remote-only card into --into, with a changelog entry', async () => {
    stubCollection(record(SOL_RING), record(BOLT))

    const exitCode = await runSync(['pull', '--into', 'binder'])

    expect(exitCode).toBe(0)
    const list = await readList('binder')
    // Set codes are uppercase in markdown, and the pulled line keeps the
    // Scryfall spelling resolved from the cache.
    // The pulled line carries an `&N` like every other card line — the seeded
    // Sol Ring holds &1, so the addition takes the next id.
    expect(list).toMatch(/- Lightning Bolt \(LEA:161\) &2$/m)
    expect(list).toContain('- Sol Ring (C21:240) &1')

    const changelog = await fs.readFile(path.join(dir, 'collections', 'binder.changes.md'), 'utf-8')
    // The changelog names the same id the line landed with.
    expect(changelog).toContain('Added "Lightning Bolt" (LEA:161) &2')
    expect(logged()).toContain('Synced: +1 added, -0 removed (additions into "binder").')
  })

  test('a pull that both removes and adds gives the new line its own id', async () => {
    await writeCollectionFile(dir, 'binder', {
      entries: [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
        { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 2 },
      ],
    })
    // One Sol Ring remotely (so a copy is removed) plus a Bolt that is not local.
    stubCollection(record(SOL_RING), record(BOLT))

    expect(await runSync(['pull', '--into', 'binder'])).toBe(0)

    const list = await readList('binder')
    // The freed &2 is not handed straight back inside the same batch — an id in
    // use when the batch started stays reserved until the file is re-read.
    expect(list).toContain('- Sol Ring (C21:240) &1')
    expect(list).not.toContain('&2')
    expect(list).toMatch(/- Lightning Bolt \(LEA:161\) &3$/m)
  })

  test('sends a pull with no --into to the collectionSync.pullTarget list, creating it', async () => {
    await writeConfig(dir, { collectionSync: { pullTarget: 'Overflow' } })
    // The command reads the config through the process-wide cache, which the
    // workspace primed at bind time.
    await reloadRitualConfig()
    stubCollection(record(SOL_RING), record(BOLT))

    expect(await runSync(['pull'])).toBe(0)

    expect(await readList('Overflow')).toContain('- Lightning Bolt (LEA:161)')
    // The card went to the target list, not to the list that was already there.
    expect(await readList('binder')).not.toContain('Lightning Bolt')
  })

  test('a dry run reports the pull without writing anything', async () => {
    stubCollection(record(SOL_RING), record(BOLT))
    const before = await readList('binder')

    expect(await runSync(['pull', '--into', 'binder', '--dry-run'])).toBe(0)

    expect(await readList('binder')).toBe(before)
    expect(await exists(path.join(dir, 'collections', 'binder.changes.md'))).toBe(false)
    // A dry run changed nothing, so it records no sync timestamp either.
    expect(await exists(path.join(dir, '.logins', 'collection-sync.json'))).toBe(false)
    expect(logged()).toContain('[dry-run] Would sync: +1 added, -0 removed')
  })

  test('--only additions keeps a pull from removing local copies', async () => {
    // Two local copies against one remote: the extra copy would be removed.
    await writeCollectionFile(dir, 'binder', {
      entries: [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
        { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 2 },
      ],
    })
    const before = await readList('binder')
    stubCollection(record(SOL_RING))

    expect(await runSync(['pull', '--into', 'binder', '--only', 'additions'])).toBe(0)

    expect(await readList('binder')).toBe(before)
    expect(logged()).toContain('Skipped 1 removal (applying additions only).')
  })

  /**
   * Only some of a printing's copies are going and they live in two binders, so
   * the run cannot know which one lost them. Nothing may be written until that
   * is settled — including the changes the same run could have made on its own.
   */
  describe('ambiguous removals', () => {
    /** `binder` keeps its Sol Ring; `longbox` holds two more of the same printing. */
    async function splitAcrossBinders(): Promise<void> {
      await writeCollectionFile(dir, 'longbox', {
        entries: [
          { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
          { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 2 },
        ],
      })
      // One copy remotely against three locally: two must go, from somewhere.
      stubCollection(record(SOL_RING))
    }

    test('refuses to guess, exits 1, and leaves every file untouched', async () => {
      await splitAcrossBinders()
      const before = { binder: await readList('binder'), longbox: await readList('longbox') }

      // `bun test` has no terminal, which is the non-interactive path: there is
      // nobody to ask, so the run fails instead of picking a binder.
      expect(await runSync(['pull', '--into', 'binder'])).toBe(1)

      expect(await readList('binder')).toBe(before.binder)
      expect(await readList('longbox')).toBe(before.longbox)
      expect(await exists(path.join(dir, 'collections', 'longbox.changes.md'))).toBe(false)
      // "Nothing was written" covers the account's sync state too, so the status
      // page cannot report a sync for a run that changed nothing.
      expect(await exists(path.join(dir, '.logins', 'collection-sync.json'))).toBe(false)
      // Both binders are named with the copies they hold (in whichever order the
      // lists were enumerated), and the message says what to do about it.
      expect(logged()).toContain('Not removing 2 × Sol Ring (C21:240): ambiguous — copies live in')
      expect(logged()).toContain('"longbox" (2)')
      expect(logged()).toContain('"binder" (1)')
      // Verbatim, because this exact sentence is the join the layers below
      // cannot pin: the advice comes only from `resolveAmbiguousRemovals`, so
      // the command must have passed that resolver *and* told it there is no
      // terminal to prompt on.
      expect(logged()).toContain(
        '1 ambiguous removal needs a decision. Pass --removal-priority <list> (repeatable, in ' +
          'priority order) to say which lists may lose copies, or run in a terminal to resolve ' +
          'them one by one. Nothing was written.',
      )
      // The closing tally does not announce a sync the run refused to make.
      expect(logged()).toContain('Not synced: +0 added, -0 removed')
      expect(logged()).not.toContain('Synced: +0 added')
    })

    test('an addition that would create the target list is withheld too', async () => {
      await writeCollectionFile(dir, 'longbox', {
        entries: [
          { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
          { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 2 },
        ],
      })
      // One Sol Ring remotely (two local copies must go, from somewhere) plus a
      // Bolt no list holds, which a successful run would file in the default
      // target list — created on first use, and the one file a failed run could
      // still leave behind.
      stubCollection(record(SOL_RING), record(BOLT))
      const before = { binder: await readList('binder'), longbox: await readList('longbox') }

      expect(await runSync(['pull'])).toBe(1)

      expect(await exists(collectionPath('Inbox'))).toBe(false)
      expect(await readList('binder')).toBe(before.binder)
      expect(await readList('longbox')).toBe(before.longbox)
      expect(logged()).toContain('Nothing was written.')
    })

    test('--removal-priority names the binder that loses the copies', async () => {
      await splitAcrossBinders()
      const before = await readList('binder')

      expect(await runSync(['pull', '--into', 'binder', '--removal-priority', 'longbox'])).toBe(0)

      // Both of longbox's copies went; the binder's own copy stayed.
      expect(await readList('longbox')).not.toContain('Sol Ring')
      expect(await readList('binder')).toBe(before)
      const changelog = await fs.readFile(
        path.join(dir, 'collections', 'longbox.changes.md'),
        'utf-8',
      )
      expect(changelog).toContain('Removed "Sol Ring" (C21:240) &2')
      expect(logged()).toContain(
        'Removing 2 × Sol Ring (C21:240) from "longbox" (removal priority)',
      )
    })

    test('a priority list holding too few copies exits 1 without writing', async () => {
      await splitAcrossBinders()
      const before = { binder: await readList('binder'), longbox: await readList('longbox') }

      // `binder` holds one of the two copies that have to go.
      expect(await runSync(['pull', '--into', 'binder', '--removal-priority', 'binder'])).toBe(1)

      expect(await readList('binder')).toBe(before.binder)
      expect(await readList('longbox')).toBe(before.longbox)
      expect(logged()).toContain(
        'The removal priority (binder) cannot place 2 × Sol Ring (C21:240)',
      )
    })

    test('a dry run reports the ambiguity, asks nothing, and writes nothing', async () => {
      await splitAcrossBinders()
      const before = { binder: await readList('binder'), longbox: await readList('longbox') }

      expect(await runSync(['pull', '--into', 'binder', '--dry-run'])).toBe(0)

      expect(await readList('binder')).toBe(before.binder)
      expect(await readList('longbox')).toBe(before.longbox)
      expect(logged()).toContain(
        '[dry-run] A real run would refuse to place 2 × Sol Ring (C21:240) until the ambiguity is resolved.',
      )
    })

    test('a card the remote lacks entirely leaves every binder, with no ambiguity', async () => {
      await writeCollectionFile(dir, 'longbox', {
        entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
      })
      // The remote holds only the Bolt: every Sol Ring copy is going.
      stubCollection(record(BOLT))

      expect(await runSync(['pull', '--into', 'binder'])).toBe(0)

      expect(await readList('binder')).not.toContain('Sol Ring')
      expect(await readList('longbox')).not.toContain('Sol Ring')
      expect(await readList('binder')).toContain('- Lightning Bolt (LEA:161)')
      expect(logged()).not.toContain('ambiguous')
      expect(logged()).toContain('Synced: +1 added, -2 removed')
    })
  })

  test('pushes a local-only card and deletes the records no list holds', async () => {
    stubFetch({
      [COLLECTION_URL]: () => Response.json(collectionPage([record({ ...BOLT, id: 7 })])),
      [SEARCH_URL]: () =>
        Response.json({
          results: [
            {
              id: 555,
              collectorNumber: '240',
              options: ['Normal', 'Foil'],
              oracleCard: { name: 'Sol Ring', defaultCategory: 'Artifact' },
            },
          ],
        }),
      [BULK_URL]: () => new Response(null, { status: 204 }),
      [UPSERT_URL]: () => Response.json({ id: 99, createdAt: 'now', modifiedAt: 'now' }),
    })
    const before = await readList('binder')

    expect(await runSync(['push'])).toBe(0)

    const created = sent.find((request) => request.method === 'POST')
    expect(created?.body).toEqual({
      game: 1,
      quantity: 1,
      card: 555,
      modifier: 'Normal',
      language: 1,
      condition: 1,
      tags: [],
      purchasePrice: null,
    })
    const deleted = sent.find((request) => request.method === 'DELETE')
    expect(deleted?.body).toEqual({ ids: [7] })

    // A push writes nothing locally.
    expect(await readList('binder')).toBe(before)
    expect(await exists(path.join(dir, 'collections', 'binder.changes.md'))).toBe(false)
  })

  /**
   * A push adds each new printing with its own Archidekt search, so a large first
   * push takes hundreds of paced requests. `--csv` sends them through Archidekt's
   * CSV importer instead, `--csv-file` writes the same file for a manual upload,
   * and past 25 new printings a non-interactive run refuses to pick for you.
   */
  describe('CSV additions', () => {
    /** The binder holds both cached printings; the account holds neither. */
    async function twoAdditions(): Promise<void> {
      await writeCollectionFile(dir, 'binder', {
        entries: [
          { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
          {
            name: 'Lightning Bolt',
            set: 'lea',
            collectorNumber: '161',
            condition: 'DMG',
            cardId: 2,
          },
        ],
      })
      stubFetch({
        [COLLECTION_URL]: () => Response.json(collectionPage([])),
        [UPLOAD_URL]: () =>
          Response.json({
            data: [
              { ambiguous: false, notFound: false, errors: [] },
              { ambiguous: false, notFound: false, errors: [] },
            ],
          }),
      })
    }

    test('--csv uploads them as one import, without a single printing search', async () => {
      await twoAdditions()

      expect(await runSync(['push', '--csv'])).toBe(0)

      // The rows are built from the local cache, so the only requests are the
      // collection read and the upload itself.
      expect(sent.map((request) => request.url.startsWith(SEARCH_URL))).toEqual([false, false])
      expect(sent.filter((request) => request.url === UPSERT_URL)).toEqual([])
      expect(await uploadedCsvRows(sent)).toEqual([
        // Uids come from the seeded cache; Damaged is `D` in a CSV cell.
        `${seededScryfallId(SOL_RING)},1,Normal,NM`,
        `${seededScryfallId(BOLT)},1,Normal,D`,
      ])
      expect(logged()).toContain('Imported 2 cards (2 rows) from the CSV in 1 request.')
      expect(logged()).toContain('Synced: +2 added, -0 removed.')
    })

    test('--csv-file writes the CSV and pushes no additions', async () => {
      await twoAdditions()
      const csvPath = path.join(dir, 'out', 'archidekt-import.csv')

      expect(await runSync(['push', '--csv-file', csvPath])).toBe(0)

      // Written locally, with the parent directory created — and nothing at all
      // sent to Archidekt beyond the read.
      expect(await fs.readFile(csvPath, 'utf-8')).toBe(
        `Scryfall ID,Quantity,Variant,Condition\n${seededScryfallId(SOL_RING)},1,Normal,NM\n` +
          `${seededScryfallId(BOLT)},1,Normal,D\n`,
      )
      expect(sent.map((request) => request.method)).toEqual(['GET'])
      expect(logged()).toContain('Synced: +0 added, -0 removed, 2 awaiting upload.')
      expect(logged()).toContain(
        '2 cards were not pushed: upload ' +
          csvPath +
          ' at https://archidekt.com/collections/import to add them.',
      )
    })

    test('more than 25 additions with nobody to ask exits 1 without pushing', async () => {
      await writeCollectionFile(dir, 'binder', {
        entries: Array.from({ length: 26 }, (_, index) => ({
          name: `Card ${index + 1}`,
          set: 'ltc',
          collectorNumber: String(index + 1),
          // Explicit, so the uncached printings need no cache lookup to canonicalize.
          finish: 'foil' as const,
          cardId: index + 1,
        })),
      })
      stubFetch({ [COLLECTION_URL]: () => Response.json(collectionPage([])) })

      // `bun test` has no terminal, which is the non-interactive path: there is
      // nobody to ask, so the run refuses rather than making 26 searches.
      expect(await runSync(['push'])).toBe(1)

      expect(sent.map((request) => request.method)).toEqual(['GET'])
      expect(logged()).toContain('26 cards would be added — more than 25')
      expect(logged()).toContain('Pass --csv to upload them as one CSV import')
      expect(logged()).toContain('--csv-file <path>')
      expect(logged()).toContain('Nothing was pushed.')
      expect(logged()).toContain('Not synced: +0 added, -0 removed')
    })

    test('a pull warns that the CSV options do not apply to it', async () => {
      stubCollection(record(SOL_RING))
      const csvPath = path.join(dir, 'out', 'never-written.csv')

      expect(await runSync(['pull', '--into', 'binder', '--csv'])).toBe(0)
      expect(await runSync(['pull', '--into', 'binder', '--csv-file', csvPath])).toBe(0)

      expect(logged()).toContain('Ignoring --csv: it only applies to a push.')
      expect(logged()).toContain('Ignoring --csv-file: it only applies to a push.')
      // Warned *and* ignored: a pull writes no CSV, whatever the flag named.
      expect(await exists(csvPath)).toBe(false)
    })

    /**
     * Every uploaded row is keyed by a Scryfall id the local cache holds, so a run
     * taking the CSV path needs that cache fresh — and refuses rather than falling
     * back to a search per card, which is the rate limiting the path exists to
     * avoid.
     */
    /** Two additions and no cache at all — the state the freshness gate exists for. */
    async function additionsWithoutCache(): Promise<void> {
      await writeCollectionFile(dir, 'binder', {
        entries: [
          // Explicit finishes, so an empty cache is not consulted to canonicalize
          // them: what reaches the wire is then only what the sync itself sent.
          { name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'foil', cardId: 1 },
          { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', finish: 'foil', cardId: 2 },
        ],
      })
      stubFetch({ [COLLECTION_URL]: () => Response.json(collectionPage([])) })
      await cardCache.clear()
    }

    test('an empty card cache refuses the upload instead of pushing the slow way', async () => {
      await additionsWithoutCache()

      // `bun test` has no terminal, so the default `--refresh ask` cannot prompt.
      expect(await runSync(['push', '--csv'])).toBe(1)

      // Only the collection read: no upload, and not one printing search.
      expect(sent.map((request) => request.method)).toEqual(['GET'])
      expect(logged()).toContain('which is empty')
      expect(logged()).toContain('Run `ritual cache preload-all`, or re-run with --refresh auto.')
      expect(logged()).toContain('Nothing was pushed.')
      expect(logged()).toContain('Not synced: +0 added, -0 removed')
    })

    test('--refresh never refuses too, rather than downloading anything', async () => {
      await additionsWithoutCache()

      expect(await runSync(['push', '--csv', '--refresh', 'never'])).toBe(1)

      expect(sent.map((request) => request.method)).toEqual(['GET'])
      expect(logged()).toContain('Run `ritual cache preload-all`, or re-run with --refresh auto.')
    })
  })

  test('a push warns that the pull-only options do not apply to it', async () => {
    stubFetch({
      [COLLECTION_URL]: () => Response.json(collectionPage([record(SOL_RING)])),
    })

    expect(await runSync(['push', '--into', 'Overflow', '--removal-priority', 'binder'])).toBe(0)

    expect(logged()).toContain('Ignoring --into: it only applies to a pull.')
    expect(logged()).toContain('Ignoring --removal-priority: it only applies to a pull.')
    expect(await exists(collectionPath('Overflow'))).toBe(false)
  })

  test('reports a failed collection fetch as a run failure', async () => {
    stubFetch({ [COLLECTION_URL]: () => new Response('nope', { status: 500 }) })

    expect(await runSync(['pull', '--into', 'binder'])).toBe(1)
    expect(logged()).toContain('Failed to fetch the Archidekt collection')
  })
})

/**
 * The argument surface, driven through the built binary so the command's
 * registration in index.ts is covered too. Every case resolves before any
 * network call could happen; `OFFLINE_ENV` is a backstop.
 */
describe('collection-sync CLI arguments (Integration)', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await createWorkspace()
  })

  afterEach(async () => {
    await removeWorkspace(workspace)
  })

  test('an invalid direction is a usage error', async () => {
    const result = await runCli(['collection-sync', 'sideways'], workspace, OFFLINE_ENV)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Invalid direction 'sideways'")
    expect(result.stderr).toContain('Use one of: push, pull.')
  })

  test('--only rejects anything but the change filter values', async () => {
    const result = await runCli(
      ['collection-sync', 'pull', '--only', 'adds'],
      workspace,
      OFFLINE_ENV,
    )

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Invalid change filter 'adds'")
  })

  test('--yes is a recognized flag', async () => {
    // The confirmation logic itself is unit-tested; this pins the wiring, so a
    // renamed or dropped option surfaces as a usage error rather than silently
    // never confirming.
    const result = await runCli(['collection-sync', 'pull', '--yes'], workspace, OFFLINE_ENV)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Not signed into Archidekt')
  })

  test('--removal-priority rejects a blank list name', async () => {
    const result = await runCli(
      ['collection-sync', 'pull', '--removal-priority', ' '],
      workspace,
      OFFLINE_ENV,
    )

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--removal-priority requires a collection list name.')
  })

  test('--csv-file rejects a blank path', async () => {
    const result = await runCli(
      ['collection-sync', 'push', '--csv-file', ' '],
      workspace,
      OFFLINE_ENV,
    )

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--csv-file requires a file path.')
  })

  test('--csv and --csv-file cannot be combined', async () => {
    const result = await runCli(
      ['collection-sync', 'push', '--csv', '--csv-file', 'out.csv'],
      workspace,
      OFFLINE_ENV,
    )

    // A usage error, not a precedence rule: one says "send these to Archidekt",
    // the other "do not send them at all". Refused before the login check, so it
    // does not depend on being signed in.
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--csv and --csv-file cannot be combined')
    expect(result.stderr).not.toContain('Not signed into Archidekt')
  })

  test('--into rejects a blank list name', async () => {
    const result = await runCli(['collection-sync', 'pull', '--into', '  '], workspace, OFFLINE_ENV)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--into requires a collection list name.')
  })

  test('without an Archidekt login it fails with a structured error', async () => {
    const result = await runCli(
      ['collection-sync', 'pull', '--output', 'json'],
      workspace,
      OFFLINE_ENV,
    )

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(parsed.error.code).toBe('runtime_error')
    expect(parsed.error.message).toContain('Not signed into Archidekt')
  })

  test('a stored login with no account id asks for a fresh login', async () => {
    await signIn(workspace)

    const result = await runCli(['collection-sync', 'pull'], workspace, OFFLINE_ENV)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('does not name an account')
    expect(result.stderr).toContain('ritual login archidekt')
  })
})
