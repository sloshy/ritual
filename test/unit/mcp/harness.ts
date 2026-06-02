import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getBaseDir, setBaseDir } from '../../../src/base-dir'
import { cardCache } from '../../../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../../../src/logger'
import { initRitualConfig, resetRitualConfigCache } from '../../../src/ritual-config'

/**
 * A temp Ritual workspace for MCP tests: synthetic deck/collection/wanted files
 * under a throwaway base dir, with Scryfall stubbed offline and the card cache
 * marked fresh so the load endpoints never trigger a network download.
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
  await initRitualConfig()

  // Silence the offline-stub's "card not found" / symbology chatter from the logger.
  setLogger(new MemoryLogger())
  globalThis.fetch = stubScryfallFetch as typeof fetch
  // Mark the card cache as freshly bulk-downloaded so ensureCacheForCards skips the
  // (network) bulk preload; the small synthetic decks stay under the fetch threshold.
  await cardCache.bulkSet({})

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
