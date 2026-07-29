import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import path from 'node:path'
import { handleDeckLoad } from '../../src/admin/api/deck-load'
import { handleListRename, type ListLifecycleConfig } from '../../src/admin/api/list-lifecycle'
import { resolveDeckFile } from '../../src/admin/api/list-file'
import { bindWorkspace, writeDeckFile, type BoundWorkspace } from './helpers/workspace'
import { getDecksDir } from '../../src/ritual-config'

const DECK_CFG: ListLifecycleConfig = {
  kind: 'deck',
  getDir: getDecksDir,
  label: 'deck',
  resolveFile: resolveDeckFile,
}

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
  let ws: BoundWorkspace
  let tmpDir: string

  beforeAll(async () => {
    ws = await bindWorkspace({ dirs: ['decks'], init: true })
    tmpDir = ws.dir
    // A deck whose name (and thus slug/filename) contains spaces.
    await writeDeckFile(tmpDir, 'My Test Deck', {
      frontMatter: { name: 'My Test Deck', format: 'commander' },
    })
  })

  afterAll(async () => {
    await ws.dispose()
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
    const resp = await handleListRename(
      new Request('http://localhost/api/deck/My%20Test%20Deck/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: 'My Renamed Deck' }),
      }),
      DECK_CFG,
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
