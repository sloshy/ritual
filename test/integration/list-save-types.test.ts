import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import {
  createAddChange,
  createAddSectionChange,
  createRemoveChange,
  createRenameSectionChange,
  createSetLabelChange,
  createSetLanguageChange,
} from '../../src/changes/change-event'
import { toWireChange } from '../../src/changes/wire-changes'
import { handleListSave, type ListSaveResponse } from '../../src/admin/api/list-save'
import type { ApiErrorResponse } from '../../src/api/http'
import type { ListType } from '../../src/list/list-type'
import {
  bindWorkspace,
  snapshotTree,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'
import { hashOf, listSaveRequest, saveList } from '../helpers/list-save'

/**
 * What the shared save route does per list type: the file each type's adapter
 * reads, the line tokens its replay writes, the changelog lines and effects
 * it reports, and the refusals only one type raises. The route's own contract
 * (changes-only body, misses, stale hashes, decoder refusals) is
 * `list-save.test.ts`; reducer and serializer semantics are the unit layers'.
 */

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
})

afterEach(async () => {
  await ws.dispose()
})

/** The changelog sidecar of a list file. */
function changelogOf(filePath: string): string {
  return filePath.replace(/\.md$/, '.changes.md')
}

describe('POST /api/collection/:slug/save', () => {
  let filePath: string

  beforeEach(async () => {
    // Two entries, so `&1` and `&2` are both taken: an add that *requests* `&2`
    // can then only come back as `&3`, and a route that echoed the requested id
    // instead of allocating one would be caught.
    filePath = await writeCollectionFile(ws.dir, 'binder', {
      title: 'Binder',
      entries: [
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
        { name: 'Counterspell', set: 'lea', collectorNumber: '55', cardId: 2 },
      ],
    })
  })

  test('rejects an add without set and collector number, leaving the file untouched', async () => {
    // A collection line without `(SET:NUM)` would serialize as a malformed
    // `(:)` token that no longer parses — the one refusal only this type raises.
    const before = await snapshotTree(ws.dir)
    const resp = await saveList('collection', 'binder', filePath, [
      toWireChange(createAddChange('Sol Ring', { cardId: 2 })),
    ])

    expect(resp.status).toBe(400)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.success).toBe(false)
    expect(body.message).toBe(
      'Cannot add "Sol Ring" to a collection without set and collector number',
    )
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  test('the response reports the effects of an add and of a removal', async () => {
    // `&N` ids are allocated at serialization, inside the route, so the
    // response is the only place a client can learn the id its add received.
    const added = await saveList('collection', 'binder', filePath, [
      toWireChange(createAddChange('Sol Ring', { set: 'c21', collectorNumber: '167', cardId: 2 })),
    ])
    expect(added.status).toBe(200)
    // `&3`, not the requested `&2`: that number is already this list's.
    expect(await fs.readFile(filePath, 'utf-8')).toContain('- Sol Ring (C21:167) &3')
    const addedBody = (await added.json()) as ListSaveResponse
    expect(addedBody.effects).toEqual([
      {
        action: 'added',
        cardId: 3,
        name: 'Sol Ring',
        section: 'Main',
        quantity: 1,
        printing: {
          set: 'c21',
          collectorNumber: '167',
          finish: 'nonfoil',
          condition: 'NM',
        },
      },
    ])

    const removed = await saveList(
      'collection',
      'binder',
      filePath,
      [toWireChange(createRemoveChange('Lightning Bolt', { cardId: 1 }))],
      { contentHash: addedBody.contentHash },
    )
    expect(removed.status).toBe(200)
    const removedBody = (await removed.json()) as ListSaveResponse
    expect(removedBody.effects).toHaveLength(1)
    expect(removedBody.effects[0]).toMatchObject({
      action: 'removed',
      cardId: 1,
      name: 'Lightning Bolt',
    })
  })

  test('set-label writes the token and the changelog line', async () => {
    const resp = await saveList('collection', 'binder', filePath, [
      toWireChange(
        createSetLabelChange('Lightning Bolt', { labels: ['trade', 'sale'], cardId: 1 }),
      ),
    ])
    expect(resp.status).toBe(200)

    expect(await fs.readFile(filePath, 'utf-8')).toContain(
      '- Lightning Bolt (LEA:161) [sale,trade] &1',
    )
    expect(await fs.readFile(changelogOf(filePath), 'utf-8')).toContain(
      '- Set labels on "Lightning Bolt" &1 to [sale,trade]',
    )
  })

  test('an empty label set clears the token and logs the clear', async () => {
    const seed = await saveList('collection', 'binder', filePath, [
      toWireChange(createSetLabelChange('Lightning Bolt', { labels: ['keep'], cardId: 1 })),
    ])
    expect(seed.status).toBe(200)

    const resp = await saveList('collection', 'binder', filePath, [
      toWireChange(createSetLabelChange('Lightning Bolt', { labels: [], cardId: 1 })),
    ])
    expect(resp.status).toBe(200)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('- Lightning Bolt (LEA:161) &1')
    expect(content).not.toContain('[keep]')
    expect(await fs.readFile(changelogOf(filePath), 'utf-8')).toContain(
      '- Cleared labels on "Lightning Bolt" &1',
    )
  })

  test('add-tag canonicalizes the tag, writes the tag token, and logs the line', async () => {
    // Sent as a person might type it — stray sigil and doubled space — and
    // stored canonical: the route is the boundary that normalizes, so the line
    // and the changelog agree on `Card Draw`.
    const resp = await saveList('collection', 'binder', filePath, [
      { action: 'add-tag', cardName: 'Lightning Bolt', cardId: 1, tag: '#Card  Draw' },
    ])
    expect(resp.status).toBe(200)

    expect(await fs.readFile(filePath, 'utf-8')).toContain(
      '- Lightning Bolt (LEA:161) #Card Draw &1',
    )
    expect(await fs.readFile(changelogOf(filePath), 'utf-8')).toContain(
      '- Added tag "Card Draw" to "Lightning Bolt" &1',
    )
  })

  test('set-language writes the [ja] token, the changelog line, and an updated effect', async () => {
    const resp = await saveList('collection', 'binder', filePath, [
      toWireChange(createSetLanguageChange('Lightning Bolt', { language: 'ja', cardId: 1 })),
    ])
    expect(resp.status).toBe(200)

    expect(await fs.readFile(filePath, 'utf-8')).toContain('- Lightning Bolt (LEA:161) [ja] &1')
    expect(await fs.readFile(changelogOf(filePath), 'utf-8')).toContain(
      '- Set language of "Lightning Bolt" to Japanese &1',
    )
    const body = (await resp.json()) as ListSaveResponse
    expect(body.effects).toHaveLength(1)
    expect(body.effects[0]).toMatchObject({
      action: 'updated',
      cardId: 1,
      name: 'Lightning Bolt',
    })
  })

  test('refuses a slug that would escape the collections directory', async () => {
    const req = listSaveRequest('collection', '../escape', [], {
      contentHash: await hashOf(filePath),
    })
    const resp = await handleListSave(req, 'collection')
    expect(resp.status).toBe(400)
    // Refused by the shared slug rule before the file is ever resolved;
    // `resolveFlatListFile`'s own containment check is the second line.
    expect(((await resp.json()) as ApiErrorResponse).message).toBe('Invalid list slug')
  })
})

/** A flat list type, and the fixture writer for a one-card file of it. */
type FlatListCase = {
  type: Extract<ListType, 'collection' | 'wanted'>
  write: () => Promise<string>
}

const FLAT_LISTS: FlatListCase[] = [
  {
    type: 'collection',
    write: () =>
      writeCollectionFile(ws.dir, 'binder', {
        title: 'Binder',
        entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
      }),
  },
  {
    type: 'wanted',
    write: () =>
      writeWantedFile(ws.dir, 'binder', {
        title: 'Binder',
        entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
      }),
  },
]

describe.each(FLAT_LISTS)('POST /api/$type/:slug/save — front matter', ({ type, write }) => {
  test('the file’s front matter survives the save, since no request can carry it', async () => {
    const filePath = await write()
    await fs.writeFile(
      filePath,
      '---\ndescription: Trade stock.\n---\n\n' + (await fs.readFile(filePath, 'utf-8')),
    )

    const resp = await saveList(type, 'binder', filePath, [
      toWireChange(createAddChange('Sol Ring', { set: 'c21', collectorNumber: '263' })),
    ])
    expect(resp.status).toBe(200)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content.startsWith('---\ndescription: Trade stock.\n---\n\n# Binder')).toBeTrue()
    expect(content).toContain('- Sol Ring (C21:263) &2')
  })
})

/** A flat list type, and the fixture writer for a file whose sections are out of name order. */
type SectionOrderCase = {
  type: Extract<ListType, 'collection' | 'wanted'>
  write: () => Promise<string>
}

/** `## Zed` before `## Alpha`: the file's order, which no sort would produce. */
const OUT_OF_ORDER = {
  title: 'Binder',
  sectionOrder: ['Zed', 'Alpha'],
  entries: [
    { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1, section: 'Zed' },
    { name: 'Counterspell', set: 'lea', collectorNumber: '55', cardId: 2, section: 'Alpha' },
  ],
}

const SECTION_ORDER_CASES: SectionOrderCase[] = [
  { type: 'collection', write: () => writeCollectionFile(ws.dir, 'binder', OUT_OF_ORDER) },
  { type: 'wanted', write: () => writeWantedFile(ws.dir, 'binder', OUT_OF_ORDER) },
]

describe.each(SECTION_ORDER_CASES)(
  'POST /api/$type/:slug/save — section order',
  ({ type, write }) => {
    test('the file’s section order is kept, with the session’s rename and add replayed over it', async () => {
      const filePath = await write()

      const resp = await saveList(type, 'binder', filePath, [
        toWireChange(createRenameSectionChange('Zed', 'Omega')),
        toWireChange(createAddSectionChange('Beta')),
      ])
      expect(resp.status).toBe(200)

      // Renamed in place, the new section last: an alphabetical write would put
      // Alpha, Beta, Omega instead.
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).not.toContain('## Zed')
      const omega = content.indexOf('## Omega')
      const alpha = content.indexOf('## Alpha')
      const beta = content.indexOf('## Beta')
      expect(omega).toBeGreaterThan(-1)
      expect(alpha).toBeGreaterThan(omega)
      expect(beta).toBeGreaterThan(alpha)
    })
  },
)

describe('POST /api/deck/:slug/save', () => {
  let filePath: string

  beforeEach(async () => {
    // A title that is not the slug: the deck's name is read from the file, so
    // the heading must come back unchanged whatever the slug says.
    filePath = await writeDeckFile(ws.dir, 'burn', {
      name: 'Burn Deluxe',
      cards: [
        { name: 'Lightning Bolt', quantity: 2, set: 'lea', collectorNumber: '161', cardId: 1 },
      ],
    })
  })

  test('a set-label change writes the [proxy] token and its changelog line under the file’s title', async () => {
    const resp = await saveList('deck', 'burn', filePath, [
      toWireChange(createSetLabelChange('Lightning Bolt', { labels: ['proxy'], cardId: 1 })),
    ])
    expect(resp.status).toBe(200)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('# Burn Deluxe')
    expect(content).toContain('2 Lightning Bolt (LEA:161) [proxy] &1')
    expect(await fs.readFile(changelogOf(filePath), 'utf-8')).toContain(
      '- Set labels on "Lightning Bolt" &1 to [proxy]',
    )
  })

  test('a label a deck cannot carry is a 400 that writes nothing', async () => {
    // `sale` is legal on a collection, so this refusal proves the route judges
    // the change against the deck's label set, not some other type's.
    const before = await snapshotTree(ws.dir)
    const resp = await saveList('deck', 'burn', filePath, [
      toWireChange(createSetLabelChange('Lightning Bolt', { labels: ['sale'], cardId: 1 })),
    ])
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as ApiErrorResponse).message).toContain(
      'labels [sale] are not supported on a deck',
    )
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  test('front matter the YAML parser cannot read is a 400 that writes nothing', async () => {
    // Re-serializing would drop the unreadable block, so the save refuses
    // instead of quietly deleting the user's metadata.
    await fs.writeFile(filePath, `---\nimage: [bad\n---\n${await fs.readFile(filePath, 'utf-8')}`)
    const before = await snapshotTree(ws.dir)

    const resp = await saveList('deck', 'burn', filePath, [
      toWireChange(createAddChange('Shock', { set: 'm19', collectorNumber: '156' })),
    ])

    expect(resp.status).toBe(400)
    expect(((await resp.json()) as ApiErrorResponse).message).toContain(
      "The deck's front matter could not be read",
    )
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  /** Append `header` to the deck on disk, as a hand edit would leave it. */
  async function appendHeader(header: string): Promise<void> {
    await fs.writeFile(filePath, `${await fs.readFile(filePath, 'utf-8')}\n${header}\n`)
  }

  test('a baseline carrying a bare ## Maybeboard saves, and the write clears it', async () => {
    // The whole-file save refuses a baseline whose content it cannot re-emit.
    // An empty extras header is not such content — it holds nothing — so the
    // save goes through and the header is gone afterwards.
    await appendHeader('## Maybeboard')

    const resp = await saveList('deck', 'burn', filePath, [])

    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).not.toContain('Maybeboard')
  })

  test('a baseline carrying a bare ## Sideboard saves, and the write keeps it', async () => {
    // Emptiness alone does not make a header droppable: the sideboard is a
    // board the deck is expected to have, so the parser keeps it as an empty
    // section and the replayed write emits it back as a bare header.
    await appendHeader('## Sideboard')

    const resp = await saveList('deck', 'burn', filePath, [])

    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('\n## Sideboard\n')
  })
})

describe('POST /api/wanted/:slug/save', () => {
  test('a set-label change is a 400 that writes nothing — wanted lists carry no labels', async () => {
    // A wanted list carries no labels (the line grammar refuses the token), so
    // the route refuses label input instead of logging a `Set labels` line the
    // changelog parser would read back for a list that can never hold one. The
    // per-type decision is pinned by `test/unit/card-labels.test.ts`; this pins
    // that the route hands the decoder the wanted type.
    const filePath = await writeWantedFile(ws.dir, 'wishlist', {
      title: 'Wishlist',
      entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
    })
    const before = await snapshotTree(ws.dir)

    const resp = await saveList('wanted', 'wishlist', filePath, [
      // `sale` is legal on a collection — the refusal is the type rule, not the vocabulary.
      toWireChange(createSetLabelChange('Lightning Bolt', { labels: ['sale'], cardId: 1 })),
    ])

    expect(resp.status).toBe(400)
    expect(((await resp.json()) as ApiErrorResponse).message).toContain(
      'labels do not apply to a wanted',
    )
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })
})
