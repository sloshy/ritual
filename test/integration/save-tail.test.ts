/**
 * The shared save tail's ordering guarantee.
 *
 * `finishListSave` writes the list file before appending the changelog, and the
 * deck route was converged onto that order. Neither order is atomic, so the
 * question is which half survives a crash between the two: a written file with a
 * missing history line (a benign gap) or a history line describing an edit the
 * file never received (a phantom that `ritual history`, the change-bundle
 * export, undo, and the sync flows all act on).
 *
 * The failure is injected by making the changelog path unwritable — a directory
 * where the `.changes.md` file belongs — which is deterministic and needs no
 * seam in production code.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { ensureDeckFile, loadDeck } from '../../src/commands/deck-helpers'
import { applyChangeToDeck } from '../../src/editor/deck-changes'
import { assignMissingDeckCardIds } from '../../src/card/card-id'
import { createAddChange } from '../../src/changes/change-event'
import { computeHash } from '../../src/changes/content-hash'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace()
})

afterEach(async () => {
  await ws.dispose()
})

describe('finishListSave ordering (Integration)', () => {
  test('a deck save whose changelog write fails still leaves the deck file written', async () => {
    const filePath = await ensureDeckFile('Ordering Deck', 'commander')
    const loaded = await loadDeck(filePath)
    const hash = computeHash(await fs.readFile(filePath, 'utf-8'))

    // A directory where the changelog file belongs: `appendChangelog`'s write throws.
    const changelogPath = filePath.replace(/\.md$/, '.changes.md')
    await fs.mkdir(changelogPath, { recursive: true })

    const change = createAddChange('Sol Ring', { section: 'Main' })
    const deck = assignMissingDeckCardIds(applyChangeToDeck(loaded.deck, change))

    const resp = await handleDeckSave(
      new Request('http://localhost/api/deck/Ordering Deck/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: [change],
          deck,
          frontMatter: loaded.frontMatter,
          contentHash: hash,
        }),
      }),
    )

    expect(resp.status).toBe(500)
    // The list file is the half that survived: the card is on disk.
    expect(await fs.readFile(filePath, 'utf-8')).toContain('Sol Ring')
    // And no changelog artifact claims an edit — the blocking directory is still
    // empty, so nothing was written beside or inside it. (Asserting it is still a
    // directory would only restate the fixture.)
    expect(await fs.readdir(changelogPath)).toEqual([])
  })
})
