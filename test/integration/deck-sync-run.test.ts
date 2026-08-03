import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Command } from 'commander'
import { registerDeckSyncCommand } from '../../src/commands/deck-sync'
import { MemoryLogger, resetLogger, setLogger } from '../../src/logger'
import {
  signIn,
  stubArchidekt,
  TEST_ACCOUNT,
  type StubbedRequest,
  type StubRoute,
} from './helpers/archidekt'
import { bindWorkspace, writeDeckFile, type BoundWorkspace } from './helpers/workspace'

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
  const program = new Command()
  program.exitOverride()
  registerDeckSyncCommand(program)
  process.exitCode = 0
  await program.parseAsync(['deck-sync', ...args], { from: 'user' })
  const exitCode = process.exitCode ?? 0
  process.exitCode = 0
  return exitCode
}

/** Run `action` with stdout captured; returns everything it wrote. */
async function captureStdout(action: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk: string): boolean => {
    chunks.push(String(chunk))
    return true
  }
  try {
    await action()
  } finally {
    process.stdout.write = write
  }
  return chunks.join('')
}

function logged(): string {
  return logger.entries.map((entry) => entry.args.map((arg) => String(arg)).join(' ')).join('\n')
}

/** The raw deck payload a push reads, holding one Sol Ring. */
function remoteDeck(updatedAt: string): unknown {
  return {
    id: Number(DECK_ID),
    name: 'Winota Stax',
    owner: { id: TEST_ACCOUNT.id, username: TEST_ACCOUNT.username },
    categories: [],
    updatedAt,
    cards: [
      {
        id: 11,
        quantity: 1,
        modifier: 'Normal',
        categories: ['Artifact'],
        companion: false,
        flippedDefault: false,
        label: ',#656565',
        customCmc: null,
        card: {
          id: 501,
          uid: 'uid-sol-ring',
          collectorNumber: '240',
          options: ['Normal'],
          oracleCard: { id: 900, name: 'Sol Ring', defaultCategory: 'Artifact' },
          edition: { editioncode: 'c21' },
        },
      },
    ],
  }
}

/** Routes for a push against a remote deck last updated at `updatedAt`. */
function pushRoutes(updatedAt: string): Record<string, StubRoute> {
  return {
    [OWN_DECKS_URL]: () =>
      Response.json({ results: [{ id: Number(DECK_ID), name: 'Winota Stax' }], next: null }),
    [MODIFY_URL]: () => Response.json({ success: true }),
    [DECK_URL]: () => Response.json(remoteDeck(updatedAt)),
  }
}

/**
 * A deck file linked to Archidekt, holding the given cards.
 *
 * `synced` stamps both sync keys: `lastSynced` (the local clock, for display)
 * and `sourceUpdatedAt` (the remote's own `updatedAt`, which is the only thing
 * the divergence guard compares). Omitted, the deck has never synced.
 */
async function writeLinkedDeck(
  cards: { quantity: number; name: string }[],
  synced?: { lastSynced?: string; sourceUpdatedAt?: string },
): Promise<string> {
  return writeDeckFile(dir, 'winota-stax', {
    frontMatter: {
      name: 'Winota Stax',
      sourceId: DECK_ID,
      sourceUrl: `https://archidekt.com/decks/${DECK_ID}`,
      ...(synced?.lastSynced === undefined ? {} : { lastSynced: synced.lastSynced }),
      ...(synced?.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: synced.sourceUpdatedAt }),
    },
    cards: cards.map((card) => ({ ...card })),
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
    const stdout = await captureStdout(async () => {
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
    const stdout = await captureStdout(async () => {
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

    const stdout = await captureStdout(async () => {
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

    const json = await captureStdout(async () => {
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

    const quiet = await captureStdout(async () => {
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
    const stdout = await captureStdout(async () => {
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
    const stdout = await captureStdout(async () => {
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

    const stdout = await captureStdout(async () => {
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
    expect(sent.some((request) => request.url.startsWith(MODIFY_URL))).toBe(false)
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

    expect(sent.some((request) => request.url.startsWith(MODIFY_URL))).toBe(true)
    expect(logged()).toContain('Updated lastSynced.')
    // The baseline moves to the remote's own post-push timestamp, so the next
    // push is not refused over the change this one made.
    expect(await readDeck()).toContain("sourceUpdatedAt: '2026-08-02T00:00:00.000Z'")
  })

  test('a deck that never synced has nothing to diverge from', async () => {
    await writeLinkedDeck([])
    stubFetch(pushRoutes('2026-08-02T00:00:00.000Z'))

    expect(await runDeckSync(['push'])).toBe(0)
    expect(sent.some((request) => request.url.startsWith(MODIFY_URL))).toBe(true)
  })

  test('an unusable remote timestamp pushes anyway, but says the guard did not run', async () => {
    // Fails open on purpose — but silently failing open is how a response-shape
    // change would disable the guard without anyone noticing.
    await writeLinkedDeck([], { sourceUpdatedAt: '2026-08-01T00:00:00.000Z' })
    stubFetch(pushRoutes('not a timestamp'))

    expect(await runDeckSync(['push'])).toBe(0)
    expect(logged()).toContain('pushing without the divergence check')
    expect(sent.some((request) => request.url.startsWith(MODIFY_URL))).toBe(true)
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
    expect(sent.some((request) => request.url.startsWith(MODIFY_URL))).toBe(true)
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
      'https://archidekt.com/api/cards/v2/': () => Response.json({ results: [], next: null }),
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
