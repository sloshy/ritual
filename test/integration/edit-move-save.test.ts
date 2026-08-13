import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createAddChange, createMoveFromChange, createRemoveChange } from '../../src/change-event'
import type { ListType } from '../../src/list-type'
import { openListSession, saveOpenList, type OpenList } from '../../src/commands/edit-lists'
import type { DeckSessionConfig } from '../../src/commands/deck-helpers'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from './helpers/workspace'

/**
 * The unified editor's save path for cross-list moves (`saveOpenList`): a saved
 * `move-from` must always land its `move-to` half — on disk for a destination
 * that is not open in the editor, and through the open session (saved in the
 * same step) for one that is. The move *recording* semantics are pinned by the
 * unit tests in `test/unit/{flat-list,deck}-edit.test.ts`; this covers the
 * wiring and file side effects only.
 */

let ws: BoundWorkspace
let tmpDir: string

// Fresh per test: sessions hold onto it, so sharing one across tests could
// leak collector-set state between cases.
let sessionConfig: DeckSessionConfig

beforeEach(async () => {
  sessionConfig = {
    entryMode: 'name',
    collectorSets: [],
    activeSetIndex: 0,
    setCardMaps: new Map(),
    targetSection: null,
  }
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
  await writeCollectionFile(tmpDir, 'binder', {
    title: 'Binder',
    entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
  })
  await writeWantedFile(tmpDir, 'wishlist', {
    title: 'Wishlist',
    entries: [{ name: 'Brainstorm', set: 'ice', collectorNumber: '61', cardId: 1 }],
  })
  await writeDeckFile(tmpDir, 'my-deck', {
    frontMatter: { name: 'My Deck' },
    cards: [{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
  })
})

afterEach(async () => {
  await ws.dispose()
})

/** Open one of the fixture lists into a live session. */
async function openFixtureList(type: ListType, name: string, file: string): Promise<OpenList> {
  return openListSession({ type, name, file: path.join(tmpDir, file) }, sessionConfig, true)
}

const openBinder = (): Promise<OpenList> =>
  openFixtureList('collection', 'Binder', 'collections/binder.md')
const openWishlist = (): Promise<OpenList> =>
  openFixtureList('wanted', 'Wishlist', 'wanted/wishlist.md')
const openDeck = (): Promise<OpenList> => openFixtureList('deck', 'My Deck', 'decks/my-deck.md')

/** Record a pending move of a list's only fixture card, as edit mode does. */
function recordMove(
  source: OpenList,
  card: { name: string; set?: string; collectorNumber?: string },
  to: { type: ListType; name: string },
): void {
  source.strategy.applyChange(createRemoveChange(card.name, { ...card, cardId: 1 }))
  source.ctx.sessionChanges.push(createMoveFromChange(card.name, { ...card, cardId: 1, to }))
}

const BOLT = { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }
const BRAINSTORM = { name: 'Brainstorm', set: 'ice', collectorNumber: '61' }

describe('saveOpenList', () => {
  test('a move to a list that is not open is written to disk with a move-to changelog', async () => {
    const binder = await openBinder()
    recordMove(binder, BOLT, { type: 'wanted', name: 'Wishlist' })

    expect(await saveOpenList(binder, () => [binder])).toBe(true)

    const source = await fs.readFile(path.join(tmpDir, 'collections', 'binder.md'), 'utf-8')
    expect(source).not.toContain('Lightning Bolt')
    const sourceLog = await fs.readFile(
      path.join(tmpDir, 'collections', 'binder.changes.md'),
      'utf-8',
    )
    expect(sourceLog).toMatch(/Moved "Lightning Bolt".*to Wanted list 'Wishlist'/)

    const dest = await fs.readFile(path.join(tmpDir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(dest).toContain('Lightning Bolt')
    const destLog = await fs.readFile(path.join(tmpDir, 'wanted', 'wishlist.changes.md'), 'utf-8')
    expect(destLog).toMatch(/Moved "Lightning Bolt".*from Collection 'Binder'/)

    // The source session is committed: nothing left pending.
    expect(binder.ctx.sessionChanges).toHaveLength(0)
    expect(binder.strategy.hasUnsavedChanges()).toBe(false)
  })

  test('a move to an open list lands on its session and saves it in the same step', async () => {
    const binder = await openBinder()
    const wishlist = await openWishlist()
    recordMove(binder, BOLT, { type: 'wanted', name: 'Wishlist' })

    // The open destination also carries an unrelated pending change, which
    // must land in the same write — the disk path could not deliver it.
    const pendingAdd = createAddChange('Counterspell', { cardId: 2 })
    wishlist.strategy.applyChange(pendingAdd)
    wishlist.ctx.sessionChanges.push(pendingAdd)

    expect(await saveOpenList(binder, () => [binder, wishlist])).toBe(true)

    // The destination file was written through its own session: the moved
    // card arrives on a fresh id (&1 Brainstorm, &2 Counterspell → &3), next
    // to the unrelated pending add the offline path would have missed.
    const dest = await fs.readFile(path.join(tmpDir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(dest).toContain('Brainstorm')
    expect(dest).toContain('Counterspell')
    expect(dest).toMatch(/Lightning Bolt \(LEA:161\) &3/)
    const destLog = await fs.readFile(path.join(tmpDir, 'wanted', 'wishlist.changes.md'), 'utf-8')
    expect(destLog).toMatch(/Moved "Lightning Bolt".*from Collection 'Binder'/)
    expect(destLog).toMatch(/Added "Counterspell"/)

    // Both sessions come out saved and clean, and the in-memory destination
    // model actually holds the card (the offline path never touches it).
    expect(binder.strategy.hasUnsavedChanges()).toBe(false)
    expect(wishlist.strategy.hasUnsavedChanges()).toBe(false)
    expect(wishlist.ctx.sessionChanges).toHaveLength(0)
    const labels = wishlist.strategy.listEntries().map((entry) => entry.label)
    expect(labels.join('\n')).toContain('Lightning Bolt')
  })

  test('an open deck destination receives the line through its own session', async () => {
    const binder = await openBinder()
    const deck = await openDeck()
    recordMove(binder, BOLT, { type: 'deck', name: 'My Deck' })

    expect(await saveOpenList(binder, () => [binder, deck])).toBe(true)

    // The deck allocated its own line id (&1 is Sol Ring's).
    const dest = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(dest).toMatch(/1 Lightning Bolt \(LEA:161\) &2/)
    const destLog = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.changes.md'), 'utf-8')
    expect(destLog).toMatch(/Moved "Lightning Bolt".*from Collection 'Binder'/)
    expect(deck.strategy.hasUnsavedChanges()).toBe(false)
  })

  test('a chain of moves resolves in one save: the receiving list delivers its own pending move', async () => {
    const binder = await openBinder()
    const wishlist = await openWishlist()
    // Binder → Wishlist (open) while Wishlist → My Deck (not open).
    recordMove(binder, BOLT, { type: 'wanted', name: 'Wishlist' })
    recordMove(wishlist, BRAINSTORM, { type: 'deck', name: 'My Deck' })

    expect(await saveOpenList(binder, () => [binder, wishlist])).toBe(true)

    // Wishlist received the Bolt and gave up Brainstorm...
    const wishlistFile = await fs.readFile(path.join(tmpDir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(wishlistFile).toContain('Lightning Bolt')
    expect(wishlistFile).not.toContain('Brainstorm')
    // ...and its own move-from reached the deck rather than vanishing.
    const deckFile = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckFile).toContain('Brainstorm')
    const deckLog = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.changes.md'), 'utf-8')
    expect(deckLog).toMatch(/Moved "Brainstorm".*from Wanted list 'Wishlist'/)
    expect(wishlist.ctx.sessionChanges).toHaveLength(0)
  })

  test('a printing-less card cannot enter an open collection; the save aborts before writing', async () => {
    const wishlist = await openWishlist()
    const binder = await openBinder()
    // A name-only move-from (no set/collector number) targeting a collection.
    wishlist.strategy.applyChange(createRemoveChange('Brainstorm', { cardId: 1 }))
    wishlist.ctx.sessionChanges.push(
      createMoveFromChange('Brainstorm', { cardId: 1, to: { type: 'collection', name: 'Binder' } }),
    )

    expect(await saveOpenList(wishlist, () => [wishlist, binder])).toBe(false)

    // Neither file changed and both sessions are intact.
    const source = await fs.readFile(path.join(tmpDir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(source).toContain('Brainstorm')
    expect(binder.strategy.hasUnsavedChanges()).toBe(false)
    expect(wishlist.ctx.sessionChanges).toHaveLength(1)
    expect(wishlist.strategy.hasUnsavedChanges()).toBe(true)
  })

  test('a destination that cannot be resolved aborts the save and keeps the session intact', async () => {
    const binder = await openBinder()
    recordMove(binder, BOLT, { type: 'wanted', name: 'No Such List' })

    expect(await saveOpenList(binder, () => [binder])).toBe(false)

    // Nothing was written: the source file still holds the card, and the
    // session still holds the pending move.
    const source = await fs.readFile(path.join(tmpDir, 'collections', 'binder.md'), 'utf-8')
    expect(source).toContain('Lightning Bolt')
    expect(binder.ctx.sessionChanges).toHaveLength(1)
    expect(binder.strategy.hasUnsavedChanges()).toBe(true)
  })
})
