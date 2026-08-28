import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { loadDeck } from '../../src/list/deck-io'
import { ensureDeckFile } from '../../src/list/ensure-list-file'
import { applyChangeToDeck } from '../../src/changes/deck-changes'
import { assignMissingDeckCardIds } from '../../src/card/card-id'
import { createAddChange } from '../../src/changes/change-event'
import { computeHash } from '../../src/changes/content-hash'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import type { DeckData } from '../../src/list/deck'
import type { ChangeEvent } from '../../src/changes/change-event'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace()
})

afterEach(async () => {
  await ws.dispose()
})

type SaveResult = { contentHash?: string; success: boolean }

/** Drive one admin deck save and return the parsed response. */
async function saveDeck(
  slug: string,
  deck: DeckData,
  frontMatter: Record<string, unknown>,
  changes: ChangeEvent[],
  contentHash: string,
  continueSession: boolean,
): Promise<SaveResult> {
  const req = new Request(`http://localhost/api/deck/${slug}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes, deck, frontMatter, contentHash, continueSession }),
  })
  const resp = await handleDeckSave(req)
  return (await resp.json()) as SaveResult
}

/** Count the `## ` blocks (one per changelog entry) in a changelog file. */
function countBlocks(content: string): number {
  return content.split('\n').filter((line) => line.startsWith('## ')).length
}

describe('changelog session grouping (admin save, Integration)', () => {
  test('a second save with continueSession folds into the same changelog block', async () => {
    const filePath = await ensureDeckFile('Session Deck', 'commander')
    const slug = 'Session Deck'
    const loaded = await loadDeck(filePath)

    // First save: add Sol Ring, opening a new changelog block.
    const change1 = createAddChange('Sol Ring', { section: 'Main' })
    const deck1 = assignMissingDeckCardIds(applyChangeToDeck(loaded.deck, change1))
    const hash0 = computeHash(await fs.readFile(filePath, 'utf-8'))
    const res1 = await saveDeck(slug, deck1, loaded.frontMatter, [change1], hash0, false)
    expect(res1.success).toBe(true)

    // Second save in the same session: add Lightning Bolt with continueSession.
    const change2 = createAddChange('Lightning Bolt', { section: 'Main' })
    const deck2 = assignMissingDeckCardIds(applyChangeToDeck(deck1, change2))
    const res2 = await saveDeck(
      slug,
      deck2,
      loaded.frontMatter,
      [change2],
      res1.contentHash ?? '',
      true,
    )
    expect(res2.success).toBe(true)

    const changelog = await fs.readFile(filePath.replace(/\.md$/, '.changes.md'), 'utf-8')
    expect(countBlocks(changelog)).toBe(1)
    expect(changelog).toContain('- Added "Sol Ring"')
    expect(changelog).toContain('- Added "Lightning Bolt"')
  })

  test('a second save without continueSession opens a new changelog block', async () => {
    const filePath = await ensureDeckFile('Session Deck', 'commander')
    const slug = 'Session Deck'
    const loaded = await loadDeck(filePath)

    const change1 = createAddChange('Sol Ring', { section: 'Main' })
    const deck1 = assignMissingDeckCardIds(applyChangeToDeck(loaded.deck, change1))
    const hash0 = computeHash(await fs.readFile(filePath, 'utf-8'))
    const res1 = await saveDeck(slug, deck1, loaded.frontMatter, [change1], hash0, false)
    expect(res1.success).toBe(true)

    const change2 = createAddChange('Lightning Bolt', { section: 'Main' })
    const deck2 = assignMissingDeckCardIds(applyChangeToDeck(deck1, change2))
    await saveDeck(slug, deck2, loaded.frontMatter, [change2], res1.contentHash ?? '', false)

    const changelog = await fs.readFile(filePath.replace(/\.md$/, '.changes.md'), 'utf-8')
    expect(countBlocks(changelog)).toBe(2)
  })
})
