import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createMoveFromChange,
  createMoveToChange,
  type ChangeEvent,
  type ListRef,
} from '../../src/changes/change-event'
import { artSidecarPath, loadCardArt, saveCardArt, type CardArtRef } from '../../src/list/card-art'
import {
  applyCrossListMoves,
  applyOutgoingMoves,
  prepareOutgoingMoves,
} from '../../src/list/move-prepare'
import { handleSelectedMove } from '../../src/admin/api/move'
import { handleLists } from '../../src/admin/api/lists'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import { handleCollectionSave } from '../../src/admin/api/collection-save'
import { computeHash } from '../../src/changes/content-hash'
import type { DeckData } from '../../src/list/deck'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from './helpers/workspace'

let ws: BoundWorkspace
let tmpDir: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
  await writeDeckFile(tmpDir, 'my-deck', {
    frontMatter: { name: 'My Deck' },
    cards: [{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
  })
  await writeCollectionFile(tmpDir, 'binder', {
    title: 'Binder',
    entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
  })
  await writeWantedFile(tmpDir, 'wishlist', {
    title: 'Wishlist',
    entries: [{ name: 'Brainstorm', cardId: 1 }],
  })
})

afterEach(async () => {
  await ws.dispose()
})

/** The fixture lists' files — the key a batch's custom art is read under. */
const binderPath = (): string => path.join(tmpDir, 'collections', 'binder.md')
const deckPath = (): string => path.join(tmpDir, 'decks', 'my-deck.md')
const wishlistPath = (): string => path.join(tmpDir, 'wanted', 'wishlist.md')
const changelogOf = (listPath: string): Promise<string> =>
  fs.readFile(listPath.replace(/\.md$/, '.changes.md'), 'utf-8')

const BINDER: ListRef = { type: 'collection', name: 'Binder' }
const MY_DECK: ListRef = { type: 'deck', name: 'My Deck' }
const WISHLIST: ListRef = { type: 'wanted', name: 'Wishlist' }

/** The fixture deck with the given Main-section cards, as the client posts it. */
function deckWith(cards: DeckData['sections'][number]['cards']): DeckData {
  return { name: 'My Deck', sections: [{ name: 'Main', cards }] }
}

const SOL_RING = { quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }

/** POST the deck save with the file's current hash — the editor's Save. */
async function saveDeck(changes: ChangeEvent[], deck: DeckData): Promise<Response> {
  const contentHash = computeHash(await fs.readFile(deckPath(), 'utf-8'))
  return handleDeckSave(
    new Request('http://localhost/api/deck/my-deck/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes, deck, frontMatter: { name: 'My Deck' }, contentHash }),
    }),
  )
}

/** POST the collection save with the file's current hash; the handler replays the changes. */
async function saveBinder(changes: ChangeEvent[]): Promise<Response> {
  const contentHash = computeHash(await fs.readFile(binderPath(), 'utf-8'))
  return handleCollectionSave(
    new Request('http://localhost/api/collection/binder/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes, contentHash }),
    }),
  )
}

describe('applyOutgoingMoves', () => {
  test('no moves returns no written files', async () => {
    const result = await applyOutgoingMoves(
      { type: 'collection', name: 'Binder' },
      binderPath(),
      [],
    )
    expect(result).toEqual({ writtenFiles: [], droppedNotes: [], artFailures: [] })
  })

  test('writes the destination list and a move-to changelog', async () => {
    const change = createMoveFromChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 1,
      to: { type: 'deck', name: 'My Deck' },
    })
    const result = await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, binderPath(), [
      change,
    ])

    const deckPath = path.join(tmpDir, 'decks', 'my-deck.md')
    const deckContent = await fs.readFile(deckPath, 'utf-8')
    expect(deckContent).toContain('Lightning Bolt')
    expect(result.writtenFiles).toContain(deckPath)

    const changelog = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.changes.md'), 'utf-8')
    // The destination changelog reads "Moved … from <source>" — the source list is
    // the `from` label, never the destination deck itself.
    expect(changelog).toMatch(/Moved "Lightning Bolt".*from Collection 'Binder'/)
    expect(changelog).not.toContain("Deck 'My Deck'")
  })

  test('a quantity merge onto an existing deck line reports droppedNotes', async () => {
    // The deck already holds Sol Ring (C19:221); moving the same printing in
    // merges quantities on the existing line rather than adding a second line.
    const change = createMoveFromChange('Sol Ring', {
      set: 'c19',
      collectorNumber: '221',
      cardId: 2,
      to: { type: 'deck', name: 'My Deck' },
    })
    const result = await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, binderPath(), [
      change,
    ])

    const deckContent = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckContent).toContain('2 Sol Ring')
    // `move-from` events carry no note today, so a merge cannot drop one — the
    // field is pinned here as the (empty) report the editor save surfaces.
    expect(result.droppedNotes).toEqual([])
  })

  test('keeps the moved card’s [ja] token on the destination line and changelog', async () => {
    // The editor's dual-list save path: a move-from event carries the source
    // entry's language, and the destination side must write it back rather
    // than landing the copy as a bare (English) line.
    const change = createMoveFromChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      language: 'ja',
      cardId: 1,
      to: { type: 'deck', name: 'My Deck' },
    })
    await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, binderPath(), [change])

    const deckContent = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckContent).toContain('1 Lightning Bolt (LEA:161) [ja]')

    const changelog = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.changes.md'), 'utf-8')
    expect(changelog).toMatch(/Moved "Lightning Bolt" \(LEA:161\) \[ja\].*from Collection 'Binder'/)
  })

  test('carries the moved card’s custom art onto the destination line’s new id', async () => {
    await saveCardArt(
      binderPath(),
      new Map<number, CardArtRef>([[1, { file: 'proxies/bolt.png' }]]),
    )
    const change = createMoveFromChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 1,
      to: { type: 'deck', name: 'My Deck' },
    })

    const result = await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, binderPath(), [
      change,
    ])

    // The deck's own Sol Ring holds &1, so the arriving line took &2 — which is
    // the id the art has to be re-filed under.
    expect(await fs.readFile(deckPath(), 'utf-8')).toMatch(/1 Lightning Bolt \(LEA:161\) &2/)
    const deckArt = await loadCardArt(deckPath())
    expect(deckArt.ok && [...deckArt.art.entries()]).toEqual([[2, { file: 'proxies/bolt.png' }]])
    expect(result.writtenFiles).toContain(artSidecarPath(deckPath()))

    // The source side is the save tail's job (it reconciles against the save's
    // `removed` effects), so this path leaves the source sidecar alone.
    const sourceArt = await loadCardArt(binderPath())
    expect(sourceArt.ok && [...sourceArt.art.keys()]).toEqual([1])
  })

  test('a destination sidecar it cannot read is reported, not thrown', async () => {
    // The card line lands either way — the reconcile runs after the write — so
    // the refusal travels back to the caller (the admin save renders it into
    // `artWarnings`, the CLI editor prints it) instead of failing the move.
    await saveCardArt(
      binderPath(),
      new Map<number, CardArtRef>([[1, { file: 'proxies/bolt.png' }]]),
    )
    await fs.writeFile(artSidecarPath(deckPath()), '{ this is not json')
    const change = createMoveFromChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 1,
      to: { type: 'deck', name: 'My Deck' },
    })

    const result = await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, binderPath(), [
      change,
    ])

    expect(result.artFailures.map((failure) => failure.message).join('\n')).toContain(
      'not valid JSON',
    )
    expect(await fs.readFile(deckPath(), 'utf-8')).toContain('Lightning Bolt')
    // Left exactly as the user wrote it: overwriting a file Ritual cannot read
    // would destroy art they still have.
    expect(await fs.readFile(artSidecarPath(deckPath()), 'utf-8')).toBe('{ this is not json')
  })

  test('a quantity merge keeps the destination line’s own art', async () => {
    // The copy lands on the deck's existing Sol Ring line, which already stands
    // for the card and has art of its own — adopting the incoming reference
    // would repaint copies that never moved.
    await saveCardArt(deckPath(), new Map<number, CardArtRef>([[1, { file: 'deck/own.png' }]]))
    await saveCardArt(
      binderPath(),
      new Map<number, CardArtRef>([[2, { file: 'proxies/ring.png' }]]),
    )
    const change = createMoveFromChange('Sol Ring', {
      set: 'c19',
      collectorNumber: '221',
      cardId: 2,
      to: { type: 'deck', name: 'My Deck' },
    })

    const result = await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, binderPath(), [
      change,
    ])

    // The merge really happened — without this the art assertion below would
    // hold for an add that silently did nothing.
    expect(await fs.readFile(deckPath(), 'utf-8')).toContain('2 Sol Ring')
    const deckArt = await loadCardArt(deckPath())
    expect(deckArt.ok && [...deckArt.art.entries()]).toEqual([[1, { file: 'deck/own.png' }]])
    expect(result.writtenFiles).not.toContain(artSidecarPath(deckPath()))
  })

  test('throws moving a printing-less card into a collection', async () => {
    const change = createMoveFromChange('Counterspell', {
      cardId: 1,
      to: { type: 'collection', name: 'Binder' },
    })
    let threw = false
    try {
      await applyOutgoingMoves({ type: 'deck', name: 'My Deck' }, deckPath(), [change])
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    // The destination collection is left untouched.
    const coll = await fs.readFile(path.join(tmpDir, 'collections', 'binder.md'), 'utf-8')
    expect(coll).not.toContain('Counterspell')
  })

  test('throws when the destination list does not exist', async () => {
    const change = createMoveFromChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 1,
      to: { type: 'deck', name: 'Ghost Deck' },
    })
    let threw = false
    try {
      await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, binderPath(), [change])
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

describe('incoming moves (move-to saved on the destination)', () => {
  test('a deck save takes the copy out of the source collection and writes both changelogs', async () => {
    // The editor stack holds the destination's own line (&2) and names the
    // source line it came from; the deck payload already carries the line.
    const change = createMoveToChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 2,
      sourceCardId: 1,
      from: BINDER,
    })
    const resp = await saveDeck(
      [change],
      deckWith([
        SOL_RING,
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
      ]),
    )
    expect(resp.status).toBe(200)

    expect(await fs.readFile(deckPath(), 'utf-8')).toMatch(/1 Lightning Bolt \(LEA:161\) &2/)
    expect(await fs.readFile(binderPath(), 'utf-8')).not.toContain('Lightning Bolt')
    // Source: "Moved … to <destination>"; destination: "Moved … from <source>".
    expect(await changelogOf(binderPath())).toMatch(
      /Moved "Lightning Bolt" \(LEA:161\).*to Deck 'My Deck'/,
    )
    expect(await changelogOf(deckPath())).toMatch(
      /Moved "Lightning Bolt" \(LEA:161\).*from Collection 'Binder'/,
    )
  })

  test('a collection save decrements a multi-copy deck line, which keeps its id', async () => {
    await writeDeckFile(tmpDir, 'my-deck', {
      frontMatter: { name: 'My Deck' },
      cards: [{ ...SOL_RING, quantity: 2 }],
    })
    const change = createMoveToChange('Sol Ring', {
      set: 'c19',
      collectorNumber: '221',
      cardId: 2,
      sourceCardId: 1,
      from: MY_DECK,
    })
    const resp = await saveBinder([change])
    expect(resp.status).toBe(200)

    expect(await fs.readFile(deckPath(), 'utf-8')).toMatch(/1 Sol Ring \(C19:221\) &1/)
    expect(await fs.readFile(binderPath(), 'utf-8')).toMatch(/Sol Ring \(C19:221\) &2/)
    expect(await changelogOf(deckPath())).toMatch(/Moved "Sol Ring".*to Collection 'Binder'/)
  })

  test('a name-only wanted line is taken by a move that pins the printing chosen on the way in', async () => {
    const change = createMoveToChange('Brainstorm', {
      set: 'ice',
      collectorNumber: '64',
      cardId: 2,
      sourceCardId: 1,
      from: WISHLIST,
    })
    const resp = await saveBinder([change])
    expect(resp.status).toBe(200)

    expect(await fs.readFile(wishlistPath(), 'utf-8')).not.toContain('Brainstorm')
    expect(await fs.readFile(binderPath(), 'utf-8')).toMatch(/Brainstorm \(ICE:64\) &2/)
    expect(await changelogOf(wishlistPath())).toMatch(/Moved "Brainstorm".*to Collection 'Binder'/)
  })

  test('a source with no copy left to take aborts the save before anything is written', async () => {
    // Two copies claimed, one in the binder: the second removal fails in the
    // staging phase, so neither list, nor any changelog, is touched.
    const move = (cardId: number): ChangeEvent =>
      createMoveToChange('Lightning Bolt', {
        set: 'lea',
        collectorNumber: '161',
        cardId,
        sourceCardId: 1,
        from: BINDER,
      })
    const deckBefore = await fs.readFile(deckPath(), 'utf-8')
    const binderBefore = await fs.readFile(binderPath(), 'utf-8')

    const resp = await saveDeck(
      [move(2), move(3)],
      deckWith([
        SOL_RING,
        { quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
      ]),
    )
    expect(resp.status).toBe(500)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.message).toContain('no matching copy')

    expect(await fs.readFile(deckPath(), 'utf-8')).toBe(deckBefore)
    expect(await fs.readFile(binderPath(), 'utf-8')).toBe(binderBefore)
    expect(await fs.exists(path.join(tmpDir, 'decks', 'my-deck.changes.md'))).toBe(false)
    expect(await fs.exists(path.join(tmpDir, 'collections', 'binder.changes.md'))).toBe(false)

    // A source list that does not exist is refused the same way.
    const ghost = await saveDeck(
      [
        createMoveToChange('Lightning Bolt', {
          cardId: 2,
          from: { type: 'collection', name: 'Ghost' },
        }),
      ],
      deckWith([SOL_RING, { quantity: 1, name: 'Lightning Bolt', cardId: 2 }]),
    )
    expect(ghost.status).toBe(500)
    expect(((await ghost.json()) as { message: string }).message).toContain("Collection 'Ghost'")
    expect(await fs.readFile(deckPath(), 'utf-8')).toBe(deckBefore)
  })

  test('the departed copy’s custom art leaves the source sidecar and lands on the destination line', async () => {
    await saveCardArt(
      binderPath(),
      new Map<number, CardArtRef>([[1, { file: 'proxies/bolt.png' }]]),
    )
    const change = createMoveToChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 2,
      sourceCardId: 1,
      from: BINDER,
    })
    const resp = await saveDeck(
      [change],
      deckWith([
        SOL_RING,
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
      ]),
    )
    expect(resp.status).toBe(200)

    const deckArt = await loadCardArt(deckPath())
    expect(deckArt.ok && [...deckArt.art.entries()]).toEqual([[2, { file: 'proxies/bolt.png' }]])
    const binderArt = await loadCardArt(binderPath())
    expect(binderArt.ok && binderArt.art.size).toBe(0)
  })

  test('a stack holding only a move-to writes the source side alone: the destination is the caller’s save', async () => {
    // The wanted list is the destination here; its own line is the wanted
    // save's to write, so this call touches the binder alone.
    const change = createMoveToChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 2,
      sourceCardId: 1,
      from: BINDER,
    })
    const wishlistBefore = await fs.readFile(wishlistPath(), 'utf-8')
    const result = await applyCrossListMoves(WISHLIST, wishlistPath(), [change], new Map())

    expect(result.writtenFiles).toContain(binderPath())
    expect(result.writtenFiles).not.toContain(wishlistPath())
    expect(await fs.readFile(wishlistPath(), 'utf-8')).toBe(wishlistBefore)
    expect(await fs.readFile(binderPath(), 'utf-8')).not.toContain('Lightning Bolt')
    expect(await changelogOf(binderPath())).toMatch(
      /Moved "Lightning Bolt" \(LEA:161\).*to Wanted list 'Wishlist'/,
    )
  })

  test('the source line is taken by its own id even when the event’s destination id names a sibling', async () => {
    // Binder: a name-only Brainstorm (&1) and a pinned one (&2). The deck's
    // new line happens to be &1 too; only `sourceCardId` (2) may pick the
    // source line — the pinned copy leaves, the name-only one stays.
    await writeWantedFile(tmpDir, 'wishlist', { title: 'Wishlist', entries: [] })
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
        { name: 'Brainstorm', set: 'ice', collectorNumber: '64', cardId: 2 },
      ],
    })
    await writeWantedFile(tmpDir, 'wishlist', {
      title: 'Wishlist',
      entries: [{ name: 'Brainstorm', cardId: 1 }],
    })
    const change = createMoveToChange('Brainstorm', {
      set: 'ice',
      collectorNumber: '64',
      cardId: 1,
      sourceCardId: 2,
      from: BINDER,
    })
    // Destination: an empty deck, so the new line is &1.
    await writeDeckFile(tmpDir, 'my-deck', { frontMatter: { name: 'My Deck' }, cards: [] })
    const resp = await saveDeck(
      [change],
      deckWith([{ quantity: 1, name: 'Brainstorm', set: 'ice', collectorNumber: '64', cardId: 1 }]),
    )
    expect(resp.status).toBe(200)
    const binder = await fs.readFile(binderPath(), 'utf-8')
    expect(binder).toContain('Lightning Bolt (LEA:161) &1')
    expect(binder).not.toContain('Brainstorm')
    expect(await fs.readFile(wishlistPath(), 'utf-8')).toContain('Brainstorm &1')
  })

  test('a bare source line matches the copy’s resolved finish, and its changelog describes the line', async () => {
    // The planner reports a bare line pinning a foil-only printing as
    // `finish: 'foil'`; without a usable id the tuple tier still finds the
    // bare line, and the source changelog records the line as written — no
    // `[foil]` it never carried.
    const change = createMoveToChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      finish: 'foil',
      cardId: 2,
      from: BINDER,
    })
    const resp = await saveDeck(
      [change],
      deckWith([
        SOL_RING,
        {
          quantity: 1,
          name: 'Lightning Bolt',
          set: 'lea',
          collectorNumber: '161',
          finish: 'foil',
          cardId: 2,
        },
      ]),
    )
    expect(resp.status).toBe(200)
    expect(await fs.readFile(binderPath(), 'utf-8')).not.toContain('Lightning Bolt')
    const binderLog = await changelogOf(binderPath())
    expect(binderLog).toMatch(/Moved "Lightning Bolt" \(LEA:161\) &1 to Deck 'My Deck'/)
    expect(binderLog).not.toContain('[foil]')
    // The destination keeps the event's view of the copy.
    expect(await changelogOf(deckPath())).toMatch(/Moved "Lightning Bolt" \(LEA:161\) \[foil\]/)
  })

  test('art follows a copy onto an id this same save drained and handed back', async () => {
    // Sol Ring leaves the deck (freeing &1, whose art must go with it) and
    // Lightning Bolt arrives on the reused &1 carrying the binder's art: the
    // tail's reconcile drops the departed art, then files the arriving one.
    await saveCardArt(deckPath(), new Map<number, CardArtRef>([[1, { file: 'deck/ring.png' }]]))
    await saveCardArt(
      binderPath(),
      new Map<number, CardArtRef>([[1, { file: 'proxies/bolt.png' }]]),
    )
    const out = createMoveFromChange('Sol Ring', {
      set: 'c19',
      collectorNumber: '221',
      cardId: 1,
      to: BINDER,
    })
    const incoming = createMoveToChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 1,
      sourceCardId: 1,
      from: BINDER,
    })
    const resp = await saveDeck(
      [out, incoming],
      deckWith([
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      ]),
    )
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as { artWarnings?: string[] }
    expect(body.artWarnings).toBeUndefined()

    expect(await fs.readFile(deckPath(), 'utf-8')).toMatch(/1 Lightning Bolt \(LEA:161\) &1/)
    const deckArt = await loadCardArt(deckPath())
    expect(deckArt.ok && [...deckArt.art.entries()]).toEqual([[1, { file: 'proxies/bolt.png' }]])
    // The ring's art went with it to the binder's new line.
    const binderArt = await loadCardArt(binderPath())
    expect(binderArt.ok && [...binderArt.art.values()]).toEqual([{ file: 'deck/ring.png' }])
  })

  test('a swap stages both directions against one copy of the other list', async () => {
    // Sol Ring leaves the deck for the binder while Lightning Bolt arrives
    // from it: the binder is written once, with both lines in one changelog
    // entry — two separate stagings would have clobbered each other.
    const out = createMoveFromChange('Sol Ring', {
      set: 'c19',
      collectorNumber: '221',
      cardId: 1,
      to: BINDER,
    })
    const incoming = createMoveToChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 2,
      sourceCardId: 1,
      from: BINDER,
    })
    await applyCrossListMoves(MY_DECK, deckPath(), [out, incoming], new Map([[1, 1]]))

    const binder = await fs.readFile(binderPath(), 'utf-8')
    expect(binder).toContain('Sol Ring (C19:221)')
    expect(binder).not.toContain('Lightning Bolt')
    const changelog = await changelogOf(binderPath())
    // One changelog entry, not one per direction.
    expect(changelog.match(/^## /gm)).toHaveLength(1)
    expect(changelog).toMatch(/Moved "Sol Ring".*from Deck 'My Deck'/)
    expect(changelog).toMatch(/Moved "Lightning Bolt".*to Deck 'My Deck'/)
  })
})

describe('POST /api/move/selected', () => {
  async function move(
    moves: unknown[],
  ): Promise<{ success: boolean; moved: number; skipped: number }> {
    const req = new Request('http://localhost/api/move/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves }),
    })
    return (await (await handleSelectedMove(req)).json()) as {
      success: boolean
      moved: number
      skipped: number
    }
  }

  test('moves a selected card from its list into the destination addressed by slug', async () => {
    const res = await move([
      {
        listType: 'deck',
        listSlug: 'my-deck',
        name: 'Sol Ring',
        cardId: 1,
        copyIndex: 0,
        toType: 'collection',
        toSlug: 'binder',
      },
    ])
    expect(res.success).toBe(true)
    expect(res.moved).toBe(1)

    const coll = await fs.readFile(path.join(tmpDir, 'collections', 'binder.md'), 'utf-8')
    expect(coll).toContain('Sol Ring')
    const deckContent = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckContent).not.toContain('Sol Ring')
  })

  test('skips a card whose destination is its own list', async () => {
    const res = await move([
      {
        listType: 'collection',
        listSlug: 'binder',
        name: 'Lightning Bolt',
        cardId: 1,
        copyIndex: 0,
        toType: 'collection',
        toSlug: 'binder',
      },
    ])
    expect(res.moved).toBe(0)
    expect(res.skipped).toBe(1)
  })

  test('a destination display name is not accepted in place of the slug', async () => {
    // The collection's display name is 'Binder'; only the slug 'binder' resolves.
    const res = await move([
      {
        listType: 'deck',
        listSlug: 'my-deck',
        name: 'Sol Ring',
        cardId: 1,
        copyIndex: 0,
        toType: 'collection',
        toSlug: 'Binder',
      },
    ])
    expect(res.moved).toBe(0)
    expect(res.skipped).toBe(1)
  })

  test('skips a card that no longer resolves to a physical card', async () => {
    const res = await move([
      {
        listType: 'deck',
        listSlug: 'my-deck',
        name: 'Ghost',
        cardId: 999,
        copyIndex: 0,
        toType: 'collection',
        toSlug: 'binder',
      },
    ])
    expect(res.moved).toBe(0)
    expect(res.skipped).toBe(1)
  })

  test('toSection routes a move into the named deck section', async () => {
    const res = await move([
      {
        listType: 'collection',
        listSlug: 'binder',
        name: 'Lightning Bolt',
        cardId: 1,
        copyIndex: 0,
        toType: 'deck',
        toSlug: 'my-deck',
        toSection: 'Sideboard',
      },
    ])
    expect(res.success).toBe(true)
    expect(res.moved).toBe(1)

    const deckContent = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckContent).toContain('## Sideboard')
    expect(deckContent.indexOf('Lightning Bolt')).toBeGreaterThan(
      deckContent.indexOf('## Sideboard'),
    )
  })

  test('rejects toSection when the destination is not a deck', async () => {
    const req = new Request('http://localhost/api/move/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moves: [
          {
            listType: 'deck',
            listSlug: 'my-deck',
            name: 'Sol Ring',
            cardId: 1,
            copyIndex: 0,
            toType: 'collection',
            toSlug: 'binder',
            toSection: 'Main',
          },
        ],
      }),
    })
    const resp = await handleSelectedMove(req)
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toContain('toSection')
  })

  test('a language arrival-override stamps the destination line, and en clears it', async () => {
    // ja on arrival: the moved copy lands in the collection with a [ja] token.
    const res = await move([
      {
        listType: 'deck',
        listSlug: 'my-deck',
        name: 'Sol Ring',
        cardId: 1,
        copyIndex: 0,
        toType: 'collection',
        toSlug: 'binder',
        language: 'ja',
      },
    ])
    expect(res.success).toBe(true)
    expect(res.moved).toBe(1)
    const coll = await fs.readFile(path.join(tmpDir, 'collections', 'binder.md'), 'utf-8')
    expect(coll).toContain('Sol Ring (C19:221) [ja]')

    // en on arrival: moving the now-[ja] copy back clears the token — a bare
    // line means English, so the serializer must not write [en].
    const back = await move([
      {
        listType: 'collection',
        listSlug: 'binder',
        name: 'Sol Ring',
        cardId: 2,
        toType: 'deck',
        toSlug: 'my-deck',
        language: 'en',
      },
    ])
    expect(back.success).toBe(true)
    expect(back.moved).toBe(1)
    const deckContent = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckContent).toContain('Sol Ring')
    expect(deckContent).not.toContain('[ja]')
    expect(deckContent).not.toContain('[en]')
  })

  test('rejects an unknown language code', async () => {
    const req = new Request('http://localhost/api/move/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moves: [
          {
            listType: 'deck',
            listSlug: 'my-deck',
            name: 'Sol Ring',
            cardId: 1,
            copyIndex: 0,
            toType: 'collection',
            toSlug: 'binder',
            language: 'klingon',
          },
        ],
      }),
    })
    const resp = await handleSelectedMove(req)
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as { success: boolean }).success).toBe(false)
  })

  test('rejects a malformed body', async () => {
    const req = new Request('http://localhost/api/move/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves: [{ listType: 'deck' }] }),
    })
    const resp = await handleSelectedMove(req)
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as { success: boolean }).success).toBe(false)
  })
})

describe('prepareOutgoingMoves', () => {
  test('stages without writing; commit lands both sources on one shared destination', async () => {
    const boltMove = createMoveFromChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 1,
      to: { type: 'deck', name: 'My Deck' },
    })
    const brainstormMove = createMoveFromChange('Brainstorm', {
      cardId: 1,
      to: { type: 'deck', name: 'My Deck' },
    })
    const deckPath = path.join(tmpDir, 'decks', 'my-deck.md')
    const before = await fs.readFile(deckPath, 'utf-8')

    const prepared = await prepareOutgoingMoves([
      {
        sourceRef: { type: 'collection', name: 'Binder' },
        sourceFile: binderPath(),
        changes: [boltMove],
      },
      {
        sourceRef: { type: 'wanted', name: 'Wishlist' },
        sourceFile: path.join(tmpDir, 'wanted', 'wishlist.md'),
        changes: [brainstormMove],
      },
    ])
    // Staging writes nothing: the split exists so a multi-source save can
    // validate every batch before the first byte lands.
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)

    const result = await prepared.commit()

    // Both sources' cards stacked on one staged copy of the shared
    // destination, each drawing a fresh id after the fixture's Sol Ring &1 —
    // per-batch staging would have loaded two copies and let the second
    // write clobber the first.
    const deckContent = await fs.readFile(deckPath, 'utf-8')
    expect(deckContent).toMatch(/1 Lightning Bolt \(LEA:161\) &2/)
    expect(deckContent).toMatch(/1 Brainstorm &3/)
    expect(result.writtenFiles).toContain(deckPath)

    // One changelog entry for the destination; each line names its own source.
    const changelog = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.changes.md'), 'utf-8')
    expect(changelog).toMatch(/Moved "Lightning Bolt".*from Collection 'Binder'/)
    expect(changelog).toMatch(/Moved "Brainstorm".*from Wanted list 'Wishlist'/)

    // appendChangelog is not idempotent, so a staging can only be committed once.
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(prepared.commit()).rejects.toThrow('single-use')
  })
})

describe('GET /api/lists', () => {
  test('returns every list across the three types', async () => {
    const resp = await handleLists()
    const body = (await resp.json()) as {
      success: boolean
      lists: { type: string; slug: string; name: string }[]
    }
    expect(body.success).toBe(true)
    expect(body.lists).toContainEqual({ type: 'deck', slug: 'my-deck', name: 'My Deck' })
    expect(body.lists).toContainEqual({ type: 'collection', slug: 'binder', name: 'Binder' })
    expect(body.lists).toContainEqual({ type: 'wanted', slug: 'wishlist', name: 'Wishlist' })
  })
})

describe('incoming moves pinning a name-only line', () => {
  test('a deck save converts the line in place, takes the copy from the source, and adds the replacement there', async () => {
    await writeDeckFile(tmpDir, 'my-deck', {
      frontMatter: { name: 'My Deck' },
      cards: [SOL_RING, { quantity: 1, name: 'Lightning Bolt', cardId: 2 }],
    })
    const change = createMoveToChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 2,
      replacesCardId: 2,
      sourceCardId: 1,
      from: BINDER,
      replacement: { set: 'm10', collectorNumber: '146', finish: 'foil' },
    })
    const resp = await saveDeck(
      [change],
      deckWith([
        SOL_RING,
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
      ]),
    )
    expect(resp.status).toBe(200)

    // The binder swapped its LEA copy for the replacement, which took the freed &1.
    const binder = await fs.readFile(binderPath(), 'utf-8')
    expect(binder).not.toContain('LEA:161')
    expect(binder).toMatch(/Lightning Bolt \(M10:146\) \[foil\] &1$/m)
    const binderLog = await changelogOf(binderPath())
    expect(binderLog).toMatch(/Moved "Lightning Bolt" \(LEA:161\).*to Deck 'My Deck'/)
    expect(binderLog).toMatch(/Added "Lightning Bolt" \(M10:146\) \[foil\] &\d+/)
    expect(await changelogOf(deckPath())).toMatch(
      /Moved "Lightning Bolt" \(LEA:161\).*from Collection 'Binder'/,
    )
  })
})
