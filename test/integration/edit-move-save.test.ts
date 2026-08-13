import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createAddChange,
  createMoveFromChange,
  createRemoveChange,
  type ListRef,
} from '../../src/change-event'
import type { ListType } from '../../src/list-type'
import { openListSession, saveOpenList, type OpenList } from '../../src/commands/edit-lists'
import { buildInitialSessionConfig } from '../../src/commands/card-session'
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

// Fresh per test: sessions hold onto it and mutate it (filters, the cached
// collector-mode pool), so sharing one would leak state between cases.
let sessionConfig: DeckSessionConfig

beforeEach(async () => {
  sessionConfig = { ...buildInitialSessionConfig({}, undefined), targetSection: null }
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

/** A fixture card as {@link recordMove} consumes it. The id defaults to the list's first entry. */
type MoveFixtureCard = { name: string; set?: string; collectorNumber?: string; cardId?: number }

/** Record a pending move of a fixture card, as edit mode does. */
function recordMove(source: OpenList, card: MoveFixtureCard, to: ListRef): void {
  const cardId = card.cardId ?? 1
  source.strategy.applyChange(createRemoveChange(card.name, { ...card, cardId }))
  source.ctx.sessionChanges.push(createMoveFromChange(card.name, { ...card, cardId, to }))
}

const BOLT: MoveFixtureCard = { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }
const BRAINSTORM: MoveFixtureCard = { name: 'Brainstorm', set: 'ice', collectorNumber: '61' }
/** No set/collector number: a card that cannot legally enter a collection. */
const BRAINSTORM_NAME_ONLY: MoveFixtureCard = { name: 'Brainstorm' }
const GROWTH: MoveFixtureCard = { name: 'Giant Growth', set: 'lea', collectorNumber: '169' }
const COUNTERSPELL: MoveFixtureCard = {
  name: 'Counterspell',
  set: 'lea',
  collectorNumber: '54',
  cardId: 2,
}

/**
 * A second collection with two cards, for closures that need one source moving
 * into an open list (pulling it into the save) *and* a closed list at once.
 */
async function openTrades(): Promise<OpenList> {
  await writeCollectionFile(tmpDir, 'trades', {
    title: 'Trades',
    entries: [
      { name: 'Giant Growth', set: 'lea', collectorNumber: '169', cardId: 1 },
      { name: 'Counterspell', set: 'lea', collectorNumber: '54', cardId: 2 },
    ],
  })
  return openFixtureList('collection', 'Trades', 'collections/trades.md')
}

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
    recordMove(wishlist, BRAINSTORM_NAME_ONLY, { type: 'collection', name: 'Binder' })

    expect(await saveOpenList(wishlist, () => [wishlist, binder])).toBe(false)

    // Neither file changed and both sessions are intact.
    const source = await fs.readFile(path.join(tmpDir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(source).toContain('Brainstorm')
    expect(binder.strategy.hasUnsavedChanges()).toBe(false)
    expect(wishlist.ctx.sessionChanges).toHaveLength(1)
    expect(wishlist.strategy.hasUnsavedChanges()).toBe(true)
  })

  test('a failing batch aborts before any other batch is written, so a retry cannot duplicate cards', async () => {
    const trades = await openTrades()
    const wishlist = await openWishlist()
    // Trades → My Deck (closed, valid) and Trades → Wishlist (open), pulling
    // Wishlist into the closure — whose own pending move cannot validate: a
    // name-only card headed into a closed collection. Two conditions make
    // this pin the regression: the VALID batch belongs to the list being
    // saved (plans[0], so the old sequential writer had committed it before
    // the pulled-in list's batch threw), and Binder is NOT open (which is
    // what routes the bad move past the open-destination pre-check into the
    // staged offline path — the sibling test above exercises the other branch).
    recordMove(trades, GROWTH, { type: 'deck', name: 'My Deck' })
    recordMove(trades, COUNTERSPELL, { type: 'wanted', name: 'Wishlist' })
    recordMove(wishlist, BRAINSTORM_NAME_ONLY, { type: 'collection', name: 'Binder' })

    expect(await saveOpenList(trades, () => [trades, wishlist])).toBe(false)

    // The *valid* batch must not have landed either: were it written now, a
    // retry after fixing the bad move would deliver Giant Growth again.
    const deckFile = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckFile).not.toContain('Giant Growth')
    const source = await fs.readFile(path.join(tmpDir, 'collections', 'trades.md'), 'utf-8')
    expect(source).toContain('Giant Growth')
    expect(trades.ctx.sessionChanges).toHaveLength(2)
    expect(trades.strategy.hasUnsavedChanges()).toBe(true)
    expect(wishlist.ctx.sessionChanges).toHaveLength(1)

    // Discard the bad move and retry. The move was recorded by hand, so it is
    // undone by hand too: the editor's discard (undoFlatListEditAt) restores
    // the removed entry as well as dropping the pending event.
    wishlist.ctx.sessionChanges = []
    wishlist.strategy.applyChange(
      createAddChange('Brainstorm', { set: 'ice', collectorNumber: '61', cardId: 1 }),
    )
    expect(await saveOpenList(trades, () => [trades, wishlist])).toBe(true)

    // Exactly one copy arrives, and the bystander destination kept its card.
    const deckAfter = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckAfter.match(/Giant Growth/g)).toHaveLength(1)
    const wishlistAfter = await fs.readFile(path.join(tmpDir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(wishlistAfter).toContain('Brainstorm')
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
