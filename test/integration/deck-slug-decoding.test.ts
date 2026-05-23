import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { getBaseDir, setBaseDir } from '../../src/base-dir'
import { initRitualConfig } from '../../src/ritual-config'
import { handleDeckLoad } from '../../src/admin/api/deck-load'
import { handleDeckRename } from '../../src/admin/api/deck-rename'

type DeckApiResult = { success: boolean; message?: string }

/**
 * Regression coverage for the admin deck API slug handling. Deck list slugs are
 * filename stems that routinely contain spaces (e.g. `My Test Deck`), which the
 * browser percent-encodes in the request path (`My%20Test%20Deck`). The deck
 * handlers must `decodeURIComponent` that segment before resolving the file on
 * disk — otherwise the deck editor (and the Manage Lists "Edit" deep link)
 * fails with "Failed to load deck". These tests stay off the card-cache code
 * path (which would require network/bulk data) by asserting on the not-found
 * path for load and a pure file rename.
 */
describe('admin deck API slug decoding', () => {
  let tmpDir: string
  let originalBaseDir: string

  beforeAll(async () => {
    originalBaseDir = getBaseDir()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-deck-slug-'))
    await fs.mkdir(path.join(tmpDir, 'decks'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'ritual.config.json'),
      JSON.stringify({
        decksDir: './decks',
        collectionsDir: './collections',
        wantedDir: './wanted',
      }),
    )
    // A deck whose name (and thus slug/filename) contains spaces.
    await fs.writeFile(
      path.join(tmpDir, 'decks', 'My Test Deck.md'),
      '---\nname: My Test Deck\nformat: commander\n---\n\n# My Test Deck\n',
    )
    setBaseDir(tmpDir)
    await initRitualConfig()
  })

  afterAll(async () => {
    setBaseDir(originalBaseDir)
    await initRitualConfig()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('decodes a percent-encoded slug on the load path', async () => {
    // The browser sends `My Missing Deck` as `My%20Missing%20Deck`. The handler
    // must decode before resolving, so the not-found message names the real slug
    // (`My Missing Deck`) — not the still-encoded `My%20Missing%20Deck` it would
    // report if the decode were skipped.
    const resp = await handleDeckLoad(new Request('http://localhost/api/deck/My%20Missing%20Deck'))
    const body = (await resp.json()) as DeckApiResult
    expect(resp.status).toBe(404)
    expect(body.message).toContain("Deck 'My Missing Deck' not found")
  })

  test('resolves an existing deck via a percent-encoded slug (rename)', async () => {
    const resp = await handleDeckRename(
      new Request('http://localhost/api/deck/My%20Test%20Deck/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: 'My Renamed Deck' }),
      }),
    )
    const body = (await resp.json()) as DeckApiResult
    expect(resp.status).toBe(200)
    expect(body.success).toBe(true)
    // The renamed file exists (slug was decoded to find the original) and the
    // original is gone.
    expect(await Bun.file(path.join(tmpDir, 'decks', 'My Renamed Deck.md')).exists()).toBe(true)
    expect(await Bun.file(path.join(tmpDir, 'decks', 'My Test Deck.md')).exists()).toBe(false)
  })
})
