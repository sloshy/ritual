import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createMoveFromChange } from '../../src/change-event'
import { artSidecarPath, loadCardArt, saveCardArt, type CardArtRef } from '../../src/card-art'
import { applyOutgoingMoves, prepareOutgoingMoves } from '../../src/admin/api/move-save'
import { handleSelectedMove } from '../../src/admin/api/move'
import { handleLists } from '../../src/admin/api/lists'
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
