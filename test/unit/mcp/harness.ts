import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { getBaseDir, setBaseDir } from '../../../src/config/base-dir'
import { buildMcpServer } from '../../../src/mcp/server'
import { cardCache } from '../../../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../../../src/util/logger'
import { refreshRitualConfig, resetRitualConfigCache } from '../../../src/config/ritual-config'
import { makeScryfallCard } from '../../test-utils'

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
name: "Test Deck"
format: "commander"
---

# Test Deck

## Commander

1 Sol Ring &1

## Main

1 Lightning Bolt &2
`

/**
 * Offline Scryfall stub: symbology returns an empty list (200); every card lookup
 * returns 404 so the card-data loaders resolve cards to null without the network.
 */
function stubScryfallFetch(input: string | URL | Request): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('/symbology')) {
    return Promise.resolve(
      Response.json({ object: 'list', has_more: false, data: [] }, { status: 200 }),
    )
  }
  return Promise.resolve(
    Response.json({ object: 'error', code: 'not_found', status: 404 }, { status: 404 }),
  )
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

export async function setupRitualTestEnv(): Promise<RitualTestEnv> {
  const originalBase = getBaseDir()
  const originalFetch = globalThis.fetch

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-mcp-'))
  await Promise.all(
    ['decks', 'collections', 'wanted'].map((sub) =>
      fs.mkdir(path.join(dir, sub), { recursive: true }),
    ),
  )
  await fs.writeFile(path.join(dir, 'decks', 'test-deck.md'), TEST_DECK)
  await fs.writeFile(path.join(dir, 'collections', 'shoebox.md'), '# Shoebox\n\n')
  await fs.writeFile(path.join(dir, 'wanted', 'wishlist.md'), '# Wishlist\n\n')

  setBaseDir(dir)
  resetRitualConfigCache()
  await refreshRitualConfig()

  // Silence the offline-stub's "card not found" / symbology chatter from the logger.
  setLogger(new MemoryLogger())
  globalThis.fetch = stubScryfallFetch as typeof fetch
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
      globalThis.fetch = originalFetch
      resetLogger()
      // Reset the module-level card cache so entries/metadata don't leak into the
      // next test that reuses this process with a different base dir.
      await cardCache.clear()
      setBaseDir(originalBase)
      resetRitualConfigCache()
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}
