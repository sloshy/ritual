import fs from 'node:fs/promises'
import path from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { buildMcpServer } from '../../../src/mcp/server'
import { cardCache } from '../../../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../../../src/util/logger'
import { makeScryfallCard } from '../../test-utils'
import { bindWorkspace } from '../../helpers/workspace'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'

/**
 * Card names the seeded cache knows.
 *
 * The write tools validate every card name they are given against the local
 * cache, so a wiring test that adds a card needs the cache to know it. Names
 * outside this list ("Definitely Not A Card") are what the unknown-name legs
 * use, so keep it to cards the suite actually means to succeed with.
 */
export const CACHED_CARD_NAMES = [
  'Sol Ring',
  'Lightning Bolt',
  'Counterspell',
  'Brainstorm',
  'Llanowar Elves',
  'Arcane Signet',
]

/**
 * A temp Ritual workspace for MCP tests: synthetic deck/collection/wanted files
 * under a throwaway base dir, with Scryfall stubbed offline and the card cache
 * seeded with a handful of real names (and thereby marked fresh, so the load
 * endpoints never trigger a network download).
 */
export type RitualTestEnv = {
  dir: string
  cleanup: () => Promise<void>
}

const TEST_DECK = `---
format: "commander"
---

# Test Deck

## Commander

1 Sol Ring &1

## Main

1 Lightning Bolt &2
`

/**
 * Offline Scryfall stub: symbology returns an empty list (200); every other URL
 * returns 404 so the card-data loaders resolve cards to null without the
 * network. Routed rather than thrown on, because a card lookup finding nothing
 * is the state these suites are in, not a failure.
 */
function stubScryfallFetch(): StubbedFetch {
  return stubFetch({
    '': () => Response.json({ object: 'error', code: 'not_found', status: 404 }, { status: 404 }),
    'https://api.scryfall.com/symbology': () =>
      Response.json({ object: 'list', has_more: false, data: [] }),
  })
}

/**
 * A workspace plus a client already talking to a server over it.
 *
 * `close` tears both down in the right order (client first, so the transport is
 * not closed under an in-flight request), which is the half every suite that
 * drives real tool calls had to write out for itself.
 */
export type McpTestSession = {
  env: RitualTestEnv
  client: Client
  close: () => Promise<void>
}

/**
 * {@link setupRitualTestEnv} wired to an in-memory client/server pair.
 *
 * `InMemoryTransport` links 2025-era instances only, so this is the legacy leg —
 * the modern (2026-07-28) leg has no in-memory serving entry and is driven
 * through `createMcpHandler`'s own fetch instead. Suites that pin era behavior
 * assert it explicitly rather than assuming what this returns.
 */
export async function setupMcpClient(clientName = 'ritual-test'): Promise<McpTestSession> {
  const env = await setupRitualTestEnv()
  const client = new Client({ name: clientName, version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([buildMcpServer().connect(serverTransport), client.connect(clientTransport)])
  return {
    env,
    client,
    close: async () => {
      await client.close()
      await env.cleanup()
    },
  }
}

/** The seeded shoebox collection every write suite rewrites. */
export function shoeboxPath(session: McpTestSession): string {
  return path.join(session.env.dir, 'collections', 'shoebox.md')
}

/**
 * A cached card's first printing as a card line writes it (`SET:CN`, set code
 * uppercase — markdown is the one place set codes are not lowercase). Derived
 * from the seeded cache so a line the suite writes always resolves.
 */
export async function cachedPrintingRef(name: string): Promise<string> {
  const printings = (await cardCache.get(name)) ?? []
  const printing = printings[0]!
  return `${printing.set.toUpperCase()}:${printing.collector_number}`
}

export async function setupRitualTestEnv(): Promise<RitualTestEnv> {
  const ws = await bindWorkspace({ init: true })
  const dir = ws.dir
  await fs.writeFile(path.join(dir, 'decks', 'test-deck.md'), TEST_DECK)
  await fs.writeFile(path.join(dir, 'collections', 'shoebox.md'), '# Shoebox\n\n')
  await fs.writeFile(path.join(dir, 'wanted', 'wishlist.md'), '# Wishlist\n\n')

  // Silence the offline-stub's "card not found" / symbology chatter from the logger.
  setLogger(new MemoryLogger())
  const scryfall = stubScryfallFetch()
  // Seeding also marks the cache as freshly bulk-downloaded, so ensureCacheForCards
  // skips the (network) bulk preload; the small synthetic decks stay under the
  // fetch threshold.
  await cardCache.bulkSet(
    Object.fromEntries(
      CACHED_CARD_NAMES.map((name) => [name, [makeScryfallCard({ name, set: 'lea' })]]),
    ),
  )

  return {
    dir,
    cleanup: async () => {
      scryfall.restore()
      resetLogger()
      // Reset the module-level card cache so entries/metadata don't leak into the
      // next test that reuses this process with a different base dir.
      await cardCache.clear()
      await ws.dispose()
    },
  }
}
