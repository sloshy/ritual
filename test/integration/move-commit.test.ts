import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  applyVirtualMove,
  applyVirtualRemove,
  buildVirtualState,
  commitAllMoves,
  commitAllRemovals,
} from '../../src/commands/move-helpers'
import { artSidecarPath, loadCardArt, saveCardArt } from '../../src/list/card-art'
import type { PhysicalCard, ListEntry } from '../../src/commands/move-helpers'
import { collectionMarkdown, deckMarkdown, wantedMarkdown } from './helpers/workspace'

// ── Fixtures ───────────────────────────────────────────────────────────────────

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'move-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeList(
  type: 'deck' | 'collection' | 'wanted',
  name: string,
  fileName: string,
): ListEntry {
  return { ref: { type, name }, filePath: path.join(tmpDir, fileName) }
}

function makeCard(
  name: string,
  listEntry: ListEntry,
  overrides: Partial<PhysicalCard> = {},
): PhysicalCard {
  const cardId = overrides.cardId ?? 1
  return {
    key: `${listEntry.filePath}:${cardId}:0`,
    name,
    set: 'lea',
    collectorNumber: '1',
    cardId,
    listEntry,
    ...overrides,
  }
}

// ── commitAllMoves ─────────────────────────────────────────────────────────────

describe('commitAllMoves', () => {
  test('returns 0 when there are no pending moves', async () => {
    const listEntry = makeList('deck', 'A', 'a.md')
    const state = buildVirtualState([makeCard('Card', listEntry)])

    const { moved } = await commitAllMoves(state)
    expect(moved).toBe(0)
  })

  test('moves a card from a collection to another collection', async () => {
    const srcList = makeList('collection', 'Source', 'src.md')
    const dstList = makeList('collection', 'Dest', 'dst.md')
    await fs.writeFile(
      srcList.filePath,
      collectionMarkdown({
        title: 'Source',
        entries: [
          { name: 'Lightning Bolt', set: 'lea', collectorNumber: '7', finish: 'foil', cardId: 1 },
        ],
      }),
    )
    await fs.writeFile(dstList.filePath, collectionMarkdown({ title: 'Dest', entries: [] }))

    const card = makeCard('Lightning Bolt', srcList, { collectorNumber: '7', finish: 'foil' })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, dstList)

    const { moved, writtenFiles } = await commitAllMoves(state)
    expect(moved).toBe(1)

    // The written-files set covers both list files and both changelogs (for git staging).
    expect(writtenFiles).toContain(srcList.filePath)
    expect(writtenFiles).toContain(dstList.filePath)
    expect(writtenFiles).toContain(srcList.filePath.replace('.md', '.changes.md'))
    expect(writtenFiles).toContain(dstList.filePath.replace('.md', '.changes.md'))

    // Source file should no longer contain the card
    const srcContent = await fs.readFile(srcList.filePath, 'utf-8')
    expect(srcContent).not.toContain('Lightning Bolt')

    // Destination file should contain the card
    const dstContent = await fs.readFile(dstList.filePath, 'utf-8')
    expect(dstContent).toContain('Lightning Bolt')

    // Changelogs should be created
    const srcChanges = await fs.readFile(srcList.filePath.replace('.md', '.changes.md'), 'utf-8')
    expect(srcChanges).toContain('Moved "Lightning Bolt"')
    expect(srcChanges).toContain("to Collection 'Dest'")

    const dstChanges = await fs.readFile(dstList.filePath.replace('.md', '.changes.md'), 'utf-8')
    expect(dstChanges).toContain('Moved "Lightning Bolt"')
    expect(dstChanges).toContain("from Collection 'Source'")
  })

  test('moves a card from a wanted list to a collection', async () => {
    const wantedList = makeList('wanted', 'Wanted', 'wanted.md')
    const collList = makeList('collection', 'Collection', 'coll.md')
    await fs.writeFile(
      wantedList.filePath,
      wantedMarkdown({
        title: 'Wanted',
        entries: [{ name: 'Sol Ring', set: '2xm', collectorNumber: '123', cardId: 3 }],
      }),
    )
    await fs.writeFile(collList.filePath, collectionMarkdown({ title: 'Collection', entries: [] }))

    const card = makeCard('Sol Ring', wantedList, { set: '2xm', collectorNumber: '123', cardId: 3 })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, collList)

    const { moved } = await commitAllMoves(state)
    expect(moved).toBe(1)

    const wantedContent = await fs.readFile(wantedList.filePath, 'utf-8')
    expect(wantedContent).not.toContain('Sol Ring')

    const collContent = await fs.readFile(collList.filePath, 'utf-8')
    expect(collContent).toContain('Sol Ring')
  })

  test('chained move is committed from original source to final destination', async () => {
    const listA = makeList('collection', 'A', 'a.md')
    const listB = makeList('collection', 'B', 'b.md')
    const listC = makeList('collection', 'C', 'c.md')
    await fs.writeFile(
      listA.filePath,
      collectionMarkdown({
        title: 'A',
        entries: [{ name: 'Dark Ritual', set: 'lea', collectorNumber: '100', cardId: 5 }],
      }),
    )
    await fs.writeFile(listB.filePath, collectionMarkdown({ title: 'B', entries: [] }))
    await fs.writeFile(listC.filePath, collectionMarkdown({ title: 'C', entries: [] }))

    const card = makeCard('Dark Ritual', listA, { collectorNumber: '100', cardId: 5 })
    const state = buildVirtualState([card])

    // Chain: A → B → C
    applyVirtualMove(state, card.key, listB)
    applyVirtualMove(state, card.key, listC)

    await commitAllMoves(state)

    // A should have the card removed
    const contentA = await fs.readFile(listA.filePath, 'utf-8')
    expect(contentA).not.toContain('Dark Ritual')

    // C should have the card added
    const contentC = await fs.readFile(listC.filePath, 'utf-8')
    expect(contentC).toContain('Dark Ritual')

    // B should be unchanged (never actually written to)
    const contentB = await fs.readFile(listB.filePath, 'utf-8')
    expect(contentB).not.toContain('Dark Ritual')

    // Changelog for A should say moved to C (not B)
    const changesA = await fs.readFile(listA.filePath.replace('.md', '.changes.md'), 'utf-8')
    expect(changesA).toContain("to Collection 'C'")
    expect(changesA).not.toContain("to Collection 'B'")
  })

  test('failed removal does not add card to destination', async () => {
    const srcList = makeList('collection', 'Source', 'src.md')
    const dstList = makeList('collection', 'Dest', 'dst.md')
    // Source file does NOT contain the card we're trying to move
    await fs.writeFile(
      srcList.filePath,
      collectionMarkdown({
        title: 'Source',
        entries: [{ name: 'Some Other Card', set: 'lea', collectorNumber: '1', cardId: 1 }],
      }),
    )
    await fs.writeFile(dstList.filePath, collectionMarkdown({ title: 'Dest', entries: [] }))

    // The card we're moving doesn't exist in the source (different ID)
    const card = makeCard('Lightning Bolt', srcList, { collectorNumber: '7', cardId: 99 })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, dstList)

    const { moved } = await commitAllMoves(state)
    expect(moved).toBe(0)

    // Destination must not have the card added
    const dstContent = await fs.readFile(dstList.filePath, 'utf-8')
    expect(dstContent).not.toContain('Lightning Bolt')

    // Source is unchanged
    const srcContent = await fs.readFile(srcList.filePath, 'utf-8')
    expect(srcContent).toContain('Some Other Card')
  })

  test('a section-targeted move lands in the named deck section, creating it', async () => {
    const srcList = makeList('collection', 'Source', 'src.md')
    const deckList = makeList('deck', 'Deck', 'deck.md')
    await fs.writeFile(
      srcList.filePath,
      collectionMarkdown({
        title: 'Source',
        entries: [{ name: 'Duress', set: 'usg', collectorNumber: '132', cardId: 1 }],
      }),
    )
    await fs.writeFile(
      deckList.filePath,
      deckMarkdown({
        frontMatter: { name: 'Deck' },
        cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
      }),
    )

    const card = makeCard('Duress', srcList, { set: 'usg', collectorNumber: '132' })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, deckList, { section: 'Sideboard' })

    const { moved } = await commitAllMoves(state)
    expect(moved).toBe(1)

    const deckContent = await fs.readFile(deckList.filePath, 'utf-8')
    expect(deckContent).toContain('## Sideboard')
    expect(deckContent.indexOf('Duress')).toBeGreaterThan(deckContent.indexOf('## Sideboard'))
  })

  test('reports notes dropped by a destination quantity-merge', async () => {
    const srcList = makeList('collection', 'Source', 'src.md')
    const deckList = makeList('deck', 'Deck', 'deck.md')
    await fs.writeFile(
      srcList.filePath,
      collectionMarkdown({
        title: 'Source',
        entries: [
          {
            name: 'Sol Ring',
            set: 'c21',
            collectorNumber: '167',
            note: 'from my binder',
            cardId: 4,
          },
        ],
      }),
    )
    await fs.writeFile(
      deckList.filePath,
      deckMarkdown({
        frontMatter: { name: 'Deck' },
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167', cardId: 1 }],
      }),
    )

    const card = makeCard('Sol Ring', srcList, {
      set: 'c21',
      collectorNumber: '167',
      note: 'from my binder',
      cardId: 4,
    })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, deckList)

    const { moved, droppedNotes } = await commitAllMoves(state)
    expect(moved).toBe(1)
    expect(droppedNotes).toEqual([{ cardName: 'Sol Ring', cardId: 4, note: 'from my binder' }])
  })

  test('a failed removal reports no dropped note for that card', async () => {
    const srcList = makeList('collection', 'Source', 'src.md')
    const deckList = makeList('deck', 'Deck', 'deck.md')
    // Source does NOT contain the card being moved, so the removal fails.
    await fs.writeFile(srcList.filePath, collectionMarkdown({ title: 'Source', entries: [] }))
    await fs.writeFile(
      deckList.filePath,
      deckMarkdown({
        frontMatter: { name: 'Deck' },
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167', cardId: 1 }],
      }),
    )

    const card = makeCard('Sol Ring', srcList, {
      set: 'c21',
      collectorNumber: '167',
      note: 'would merge',
      cardId: 9,
    })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, deckList)

    const { moved, droppedNotes } = await commitAllMoves(state)
    expect(moved).toBe(0)
    expect(droppedNotes).toEqual([])
  })

  test('missing destination file aborts before mutating source', async () => {
    const srcList = makeList('collection', 'Source', 'src.md')
    const dstList = makeList('collection', 'Dest', 'nonexistent-dest.md') // does not exist
    await fs.writeFile(
      srcList.filePath,
      collectionMarkdown({
        title: 'Source',
        entries: [
          { name: 'Sol Ring', set: '2xm', collectorNumber: '123', finish: 'foil', cardId: 2 },
        ],
      }),
    )

    const card = makeCard('Sol Ring', srcList, {
      set: '2xm',
      collectorNumber: '123',
      finish: 'foil',
      cardId: 2,
    })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, dstList)

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(commitAllMoves(state)).rejects.toThrow('Destination file not found')

    // Source must be completely untouched — card was never removed
    const srcContent = await fs.readFile(srcList.filePath, 'utf-8')
    expect(srcContent).toContain('Sol Ring')
  })
})

// ── Custom art ─────────────────────────────────────────────────────────────────

/**
 * A `<list>.art.json` entry is filed under the card line's `&N`, and a move
 * frees that id on the source side while allocating a new one on the
 * destination side. The art has to follow, or it stays behind and reappears on
 * whichever card takes the freed id next.
 */
describe('custom art follows a committed move', () => {
  /** The sidecar's art map, or a thrown failure naming the parse error. */
  async function artOf(listPath: string): Promise<Map<number, unknown>> {
    const loaded = await loadCardArt(listPath)
    if (!loaded.ok) throw new Error(`expected readable art, got: ${loaded.message}`)
    return loaded.art
  }

  test('the entry leaves the source and lands under the destination’s new id', async () => {
    const srcList = makeList('collection', 'Source', 'src.md')
    const dstList = makeList('collection', 'Dest', 'dst.md')
    await fs.writeFile(
      srcList.filePath,
      collectionMarkdown({
        title: 'Source',
        entries: [
          { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 4 },
          { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 5 },
        ],
      }),
    )
    await fs.writeFile(dstList.filePath, collectionMarkdown({ title: 'Dest', entries: [] }))
    await saveCardArt(srcList.filePath, new Map([[4, { file: 'proxies/bolt.png' }]]))

    const card = makeCard('Lightning Bolt', srcList, { collectorNumber: '161', cardId: 4 })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, dstList)

    const { moved, writtenFiles } = await commitAllMoves(state)
    expect(moved).toBe(1)

    // Gone from the source — its `&4` is back in the pool.
    expect(await fs.exists(artSidecarPath(srcList.filePath))).toBe(false)
    // And filed under the id the destination line was given.
    const destContent = await fs.readFile(dstList.filePath, 'utf-8')
    expect(destContent).toContain('- Lightning Bolt (LEA:161) &1')
    expect(await artOf(dstList.filePath)).toEqual(new Map([[1, { file: 'proxies/bolt.png' }]]))
    // Both sidecars are reported, so an auto-commit stages them.
    expect(writtenFiles).toContain(artSidecarPath(dstList.filePath))
    expect(writtenFiles).toContain(artSidecarPath(srcList.filePath))
  })

  test('a move of a card with no art writes no sidecar at all', async () => {
    const srcList = makeList('collection', 'Source', 'src.md')
    const dstList = makeList('collection', 'Dest', 'dst.md')
    await fs.writeFile(
      srcList.filePath,
      collectionMarkdown({
        title: 'Source',
        entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
      }),
    )
    await fs.writeFile(dstList.filePath, collectionMarkdown({ title: 'Dest', entries: [] }))

    const card = makeCard('Sol Ring', srcList, { set: 'c21', collectorNumber: '263' })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, dstList)

    const { writtenFiles } = await commitAllMoves(state)
    expect(await fs.exists(artSidecarPath(dstList.filePath))).toBe(false)
    expect(writtenFiles.some((file) => file.endsWith('.art.json'))).toBe(false)
  })

  test('a deck line that keeps copies keeps its art, and the moved copy still gets it', async () => {
    const srcList = makeList('deck', 'Source', 'src.md')
    const dstList = makeList('collection', 'Dest', 'dst.md')
    await fs.writeFile(
      srcList.filePath,
      deckMarkdown({
        frontMatter: { name: 'Source' },
        sections: [
          {
            name: 'Main',
            cards: [
              { quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
            ],
          },
        ],
      }),
    )
    await fs.writeFile(dstList.filePath, collectionMarkdown({ title: 'Dest', entries: [] }))
    await saveCardArt(srcList.filePath, new Map([[1, { url: 'https://example.test/ring.png' }]]))

    const card = makeCard('Sol Ring', srcList, { set: 'c21', collectorNumber: '263' })
    const state = buildVirtualState([card])
    applyVirtualMove(state, card.key, dstList)

    await commitAllMoves(state)

    // One copy is left, so the deck line — and its `&1` — is still there.
    expect(await fs.readFile(srcList.filePath, 'utf-8')).toContain('1 Sol Ring (C21:263) &1')
    expect(await artOf(srcList.filePath)).toEqual(
      new Map([[1, { url: 'https://example.test/ring.png' }]]),
    )
    expect(await artOf(dstList.filePath)).toEqual(
      new Map([[1, { url: 'https://example.test/ring.png' }]]),
    )
  })

  test('a committed removal drops the departed card’s art', async () => {
    const srcList = makeList('collection', 'Source', 'src.md')
    await fs.writeFile(
      srcList.filePath,
      collectionMarkdown({
        title: 'Source',
        entries: [
          { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
          { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 2 },
        ],
      }),
    )
    await saveCardArt(
      srcList.filePath,
      new Map([
        [1, { file: 'proxies/bolt.png' }],
        [2, { file: 'proxies/ring.png' }],
      ]),
    )

    const card = makeCard('Lightning Bolt', srcList, { collectorNumber: '161', cardId: 1 })
    const state = buildVirtualState([card])
    applyVirtualRemove(state, card.key)

    const { removed, writtenFiles } = await commitAllRemovals(state)
    expect(removed).toBe(1)
    expect(await artOf(srcList.filePath)).toEqual(new Map([[2, { file: 'proxies/ring.png' }]]))
    expect(writtenFiles).toContain(artSidecarPath(srcList.filePath))
  })
})
