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
import { loadDeck } from '../../src/list/deck-io'
import { ensureDeckFile } from '../../src/list/ensure-list-file'
import { applyChangeToDeck } from '../../src/changes/deck-changes'
import { assignMissingDeckCardIds } from '../../src/card/card-id'
import {
  createAddChange,
  createRemoveChange,
  createSetCategoriesChange,
  createSetCategoryOrderChange,
  type ChangeEvent,
} from '../../src/changes/change-event'
import type { ListSaveResponse } from '../../src/admin/api/list-save'
import { computeHash } from '../../src/changes/content-hash'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

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

describe('finishListSave — categories sidecar (Integration)', () => {
  /** Post a deck save built from the file's current state plus `changes`. */
  async function save(
    filePath: string,
    changes: ChangeEvent[],
    slug: string,
  ): Promise<ListSaveResponse> {
    const loaded = await loadDeck(filePath)
    const hash = computeHash(await fs.readFile(filePath, 'utf-8'))
    let deck = loaded.deck
    for (const change of changes) deck = applyChangeToDeck(deck, change)
    const resp = await handleDeckSave(
      new Request(`http://localhost/api/deck/${slug}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes,
          deck: assignMissingDeckCardIds(deck),
          frontMatter: loaded.frontMatter,
          contentHash: hash,
        }),
      }),
    )
    expect(resp.status).toBe(200)
    return (await resp.json()) as ListSaveResponse
  }

  test('a set-categories writes the sidecar and its hash, and a later removal prunes it', async () => {
    const filePath = await ensureDeckFile('Categorized', 'commander')
    const sidecarPath = filePath.replace(/\.md$/, '.categories.json')

    await save(
      filePath,
      [
        createAddChange('Sol Ring', { section: 'Main' }),
        createSetCategoriesChange('Sol Ring', ['Ramp', 'Artifacts']),
      ],
      'Categorized',
    )
    const written = JSON.parse(await fs.readFile(sidecarPath, 'utf-8')) as {
      cards: Record<string, string[]>
    }
    expect(written.cards).toEqual({ 'Sol Ring': ['Ramp', 'Artifacts'] })
    expect((await fs.readFile(`${sidecarPath}.sha256`, 'utf-8')).trim()).toBe(
      computeHash(await fs.readFile(sidecarPath, 'utf-8')),
    )

    // The same card removed: the sidecar is keyed by name, so the entry goes
    // with the last line of that name, and the save reports what it dropped.
    const loaded = await loadDeck(filePath)
    const cardId = loaded.deck.sections[0]?.cards[0]?.cardId
    const body = await save(
      filePath,
      [createRemoveChange('Sol Ring', { section: 'Main', cardId })],
      'Categorized',
    )
    expect(body.prunedCategories).toEqual(['Sol Ring'])
    const pruned = JSON.parse(await fs.readFile(sidecarPath, 'utf-8')) as {
      order: string[]
      cards: Record<string, string[]>
    }
    expect(pruned.cards).toEqual({})
    // The vocabulary survives the last card: it is the owner's, not the card's.
    expect(pruned.order).toEqual(['Ramp', 'Artifacts'])
  })

  test('clearing the last assignment removes the sidecar and its hash', async () => {
    const filePath = await ensureDeckFile('Cleared', 'commander')
    const sidecarPath = filePath.replace(/\.md$/, '.categories.json')
    await save(
      filePath,
      [
        createAddChange('Sol Ring', { section: 'Main' }),
        createSetCategoriesChange('Sol Ring', ['Ramp']),
      ],
      'Cleared',
    )
    expect(await Bun.file(sidecarPath).exists()).toBe(true)

    // Clearing the card alone keeps the file: the vocabulary is the owner's, not
    // the card's. Clearing the vocabulary too empties the record entirely.
    await save(
      filePath,
      [createSetCategoriesChange('Sol Ring', []), createSetCategoryOrderChange([])],
      'Cleared',
    )
    // An empty record leaves no file behind — the list is as it was before any
    // category was set — and both deletions are what the save reports.
    expect(await Bun.file(sidecarPath).exists()).toBe(false)
    expect(await Bun.file(`${sidecarPath}.sha256`).exists()).toBe(false)
  })

  test('an unreadable sidecar warns, writes the card lines, and records no category history', async () => {
    const filePath = await ensureDeckFile('Broken Sidecar', 'commander')
    const sidecarPath = filePath.replace(/\.md$/, '.categories.json')
    const malformed = '{ nope'
    await fs.writeFile(sidecarPath, malformed)

    const body = await save(
      filePath,
      [
        createAddChange('Sol Ring', { section: 'Main' }),
        createSetCategoriesChange('Sol Ring', ['Ramp']),
      ],
      'Broken Sidecar',
    )

    // The card lines are written; the sidecar Ritual cannot parse is left alone.
    expect(await fs.readFile(filePath, 'utf-8')).toContain('Sol Ring')
    expect(await fs.readFile(sidecarPath, 'utf-8')).toBe(malformed)
    expect(body.categoryWarnings?.join(' ')).toContain(sidecarPath)
    // No phantom history: the categories event never reached the sidecar, so it
    // is not recorded as though it had.
    const changelog = await fs.readFile(filePath.replace(/\.md$/, '.changes.md'), 'utf-8')
    expect(changelog).toContain('Added')
    expect(changelog).not.toContain('Set categories')
  })

  test('a save touching no category leaves a hand-edited sidecar byte-identical', async () => {
    const filePath = await ensureDeckFile('Untouched', 'commander')
    const sidecarPath = filePath.replace(/\.md$/, '.categories.json')
    await save(filePath, [createAddChange('Sol Ring', { section: 'Main' })], 'Untouched')

    // A hand-written sidecar, already canonical, with a deliberately stale hash.
    const handWritten = `{
  "order": [
    "Ramp"
  ],
  "cards": {
    "Sol Ring": [
      "Ramp"
    ]
  }
}
`
    await fs.writeFile(sidecarPath, handWritten)
    await fs.writeFile(`${sidecarPath}.sha256`, 'stalehash\n')

    const body = await save(filePath, [createAddChange('Island', { section: 'Main' })], 'Untouched')
    expect(await fs.readFile(sidecarPath, 'utf-8')).toBe(handWritten)
    expect(await fs.readFile(`${sidecarPath}.sha256`, 'utf-8')).toBe('stalehash\n')
    // Nothing was pruned and nothing warned, so neither field is on the body.
    expect(Object.keys(body)).not.toContain('prunedCategories')
    expect(Object.keys(body)).not.toContain('categoryWarnings')
  })
})
