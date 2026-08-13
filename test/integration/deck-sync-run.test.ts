import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { registerDeckSyncCommand } from '../../src/commands/deck-sync'
import { MemoryLogger, resetLogger, setLogger } from '../../src/logger'
import {
  SEARCH_URL,
  signIn,
  stubArchidekt,
  TEST_ACCOUNT,
  type StubbedRequest,
  type StubRoute,
} from './helpers/archidekt'
import { bindWorkspace, writeDeckFile, type BoundWorkspace } from './helpers/workspace'
import { captureStream } from './helpers/capture'
import { runInProcess } from './helpers/cli'
import type { Card, DeckSection } from '../../src/types'
import type { ArchidektCardModifier } from '../../src/importers/archidekt-types'

/**
 * End-to-end coverage for the `deck-sync` behaviors only the command and engine
 * together can be wrong about: linking a deck, the read-only status view, the
 * push-side divergence guard, and which decks get a fresh `lastSynced`. The
 * diffing and the divergence comparison itself are unit-tested
 * (`test/unit/deck-sync.test.ts`, `test/unit/deck-sync-link.test.ts`).
 *
 * Nothing here touches the network: every Archidekt endpoint is served by a
 * stubbed `fetch` that rejects any URL a test did not route.
 */

const DECK_ID = '123456'
const DECK_URL = `https://archidekt.com/api/decks/${DECK_ID}/`
const OWN_DECKS_URL = 'https://archidekt.com/api/decks/curated/self/'
const MODIFY_URL = `https://archidekt.com/api/decks/${DECK_ID}/modifyCards/v2/`

let ws: BoundWorkspace
let dir: string
let originalFetch: typeof globalThis.fetch
let logger: MemoryLogger
let sent: StubbedRequest[]

function stubFetch(routes: Record<string, StubRoute>): void {
  sent = stubArchidekt(routes)
}

/** Run the command in-process and return the exit code it set. */
async function runDeckSync(args: string[]): Promise<number> {
  return runInProcess(registerDeckSyncCommand, ['deck-sync', ...args])
}

function logged(): string {
  return logger.entries.map((entry) => entry.args.map((arg) => String(arg)).join(' ')).join('\n')
}

/** The modifyCards bodies a run sent, flattened to their card entries. */
function pushedEntries(): unknown[] {
  return sent
    .filter((request) => request.url.startsWith(MODIFY_URL))
    .flatMap((request) => (request.body as { cards: unknown[] }).cards)
}

/** Whether the run sent any modifyCards request at all. */
function pushedToArchidekt(): boolean {
  return sent.some((request) => request.url.startsWith(MODIFY_URL))
}

/** What the remote Sol Ring entry may vary in, for the printing-sync tests. */
type RemoteSolRing = {
  modifier?: ArchidektCardModifier
  options?: ArchidektCardModifier[]
}

/** One raw deck-card entry of the stubbed remote deck. */
function remoteEntry(
  relationId: number,
  name: string,
  quantity: number,
  printing: { set: string; collectorNumber: string; cardId: number },
  solRing: RemoteSolRing = {},
): unknown {
  return {
    id: relationId,
    quantity,
    modifier: solRing.modifier ?? 'Normal',
    categories: ['Artifact'],
    companion: false,
    flippedDefault: false,
    label: ',#656565',
    customCmc: null,
    card: {
      id: printing.cardId,
      uid: `uid-${relationId}`,
      collectorNumber: printing.collectorNumber,
      options: solRing.options ?? ['Normal'],
      oracleCard: { id: relationId * 100, name, defaultCategory: 'Artifact' },
      edition: { editioncode: printing.set },
    },
  }
}

const SOL_RING_PRINTING = { set: 'c21', collectorNumber: '240', cardId: 501 }

/** The raw deck payload a push reads, holding one Sol Ring (C21:240) plus `extraCards`. */
function remoteDeck(
  updatedAt: string,
  solRing: RemoteSolRing = {},
  extraCards: unknown[] = [],
): unknown {
  return {
    id: Number(DECK_ID),
    name: 'Winota Stax',
    owner: { id: TEST_ACCOUNT.id, username: TEST_ACCOUNT.username },
    categories: [],
    updatedAt,
    cards: [remoteEntry(11, 'Sol Ring', 1, SOL_RING_PRINTING, solRing), ...extraCards],
  }
}

/** Routes for a push against a remote deck last updated at `updatedAt`. */
function pushRoutes(
  updatedAt: string,
  solRing: RemoteSolRing = {},
  extraCards: unknown[] = [],
): Record<string, StubRoute> {
  return {
    [OWN_DECKS_URL]: () =>
      Response.json({ results: [{ id: Number(DECK_ID), name: 'Winota Stax' }], next: null }),
    [MODIFY_URL]: () => Response.json({ success: true }),
    [DECK_URL]: () => Response.json(remoteDeck(updatedAt, solRing, extraCards)),
  }
}

/** The two stamps a deck's sync state is written with; see {@link writeLinkedDeck}. */
type SyncedStamps = { lastSynced?: string; sourceUpdatedAt?: string }

/**
 * A deck file linked to Archidekt, holding the given cards — either a lone
 * `## Main` (an array) or explicit sections.
 *
 * `synced` stamps both sync keys: `lastSynced` (the local clock, for display)
 * and `sourceUpdatedAt` (the remote's own `updatedAt`, which is the only thing
 * the divergence guard compares). Omitted, the deck has never synced.
 */
async function writeLinkedDeck(
  body: Card[] | DeckSection[],
  synced?: SyncedStamps,
): Promise<string> {
  const sectioned = body.length > 0 && 'cards' in body[0]!
  return writeDeckFile(dir, 'winota-stax', {
    frontMatter: {
      name: 'Winota Stax',
      sourceId: DECK_ID,
      sourceUrl: `https://archidekt.com/decks/${DECK_ID}`,
      ...(synced?.lastSynced === undefined ? {} : { lastSynced: synced.lastSynced }),
      ...(synced?.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: synced.sourceUpdatedAt }),
    },
    ...(sectioned
      ? { sections: body as DeckSection[] }
      : { cards: (body as Card[]).map((card) => ({ ...card })) }),
  })
}

async function readDeck(): Promise<string> {
  return fs.readFile(path.join(dir, 'decks', 'winota-stax.md'), 'utf-8')
}

beforeEach(async () => {
  ws = await bindWorkspace({ init: true })
  dir = ws.dir
  originalFetch = globalThis.fetch
  stubFetch({})
  logger = new MemoryLogger()
  setLogger(logger)
  await signIn(dir, { ...TEST_ACCOUNT })
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  resetLogger()
  await ws.dispose()
})

describe('deck-sync link (Integration)', () => {
  test('writes the Archidekt link and leaves the deck body byte-identical', async () => {
    // A hand-written body with prose and a fenced block: linking touches front
    // matter only, so every one of those bytes must survive.
    const filePath = path.join(dir, 'decks', 'alpha-deck.md')
    const original = [
      '---',
      'name: Alpha Deck',
      '---',
      '',
      'Some prose about the deck.',
      '',
      '```',
      '4 Not A Card Line',
      '```',
      '',
      '## Main',
      '1 Sol Ring &1',
      '',
    ].join('\n')
    await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
    await fs.writeFile(filePath, original)

    let exitCode = 1
    const stdout = await captureStream('stdout', async () => {
      exitCode = await runDeckSync(['link', 'Alpha Deck', 'https://archidekt.com/decks/777/x'])
    })

    expect(exitCode).toBe(0)
    const updated = await fs.readFile(filePath, 'utf-8')
    expect(updated).toContain("sourceId: '777'")
    expect(updated).toContain("sourceUrl: 'https://archidekt.com/decks/777'")
    // Everything after the front matter is untouched, fenced block included.
    expect(updated.slice(updated.indexOf('\nSome prose'))).toBe(
      original.slice(original.indexOf('\nSome prose')),
    )
    expect(stdout).toContain('Linked "Alpha Deck" to https://archidekt.com/decks/777')
  })

  test('a dry run reports the link without writing the file', async () => {
    const filePath = await writeDeckFile(dir, 'alpha-deck', {
      frontMatter: { name: 'Alpha Deck' },
      cards: [{ quantity: 1, name: 'Sol Ring' }],
    })
    const before = await fs.readFile(filePath, 'utf-8')

    let exitCode = 1
    const stdout = await captureStream('stdout', async () => {
      exitCode = await runDeckSync([
        'link',
        'Alpha Deck',
        'https://archidekt.com/decks/777',
        '--dry-run',
      ])
    })

    expect(exitCode).toBe(0)
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
    expect(stdout).toContain('[dry-run] Would link')
  })

  test('a non-Archidekt URL is a usage error and writes nothing', async () => {
    const filePath = await writeDeckFile(dir, 'alpha-deck', {
      frontMatter: { name: 'Alpha Deck' },
      cards: [{ quantity: 1, name: 'Sol Ring' }],
    })
    const before = await fs.readFile(filePath, 'utf-8')

    expect(await runDeckSync(['link', 'Alpha Deck', 'https://moxfield.com/decks/abc'])).toBe(2)
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })

  test('an unknown deck is a not-found', async () => {
    expect(await runDeckSync(['link', 'No Such Deck', 'https://archidekt.com/decks/1'])).toBe(3)
  })

  test('a name two decks answer to is a usage error, not a guess', async () => {
    await writeDeckFile(dir, 'twin-alpha', {
      frontMatter: { name: 'Twin Alpha' },
      cards: [{ quantity: 1, name: 'Sol Ring' }],
    })
    await writeDeckFile(dir, 'twin-beta', {
      frontMatter: { name: 'Twin Beta' },
      cards: [{ quantity: 1, name: 'Sol Ring' }],
    })

    expect(await runDeckSync(['link', 'Twin', 'https://archidekt.com/decks/1'])).toBe(2)
  })

  test('re-linking reports the link it replaced', async () => {
    await writeDeckFile(dir, 'alpha-deck', {
      frontMatter: {
        name: 'Alpha Deck',
        sourceId: '111',
        sourceUrl: 'https://archidekt.com/decks/111',
      },
      cards: [{ quantity: 1, name: 'Sol Ring' }],
    })

    const stdout = await captureStream('stdout', async () => {
      expect(await runDeckSync(['link', 'Alpha Deck', 'https://archidekt.com/decks/222'])).toBe(0)
    })

    expect(stdout).toContain('It was linked to https://archidekt.com/decks/111.')
    const updated = await fs.readFile(path.join(dir, 'decks', 'alpha-deck.md'), 'utf-8')
    expect(updated).toContain("sourceId: '222'")
    expect(updated).not.toContain('111')
  })

  test('--output json emits the result, and --quiet says nothing', async () => {
    await writeDeckFile(dir, 'alpha-deck', {
      frontMatter: { name: 'Alpha Deck' },
      cards: [{ quantity: 1, name: 'Sol Ring' }],
    })

    const json = await captureStream('stdout', async () => {
      expect(
        await runDeckSync([
          'link',
          'Alpha Deck',
          'https://archidekt.com/decks/333',
          '--output',
          'json',
        ]),
      ).toBe(0)
    })
    expect(JSON.parse(json)).toMatchObject({
      slug: 'alpha-deck',
      name: 'Alpha Deck',
      sourceId: '333',
      previous: null,
      dryRun: false,
    })

    const quiet = await captureStream('stdout', async () => {
      expect(
        await runDeckSync(['link', 'Alpha Deck', 'https://archidekt.com/decks/444', '--quiet']),
      ).toBe(0)
    })
    expect(quiet).toBe('')
  })

  test('linking an unrecorded hand edit keeps its stale sidecar', async () => {
    // Linking writes front matter only; stamping the sidecar would make
    // `detect-changes` treat the hand-added card line as already recorded.
    const filePath = path.join(dir, 'decks', 'alpha-deck.md')
    await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
    await fs.writeFile(filePath, '---\nname: Alpha Deck\n---\n\n## Main\n1 Sol Ring &1\n')

    expect(await runDeckSync(['link', 'Alpha Deck', 'https://archidekt.com/decks/555'])).toBe(0)

    expect(await Bun.file(`${filePath}.sha256`).exists()).toBe(false)
  })
})

describe('deck-sync status (Integration)', () => {
  test('reports linked decks and their last sync as JSON, touching no network', async () => {
    await writeLinkedDeck([{ quantity: 1, name: 'Sol Ring' }], {
      lastSynced: '2026-08-01T00:00:00.000Z',
    })
    await writeDeckFile(dir, 'local-only', {
      frontMatter: { name: 'Local Only' },
      cards: [{ quantity: 1, name: 'Sol Ring' }],
    })

    let exitCode = 1
    const stdout = await captureStream('stdout', async () => {
      exitCode = await runDeckSync(['status', '--output', 'json'])
    })
    expect(exitCode).toBe(0)

    const payload = JSON.parse(stdout) as {
      decks: { name: string; sourceUrl: string; lastSynced: string | null }[]
      collection: unknown
    }
    // Only the Archidekt-linked deck appears; the local-only deck is not
    // syncable and the collection has never synced in this workspace.
    expect(payload.decks).toHaveLength(1)
    expect(payload.decks[0]!.name).toBe('Winota Stax')
    expect(payload.decks[0]!.lastSynced).toBe('2026-08-01T00:00:00.000Z')
    expect(payload.collection).toBeNull()
    expect(sent).toEqual([])
  })

  test('--output ndjson emits one tagged row per thing', async () => {
    await writeLinkedDeck([{ quantity: 1, name: 'Sol Ring' }], {
      lastSynced: '2026-08-01T00:00:00.000Z',
    })
    await fs.mkdir(path.join(dir, '.logins'), { recursive: true })
    await fs.writeFile(
      path.join(dir, '.logins', 'collection-sync.json'),
      JSON.stringify({ lastSynced: '2026-07-30T00:00:00.000Z', userId: 42, username: 'tester' }),
    )

    let exitCode = 1
    const stdout = await captureStream('stdout', async () => {
      exitCode = await runDeckSync(['status', '--output', 'ndjson'])
    })
    expect(exitCode).toBe(0)

    const rows = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(rows).toEqual([
      {
        kind: 'deck',
        slug: 'winota-stax',
        name: 'Winota Stax',
        sourceId: DECK_ID,
        sourceUrl: `https://archidekt.com/decks/${DECK_ID}`,
        lastSynced: '2026-08-01T00:00:00.000Z',
      },
      {
        kind: 'collection',
        lastSynced: '2026-07-30T00:00:00.000Z',
        userId: 42,
        username: 'tester',
      },
    ])
  })

  test('an unreadable state file is reported as such, not as "never synced"', async () => {
    await fs.mkdir(path.join(dir, '.logins'), { recursive: true })
    await fs.writeFile(path.join(dir, '.logins', 'collection-sync.json'), '{ truncated')

    const stdout = await captureStream('stdout', async () => {
      expect(await runDeckSync(['status'])).toBe(0)
    })
    expect(stdout).toContain('Collection: sync state unreadable')
  })
})

describe('deck-sync push divergence (Integration)', () => {
  test('fails a deck whose remote changed since the last sync, pushing nothing', async () => {
    // Local drops the remote's only card, so there *is* something to push.
    await writeLinkedDeck([], { sourceUpdatedAt: '2026-08-01T00:00:00.000Z' })
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['push'])).toBe(1)

    expect(logged()).toContain('Remote deck changed since last sync')
    expect(logged()).toContain('--force')
    expect(pushedToArchidekt()).toBe(false)
    // A failed deck keeps its old baseline and says nothing about updating it.
    expect(await readDeck()).toContain('2026-08-01T00:00:00.000Z')
    expect(logged()).not.toContain('Updated lastSynced.')
  })

  test('a dry run reports the divergence without needing --force', async () => {
    await writeLinkedDeck([], { sourceUpdatedAt: '2026-08-01T00:00:00.000Z' })
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['push', '--dry-run'])).toBe(1)
    expect(logged()).toContain('Remote deck changed since last sync')
  })

  test('--force pushes anyway and records the remote it overwrote', async () => {
    await writeLinkedDeck([], { sourceUpdatedAt: '2026-08-01T00:00:00.000Z' })
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['push', '--force'])).toBe(0)

    expect(pushedToArchidekt()).toBe(true)
    expect(logged()).toContain('Updated lastSynced.')
    // The baseline moves to the remote's own post-push timestamp, so the next
    // push is not refused over the change this one made.
    expect(await readDeck()).toContain("sourceUpdatedAt: '2026-08-02T00:00:00.000Z'")
  })

  test('a deck that never synced has nothing to diverge from', async () => {
    await writeLinkedDeck([])
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['push'])).toBe(0)
    expect(pushedToArchidekt()).toBe(true)
  })

  test('an unusable remote timestamp pushes anyway, but says the guard did not run', async () => {
    // Fails open on purpose — but silently failing open is how a response-shape
    // change would disable the guard without anyone noticing.
    await writeLinkedDeck([], { sourceUpdatedAt: '2026-08-01T00:00:00.000Z' })
    stubFetch(pushRoutes('not a timestamp'))

    expect(await runDeckSync(['push'])).toBe(0)
    expect(logged()).toContain('pushing without the divergence check')
    expect(pushedToArchidekt()).toBe(true)
  })

  test('the local clock cannot manufacture a divergence', async () => {
    // The machine's clock trails Archidekt's by a day, so `lastSynced` is older
    // than the remote `updatedAt` of the very sync that wrote it. Only the
    // remote-sourced baseline is compared, so the push goes through.
    await writeLinkedDeck([], {
      lastSynced: '2026-08-01T00:00:00.000Z',
      sourceUpdatedAt: '2026-08-02T00:00:00.000Z',
    })
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['push'])).toBe(0)
    expect(logged()).not.toContain('Remote deck changed since last sync')
  })

  test('a pull that finds no card changes still clears a divergence', async () => {
    // The regression this guard used to create: a remote edit that touches no
    // card (a rename, a category shuffle) moves `updatedAt` without giving a
    // pull anything to apply. If the pull records nothing, the documented
    // remedy — "pull first" — can never clear the refusal and `--force` is the
    // only way out.
    await writeLinkedDeck([{ quantity: 1, name: 'Sol Ring' }], {
      sourceUpdatedAt: '2026-08-01T00:00:00.000Z',
    })
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['pull'])).toBe(0)
    expect(logged()).toContain('No changes detected.')
    expect(await readDeck()).toContain("sourceUpdatedAt: '2026-08-02T00:00:00.000Z'")

    // …and the push the user was told to retry now goes through.
    await fs.writeFile(
      path.join(dir, 'decks', 'winota-stax.md'),
      (await readDeck()).replace('1 Sol Ring', '2 Sol Ring'),
    )
    expect(await runDeckSync(['push'])).toBe(0)
    expect(pushedToArchidekt()).toBe(true)
  })

  test('a no-op pull leaves the deck body alone', async () => {
    await writeLinkedDeck([{ quantity: 1, name: 'Sol Ring' }], {
      sourceUpdatedAt: '2026-08-01T00:00:00.000Z',
    })
    const before = await readDeck()
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['pull'])).toBe(0)

    const after = await readDeck()
    // Front matter gained the new baseline; everything below it is untouched.
    expect(after.slice(after.indexOf('\n## '))).toBe(before.slice(before.indexOf('\n## ')))
  })

  test('a dry-run pull records nothing', async () => {
    await writeLinkedDeck([{ quantity: 1, name: 'Sol Ring' }], {
      sourceUpdatedAt: '2026-08-01T00:00:00.000Z',
    })
    const before = await readDeck()
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['pull', '--dry-run'])).toBe(0)
    expect(await readDeck()).toBe(before)
  })

  // `--force` is push-only: pinned through the built binary (exit code and
  // stderr) in `deck-sync-cli.test.ts`, where commander's parse failure is
  // observable rather than thrown into the test process.
})

describe('deck-sync empty extras sections (Integration)', () => {
  const SYNCED = { sourceUpdatedAt: '2026-08-01T00:00:00.000Z' }

  test('a pull that empties the maybeboard leaves no bare header behind', async () => {
    // The remote holds only Sol Ring, so the pull removes the local maybeboard's
    // last card. `applyDownloadDiff` filters cards, never sections, so the
    // emptied section reaches the serializer — which is what must drop it.
    await writeLinkedDeck(
      [
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] },
        { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Cavern-Hoard Dragon', cardId: 2 }] },
      ],
      SYNCED,
    )
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['pull'])).toBe(0)

    const after = await readDeck()
    expect(after).not.toContain('Maybeboard')
    expect(after).toContain('1 Sol Ring &1')
    // The card's removal is still recorded — only the empty header is silent.
    const changelog = await fs.readFile(path.join(dir, 'decks', 'winota-stax.changes.md'), 'utf-8')
    expect(changelog).toContain('Removed "Cavern-Hoard Dragon" from Maybeboard &2')
  })

  test('a leftover empty maybeboard does not block a pull', async () => {
    // Files written by an older sync (or by a line-preserving `remove-card`)
    // still carry one, and it used to read as content a rewrite would delete —
    // which failed the whole deck. The exit code is what pins the
    // reclassification; the parser then drops the section on read, so the
    // rewrite simply never re-emits the header.
    await writeLinkedDeck([{ quantity: 2, name: 'Sol Ring', cardId: 1 }], SYNCED)
    // Written by hand rather than through the fixture builder on purpose: that
    // builder serializes through `serializeDeckToMarkdown`, which now drops an
    // empty extras section, so it cannot produce the file this test needs.
    await fs.writeFile(
      path.join(dir, 'decks', 'winota-stax.md'),
      `${await readDeck()}\n## Maybeboard\n`,
    )
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['pull'])).toBe(0)
    expect(logged()).not.toContain('would be dropped by a sync')

    const after = await readDeck()
    expect(after).not.toContain('Maybeboard')
    // The remote's single copy landed, so the deck really was rewritten.
    expect(after).toContain('1 Sol Ring &1')
  })
})

describe('deck-sync push lastSynced (Integration)', () => {
  test('a deck whose plan has errors is not stamped', async () => {
    // The local file adds a card Archidekt cannot resolve, so the plan carries
    // an error and the deck is reported failed — its lastSynced must not move.
    await writeLinkedDeck(
      [
        { quantity: 1, name: 'Sol Ring' },
        { quantity: 1, name: 'Nonexistent Card' },
      ],
      { lastSynced: '2026-08-01T00:00:00.000Z', sourceUpdatedAt: '2026-07-01T00:00:00.000Z' },
    )
    stubFetch({
      ...pushRoutes('2026-07-01T00:00:00.000Z'),
      [SEARCH_URL]: () => Response.json({ results: [], next: null }),
    })

    expect(await runDeckSync(['push'])).toBe(1)

    expect(await readDeck()).toContain('2026-08-01T00:00:00.000Z')
    expect(logged()).not.toContain('Updated lastSynced.')
  })

  test('a clean push stamps lastSynced and says so', async () => {
    await writeLinkedDeck([], {
      lastSynced: '2026-07-01T00:00:00.000Z',
      sourceUpdatedAt: '2026-06-01T00:00:00.000Z',
    })
    stubFetch(pushRoutes('2026-06-01T00:00:00.000Z'))

    expect(await runDeckSync(['push'])).toBe(0)

    expect(logged()).toContain('Updated lastSynced.')
    expect(logged()).toContain('Synced 1 deck (1 with changes).')
    expect(await readDeck()).not.toContain('2026-07-01T00:00:00.000Z')
  })
})

describe('deck-sync --sync-printings (Integration)', () => {
  const UPDATED_AT = '2026-08-01T00:00:00.000Z'
  const synced = { sourceUpdatedAt: UPDATED_AT }

  test('a pull without the flag ignores printing differences', async () => {
    await writeLinkedDeck([{ quantity: 1, name: 'Sol Ring' }], synced)
    stubFetch(pushRoutes(UPDATED_AT))

    expect(await runDeckSync(['pull'])).toBe(0)
    expect(logged()).toContain('No changes detected.')
    expect(await readDeck()).not.toContain('C21:240')
  })

  test('a pull with the flag stamps the remote printing and finish onto the line', async () => {
    await writeLinkedDeck([{ quantity: 1, name: 'Sol Ring', cardId: 1 }], synced)
    stubFetch(pushRoutes(UPDATED_AT, { modifier: 'Foil', options: ['Normal', 'Foil'] }))

    expect(await runDeckSync(['pull', '--sync-printings'])).toBe(0)

    expect(logged()).toContain(
      'Changes: +0 added, -0 removed, ~0 quantity changed, 1 printing changed',
    )
    // The line keeps its &N and gains the printing; the changelog records it.
    expect(await readDeck()).toContain('1 Sol Ring (C21:240) [foil] &1')
    const changelog = await fs.readFile(path.join(dir, 'decks', 'winota-stax.changes.md'), 'utf-8')
    expect(changelog).toContain('Set "Sol Ring" printing to C21:240 [foil] &1')
  })

  test('a push without the flag reports nothing to upload', async () => {
    await writeLinkedDeck(
      [{ quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'foil' }],
      synced,
    )
    stubFetch(pushRoutes(UPDATED_AT))

    expect(await runDeckSync(['push'])).toBe(0)
    expect(logged()).toContain('No changes to upload.')
    expect(pushedEntries()).toEqual([])
  })

  test('a push with the flag moves the remote entry to the local printing and finish', async () => {
    await writeLinkedDeck(
      [{ quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'foil' }],
      synced,
    )
    stubFetch({
      ...pushRoutes(UPDATED_AT),
      [SEARCH_URL]: () =>
        Response.json({
          results: [
            {
              id: 777,
              collectorNumber: '284',
              options: ['Normal', 'Foil'],
              oracleCard: { name: 'Sol Ring', defaultCategory: 'Artifact' },
            },
          ],
          next: null,
        }),
    })

    expect(await runDeckSync(['push', '--sync-printings'])).toBe(0)

    // The target edition is resolved through the printing search, pinned by
    // set and collector number.
    const search = sent.find((request) => request.url.startsWith(SEARCH_URL))
    expect(search?.url).toContain('editionSearch=ltc')
    expect(search?.url).toContain('collectorNumber=284')
    expect(logged()).toContain('1 printing to change')
    expect(pushedEntries()).toEqual([
      {
        action: 'modify',
        cardid: 777,
        customCardId: null,
        categories: ['Artifact'],
        patchId: 'ritual-1',
        modifications: {
          quantity: 1,
          modifier: 'Foil',
          customCmc: null,
          companion: false,
          flippedDefault: false,
          label: ',#656565',
        },
        deckRelationId: 11,
      },
    ])
    expect(logged()).toContain('Updated lastSynced.')
  })

  test('a push changing only the finish reuses the remote edition without searching', async () => {
    await writeLinkedDeck(
      [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'foil' }],
      synced,
    )
    stubFetch(pushRoutes(UPDATED_AT, { options: ['Normal', 'Foil'] }))

    expect(await runDeckSync(['push', '--sync-printings'])).toBe(0)

    // Same edition, so no printing search happens — only the modifier moves.
    expect(sent.some((request) => request.url.startsWith(SEARCH_URL))).toBe(false)
    const [entry] = pushedEntries() as { cardid: number; modifications: { modifier: string } }[]
    expect(entry!.cardid).toBe(501)
    expect(entry!.modifications.modifier).toBe('Foil')
  })

  test('a stated finish the printing does not offer fails the deck', async () => {
    await writeLinkedDeck(
      [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'etched' }],
      synced,
    )
    stubFetch(pushRoutes(UPDATED_AT, { options: ['Normal', 'Foil'] }))

    expect(await runDeckSync(['push', '--sync-printings'])).toBe(1)
    expect(logged()).toContain('Finish "etched" is not offered for Sol Ring (C21:240)')
    expect(pushedEntries()).toEqual([])
    expect(logged()).not.toContain('Updated lastSynced.')
  })

  test('an unstated finish on a foil-only printing pushes nothing', async () => {
    // The bare line "wants" nonfoil, but the printing only exists in foil — the
    // fallback resolves to what the remote already records, so nothing is sent
    // and the run does not churn on every sync.
    await writeLinkedDeck(
      [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }],
      synced,
    )
    stubFetch(pushRoutes(UPDATED_AT, { modifier: 'Foil', options: ['Foil'] }))

    expect(await runDeckSync(['push', '--sync-printings'])).toBe(0)
    expect(pushedEntries()).toEqual([])
  })

  test('a card with several local printings is skipped with a warning, not guessed at', async () => {
    await writeLinkedDeck(
      [
        { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' },
        { quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '270' },
      ],
      synced,
    )
    stubFetch(pushRoutes(UPDATED_AT))

    // --only removals neutralizes the quantity increase (local 2 vs remote 1),
    // so the printing skip is the only thing left for the run to say.
    expect(await runDeckSync(['push', '--sync-printings', '--only', 'removals'])).toBe(0)
    expect(logged()).toContain(
      'Printing not synced for "Sol Ring": the card has several distinct printings in the local file.',
    )
    expect(pushedEntries()).toEqual([])
  })

  test('a quantity and printing change on one card folds into a single modify entry', async () => {
    // Two entries naming the same deckRelationId would race each other, so the
    // printing target rides the quantity change's entry.
    await writeLinkedDeck(
      [{ quantity: 2, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' }],
      synced,
    )
    stubFetch({
      ...pushRoutes(UPDATED_AT, { options: ['Normal', 'Foil'] }),
      [SEARCH_URL]: () =>
        Response.json({
          results: [
            {
              id: 777,
              collectorNumber: '284',
              options: ['Normal', 'Foil'],
              oracleCard: { name: 'Sol Ring', defaultCategory: 'Artifact' },
            },
          ],
          next: null,
        }),
    })

    expect(await runDeckSync(['push', '--sync-printings'])).toBe(0)

    const entries = pushedEntries() as {
      action: string
      cardid: number
      deckRelationId?: number
      modifications: { quantity: number }
    }[]
    expect(entries).toHaveLength(1)
    expect(entries[0]!.action).toBe('modify')
    expect(entries[0]!.cardid).toBe(777)
    expect(entries[0]!.deckRelationId).toBe(11)
    expect(entries[0]!.modifications.quantity).toBe(2)
  })

  test('a printing change moves every remote relation of the card', async () => {
    // The remote splits Sol Ring across two deck relations (1 + 2 copies) of
    // the same printing; the local file holds all three at a different one.
    // Both relations must move, each keeping its own quantity.
    const second = remoteEntry(12, 'Sol Ring', 2, SOL_RING_PRINTING)
    await writeLinkedDeck(
      [{ quantity: 3, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' }],
      synced,
    )
    stubFetch({
      ...pushRoutes(UPDATED_AT, {}, [second]),
      [SEARCH_URL]: () =>
        Response.json({
          results: [
            {
              id: 777,
              collectorNumber: '284',
              options: ['Normal'],
              oracleCard: { name: 'Sol Ring', defaultCategory: 'Artifact' },
            },
          ],
          next: null,
        }),
    })

    expect(await runDeckSync(['push', '--sync-printings'])).toBe(0)

    const entries = pushedEntries() as {
      cardid: number
      deckRelationId?: number
      modifications: { quantity: number }
    }[]
    expect(entries.map((entry) => entry.deckRelationId)).toEqual([11, 12])
    expect(entries.every((entry) => entry.cardid === 777)).toBe(true)
    expect(entries.map((entry) => entry.modifications.quantity)).toEqual([1, 2])
  })

  test('a pull adds a new card with its remote printing and finish', async () => {
    const foilBolt = remoteEntry(
      22,
      'Lightning Bolt',
      1,
      { set: '2xm', collectorNumber: '117', cardId: 601 },
      { modifier: 'Foil', options: ['Normal', 'Foil'] },
    )
    await writeLinkedDeck(
      [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
      synced,
    )
    stubFetch(pushRoutes(UPDATED_AT, {}, [foilBolt]))

    expect(await runDeckSync(['pull', '--sync-printings'])).toBe(0)

    expect(await readDeck()).toContain('1 Lightning Bolt (2XM:117) [foil] &2')
    const changelog = await fs.readFile(path.join(dir, 'decks', 'winota-stax.changes.md'), 'utf-8')
    expect(changelog).toContain('Added "Lightning Bolt" (2XM:117) [foil] &2')
  })
})
