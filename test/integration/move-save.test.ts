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
import {
  categoriesHashPath,
  categoriesSidecarPath,
  loadCardCategories,
  saveCardCategories,
} from '../../src/list/card-categories-sidecar'
import { categoriesOf, categoriesRecord } from '../helpers/card-categories'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'
import { saveList } from '../helpers/list-save'

let ws: BoundWorkspace
let tmpDir: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
  await writeDeckFile(tmpDir, 'my-deck', {
    name: 'My Deck',
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

const SOL_RING = { quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }

/** POST the deck save with the file's current hash — the editor's Save. */
function saveDeck(changes: ChangeEvent[]): Promise<Response> {
  return saveList('deck', 'my-deck', deckPath(), changes)
}

/** POST the collection save with the file's current hash. */
function saveBinder(changes: ChangeEvent[]): Promise<Response> {
  return saveList('collection', 'binder', binderPath(), changes)
}

describe('applyOutgoingMoves', () => {
  test('no moves returns no written files', async () => {
    const result = await applyOutgoingMoves(
      { type: 'collection', name: 'Binder' },
      binderPath(),
      [],
    )
    expect(result).toEqual({
      writtenFiles: [],
      droppedNotes: [],
      artFailures: [],
      prunedCategories: [],
    })
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
      note: 'from the binder',
      cardId: 2,
      to: { type: 'deck', name: 'My Deck' },
    })
    const result = await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, binderPath(), [
      change,
    ])

    const deckContent = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckContent).toContain('2 Sol Ring (C19:221) &1')
    // The line's single note slot keeps what it had (nothing); the copy's note
    // is the report the editor save surfaces.
    expect(deckContent).not.toContain('from the binder')
    // Named by the source line's id, which is what tells N copies of one line apart.
    expect(result.droppedNotes).toEqual([
      { cardName: 'Sol Ring', cardId: 2, note: 'from the binder' },
    ])
  })

  test('lands the moved card’s note and the labels the destination accepts, and logs them', async () => {
    // The closed-destination path: the source's save writes the destination
    // file itself. What lands per list type is pinned by the staging unit tests;
    // this pins the wiring from the move-from event to the written line and the
    // mirrored move-to's event block.
    const proxy = createMoveFromChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      labels: ['proxy'],
      note: 'printed at home',
      cardId: 1,
      to: MY_DECK,
    })
    const result = await applyOutgoingMoves(BINDER, binderPath(), [proxy])

    expect(result.droppedNotes).toEqual([])
    expect(await fs.readFile(deckPath(), 'utf-8')).toContain(
      '1 Lightning Bolt (LEA:161) [proxy] {printed at home} &2',
    )
    expect(await changelogOf(deckPath())).toContain('"labels":["proxy"],"note":"printed at home"')
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

    expect(result.artFailures.map((failure) => failure.message.message).join('\n')).toContain(
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
    // source line it came from; the route replays the move-to to write that
    // line, and takes the copy out of the source itself.
    const change = createMoveToChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 2,
      sourceCardId: 1,
      from: BINDER,
    })
    const resp = await saveDeck([change])
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
      name: 'My Deck',
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

    const resp = await saveDeck([move(2), move(3)])
    expect(resp.status).toBe(500)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.message).toContain('no matching copy')

    expect(await fs.readFile(deckPath(), 'utf-8')).toBe(deckBefore)
    expect(await fs.readFile(binderPath(), 'utf-8')).toBe(binderBefore)
    expect(await fs.exists(path.join(tmpDir, 'decks', 'my-deck.changes.md'))).toBe(false)
    expect(await fs.exists(path.join(tmpDir, 'collections', 'binder.changes.md'))).toBe(false)

    // A source list that does not exist is refused the same way.
    const ghost = await saveDeck([
      createMoveToChange('Lightning Bolt', {
        cardId: 2,
        from: { type: 'collection', name: 'Ghost' },
      }),
    ])
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
    const resp = await saveDeck([change])
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
    await writeDeckFile(tmpDir, 'my-deck', { name: 'My Deck', cards: [] })
    const resp = await saveDeck([change])
    expect(resp.status).toBe(200)
    const binder = await fs.readFile(binderPath(), 'utf-8')
    expect(binder).toContain('Lightning Bolt (LEA:161) &1')
    expect(binder).not.toContain('Brainstorm')
    expect(await fs.readFile(wishlistPath(), 'utf-8')).toContain('Brainstorm &1')
  })

  test("a source list that loses its last copy of a name loses that card's categories", async () => {
    // On the move write path, categories are keyed by card NAME, so a
    // source list that no longer holds the name prunes its entry on this write —
    // and the destination inherits nothing, because categories never follow a move.
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
        { name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 2 },
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 3 },
      ],
    })
    await saveCardCategories(
      binderPath(),
      categoriesRecord(['Ramp', 'Burn'], {
        'Lightning Bolt': ['Burn'],
        'Sol Ring': ['Ramp'],
      }),
    )
    // The destination has categories of its own, so "inherits nothing" is
    // falsifiable in both directions: neither an inherited entry nor a prune of
    // what it already had may appear.
    await saveCardCategories(wishlistPath(), categoriesRecord(['Draw'], { Brainstorm: ['Draw'] }))
    const destBefore = await fs.readFile(categoriesSidecarPath(wishlistPath()), 'utf-8')

    const result = await applyCrossListMoves(
      WISHLIST,
      wishlistPath(),
      [
        createMoveToChange('Lightning Bolt', {
          set: 'lea',
          collectorNumber: '161',
          cardId: 2,
          sourceCardId: 1,
          from: BINDER,
        }),
        createMoveToChange('Sol Ring', {
          set: 'c19',
          collectorNumber: '221',
          cardId: 3,
          sourceCardId: 2,
          from: BINDER,
        }),
      ],
      new Map(),
    )

    expect(result.writtenFiles).toContain(categoriesSidecarPath(binderPath()))
    expect(result.writtenFiles).toContain(categoriesHashPath(binderPath()))
    // The dropped assignment is reported, not silent.
    expect(result.prunedCategories).toEqual(['Lightning Bolt'])

    const source = await loadCardCategories(binderPath())
    // Lightning Bolt's only copy left, so its entry is pruned; Sol Ring still
    // has its C21 copy in the list and keeps its assignment.
    expect(source.ok && categoriesOf(source.categories)).toEqual({ 'Sol Ring': ['Ramp'] })

    // The destination is the caller's own save here: it inherits nothing from
    // the arriving cards, and its own sidecar is left byte-identical.
    expect(await fs.readFile(categoriesSidecarPath(wishlistPath()), 'utf-8')).toBe(destBefore)
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
    const resp = await saveDeck([change])
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
    const resp = await saveDeck([out, incoming])
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

  test('the save route carries a moved copy’s override and note both ways', async () => {
    // Outgoing: the deck's own proxy line leaves for the binder, which keeps
    // `[proxy]` and the note. Incoming: the binder's sale/trade line arrives on
    // the deck, which keeps the note but not the labels a deck cannot express.
    await writeDeckFile(tmpDir, 'my-deck', {
      name: 'My Deck',
      cards: [{ ...SOL_RING, labels: ['proxy'], note: 'home print' }],
    })
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [
        {
          name: 'Lightning Bolt',
          set: 'lea',
          collectorNumber: '161',
          labels: ['sale', 'trade'],
          note: 'mint',
          cardId: 1,
        },
      ],
    })
    const out = createMoveFromChange('Sol Ring', {
      set: 'c19',
      collectorNumber: '221',
      labels: ['proxy'],
      note: 'home print',
      cardId: 1,
      to: BINDER,
    })
    // The incoming event's payload differs from the binder line's on purpose:
    // the deck lands the EVENT's note, while the binder's mirrored move-from
    // records the LINE that left — its own labels and note.
    const incoming = createMoveToChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      labels: ['trade'],
      note: 'from the event',
      cardId: 2,
      sourceCardId: 1,
      from: BINDER,
    })
    const resp = await saveDeck([out, incoming])
    expect(resp.status).toBe(200)

    const deck = await fs.readFile(deckPath(), 'utf-8')
    expect(deck).toContain('1 Lightning Bolt (LEA:161) {from the event} &2')
    expect(deck).not.toContain('Sol Ring')
    const binder = await fs.readFile(binderPath(), 'utf-8')
    expect(binder).toContain('- Sol Ring (C19:221) [proxy] {home print} &')
    expect(binder).not.toContain('Lightning Bolt')
    // The binder's mirrored move-from records the line that left, override and note.
    expect(await changelogOf(binderPath())).toMatch(
      /"action":"move-from","cardName":"Lightning Bolt".*"labels":\["sale","trade"\].*"note":"mint"/,
    )
  })

  test('the save route trims a moved copy’s note and refuses one with a control character', async () => {
    const move = (note: string): ChangeEvent =>
      createMoveFromChange('Sol Ring', {
        set: 'c19',
        collectorNumber: '221',
        note,
        cardId: 1,
        to: BINDER,
      })
    const refused = await saveDeck([move('bad\u0007note')])
    expect(refused.status).toBe(400)
    expect(await fs.readFile(binderPath(), 'utf-8')).not.toContain('Sol Ring')

    const saved = await saveDeck([move('  pasted note\n')])
    expect(saved.status).toBe(200)
    expect(await fs.readFile(binderPath(), 'utf-8')).toContain('{pasted note}')
  })

  test('an incoming move records the source line’s inherited labels on the source changelog', async () => {
    // The binder's Bolt has no override; its labels come from the binder's
    // default. The source-side move-from must record the effective labels.
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      labels: ['sale'],
      entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
    })
    const resp = await saveDeck([
      createMoveToChange('Lightning Bolt', {
        set: 'lea',
        collectorNumber: '161',
        cardId: 2,
        sourceCardId: 1,
        from: BINDER,
      }),
    ])
    expect(resp.status).toBe(200)
    expect(await changelogOf(binderPath())).toMatch(
      /"action":"move-from","cardName":"Lightning Bolt".*"labels":\["sale"\]/,
    )
  })

  test('an incoming copy merging onto a deck line with another note is reported', async () => {
    await writeDeckFile(tmpDir, 'my-deck', {
      name: 'My Deck',
      cards: [{ ...SOL_RING, note: 'keep me' }],
    })
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [{ name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 4 }],
    })
    const resp = await saveDeck([
      createMoveToChange('Sol Ring', {
        set: 'c19',
        collectorNumber: '221',
        note: 'from the binder',
        cardId: 1,
        sourceCardId: 4,
        from: BINDER,
      }),
    ])
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as { droppedNotes: unknown[] }
    expect(body.droppedNotes).toEqual([
      { cardName: 'Sol Ring', cardId: 4, note: 'from the binder' },
    ])
    expect(await fs.readFile(deckPath(), 'utf-8')).toContain('2 Sol Ring (C19:221) {keep me} &1')
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

  test('a card that only inherits its deck’s `proxy` default arrives in the binder as a proxy', async () => {
    // Every move carries the copy's labels as its source states them: the Sol
    // Ring line has no override of its own, but the deck's front matter makes
    // it a proxy.
    await writeDeckFile(tmpDir, 'my-deck', {
      name: 'My Deck',
      frontMatter: { labels: ['proxy'] },
      cards: [SOL_RING],
    })
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
    expect(res.moved).toBe(1)
    expect(await fs.readFile(binderPath(), 'utf-8')).toContain('- Sol Ring (C19:221) [proxy] &2')
    expect(await changelogOf(deckPath())).toContain('"labels":["proxy"]')
  })

  test('a real card stays real in a `proxy`-default binder, written as [no-proxy]', async () => {
    // The deck states `proxy` as a fact (decks carry it), so the binder's
    // default cannot make the copy a proxy on arrival.
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      labels: ['proxy'],
      entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
    })
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
    expect(res.moved).toBe(1)
    expect(await fs.readFile(binderPath(), 'utf-8')).toContain('- Sol Ring (C19:221) [no-proxy] &2')
  })

  test('a selected card’s tags travel from the source line to the destination line', async () => {
    // The route reads the copy off disk, so the client sends no tags — and the
    // MCP move_selected_cards tool, which calls this handler, inherits the same.
    await writeDeckFile(tmpDir, 'my-deck', {
      name: 'My Deck',
      cards: [{ ...SOL_RING, tags: ['Ramp', 'Card Draw'] }],
    })
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
    expect(res.moved).toBe(1)
    const coll = await fs.readFile(binderPath(), 'utf-8')
    expect(coll).toMatch(/Sol Ring \(C19:221\) #Card Draw, Ramp &\d+/)
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
      name: 'My Deck',
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
    const resp = await saveDeck([change])
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
