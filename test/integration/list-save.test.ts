import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createAddChange,
  createAddSectionChange,
  createMoveFromChange,
  createMoveToChange,
  createRemoveChange,
  createSetLabelChange,
  createSetNoteChange,
  type ListRef,
} from '../../src/changes/change-event'
import { toWireChange } from '../../src/changes/wire-changes'
import { parseChangelog } from '../../src/changes/changelog-parser'
import {
  handleListSave,
  type ListSaveRefusal,
  type ListSaveResponse,
} from '../../src/admin/api/list-save'
import type { ApiErrorResponse } from '../../src/api/http'
import { parseDeckFrontMatter } from '../../src/list/deck-file'
import type { ListType } from '../../src/list/list-type'
import { saveCardCategories } from '../../src/list/card-categories-sidecar'
import { categoriesRecord } from '../helpers/card-categories'
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
 * The save route's contract: a request carries only the changes (in wire form,
 * no envelope), and the route replays them over the file. These pin the parts
 * only the route owns — what it takes from the file rather than the client,
 * and how it refuses. Replay semantics are the reducers' own unit tests.
 */

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
})

afterEach(async () => {
  await ws.dispose()
})

/** The one-card wanted list most refusal cases save against. */
function writeWishlist(): Promise<string> {
  return writeWantedFile(ws.dir, 'wishlist', { entries: [{ name: 'Sol Ring', cardId: 1 }] })
}

/** The changelog sidecar of a list file. */
function changelogOf(filePath: string): string {
  return filePath.replace(/\.md$/, '.changes.md')
}

describe('POST /api/:type/:slug/save', () => {
  test('a deck save of changes alone writes the replayed deck and reports the allocated id', async () => {
    const filePath = await writeDeckFile(ws.dir, 'burn', {
      name: 'Burn',
      frontMatter: { description: 'Go face.', image: { card: 1 }, labels: ['proxy'] },
      cards: [
        { name: 'Lightning Bolt', quantity: 2, set: 'lea', collectorNumber: '161', cardId: 1 },
      ],
    })

    const resp = await saveList('deck', 'burn', filePath, [
      toWireChange(createAddChange('Shock', { set: 'm19', collectorNumber: '156' })),
    ])

    expect(resp.status).toBe(200)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('2 Lightning Bolt (LEA:161) &1')
    expect(content).toContain('1 Shock (M19:156) &2')
    // Front matter is the file's own: nothing in the request could carry it —
    // including the cover and the default labels the metadata route writes
    // mid-session, which a stale client snapshot would otherwise delete.
    expect(await parseDeckFrontMatter(filePath)).toMatchObject({
      description: 'Go face.',
      image: { card: 1 },
      labels: ['proxy'],
    })
    const body = (await resp.json()) as ListSaveResponse
    expect(body.effects).toHaveLength(1)
    expect(body.effects[0]).toMatchObject({ action: 'added', cardId: 2, name: 'Shock' })
  })

  test('a change that misses its card refuses the whole batch with the misses listed', async () => {
    const filePath = await writeDeckFile(ws.dir, 'burn', {
      name: 'Burn',
      cards: [
        { name: 'Lightning Bolt', quantity: 2, set: 'lea', collectorNumber: '161', cardId: 1 },
      ],
    })
    const before = await snapshotTree(ws.dir)

    const resp = await saveList('deck', 'burn', filePath, [
      toWireChange(createAddChange('Shock', { set: 'm19', collectorNumber: '156' })),
      toWireChange(createRemoveChange('Black Lotus', { cardId: 9 })),
    ])

    expect(resp.status).toBe(400)
    const body = (await resp.json()) as ListSaveRefusal
    expect(body.unmatched).toHaveLength(1)
    expect(body.unmatched[0]).toContain('Black Lotus')
    expect(body.messageKey).toBe('domain.changes.unmatched.summary')
    expect(body.message).toMatch(/^1 change matched no card in deck "burn": /)
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  test('a section the session added survives the write even while empty', async () => {
    const filePath = await writeWishlist()

    const resp = await saveList('wanted', 'wishlist', filePath, [
      toWireChange(createAddSectionChange('Upgrades')),
    ])

    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('## Upgrades')
  })

  test('a stale content hash is a 409 flagged as a conflict that writes nothing', async () => {
    const filePath = await writeWishlist()
    const before = await snapshotTree(ws.dir)

    const resp = await saveList(
      'wanted',
      'wishlist',
      filePath,
      [toWireChange(createAddChange('Mana Crypt'))],
      { contentHash: 'stale' },
    )

    expect(resp.status).toBe(409)
    // The flag, not the status alone, is what a client branches on to offer a reload.
    expect(((await resp.json()) as { conflict?: boolean }).conflict).toBe(true)
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  test('a change the file format cannot hold is refused before the list is even resolved', async () => {
    // No such list: a route that read the file first would answer 404. The
    // decoder's 400 proves the batch is judged before any file is touched.
    const resp = await handleListSave(
      listSaveRequest(
        'wanted',
        'no-such-list',
        [{ action: 'set-language', cardName: 'Sol Ring', cardId: 1, language: 'xx' }],
        { contentHash: 'unused' },
      ),
      'wanted',
    )

    expect(resp.status).toBe(400)
    expect(((await resp.json()) as ListSaveRefusal).message).toContain('changes[0]')
  })

  test('a set-note with a pasted trailing newline is stored trimmed', async () => {
    const filePath = await writeWishlist()

    const resp = await saveList('wanted', 'wishlist', filePath, [
      toWireChange(createSetNoteChange('Sol Ring', { note: 'Signed\n', cardId: 1 })),
    ])

    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('- Sol Ring {Signed} &1\n')
    expect(await fs.readFile(changelogOf(filePath), 'utf-8')).toContain(
      'Set note on "Sol Ring" &1 to "Signed"',
    )
  })

  test('an add sent without an id is logged with the id its line got', async () => {
    // Raw API clients (the MCP server among them) send adds with no `&N`; the
    // route gives one out as it replays, so the changelog records it too — the
    // id the removal before it released.
    const filePath = await writeWantedFile(ws.dir, 'wishlist', {
      entries: [
        { name: 'Sol Ring', cardId: 1 },
        { name: 'Opt', cardId: 2 },
        { name: 'Ponder', cardId: 3 },
      ],
    })

    const resp = await saveList('wanted', 'wishlist', filePath, [
      toWireChange(createRemoveChange('Opt', { cardId: 2 })),
      toWireChange(createAddChange('Lightning Bolt')),
    ])

    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('- Lightning Bolt &2\n')
    const changelog = await fs.readFile(changelogOf(filePath), 'utf-8')
    expect(changelog).toContain('Added "Lightning Bolt" &2')
    const logged = parseChangelog(changelog).pages.flatMap((page) => page.changes)
    expect(logged.find((change) => change.action === 'add')).toMatchObject({
      cardName: 'Lightning Bolt',
      cardId: 2,
    })
  })

  test('the save route accepts a signed set-label on the wire and logs it signed', async () => {
    const filePath = await writeDeckFile(ws.dir, 'proxies', {
      frontMatter: { labels: ['proxy'] },
      cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
    })

    const resp = await saveList('deck', 'proxies', filePath, [
      toWireChange(createSetLabelChange('Sol Ring', { labels: ['no-proxy'], cardId: 1 })),
    ])

    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('1 Sol Ring [no-proxy] &1')
    const changelog = await fs.readFile(changelogOf(filePath), 'utf-8')
    expect(changelog).toContain('Set labels on "Sol Ring" &1 to [no-proxy]')
    expect(changelog).toContain('"labels":["no-proxy"]')
  })

  test('a set-note holding a control character is a 400 that writes nothing', async () => {
    const filePath = await writeWishlist()
    const before = await snapshotTree(ws.dir)

    const resp = await saveList('wanted', 'wishlist', filePath, [
      toWireChange(createSetNoteChange('Sol Ring', { note: 'Signed\tby Rob', cardId: 1 })),
    ])

    expect(resp.status).toBe(400)
    expect(((await resp.json()) as ApiErrorResponse).message).toContain('single-line text')
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  test('a line break in a card name is a 400 naming the field by message key and path', async () => {
    const filePath = await writeWishlist()
    const before = await snapshotTree(ws.dir)

    const resp = await saveList('wanted', 'wishlist', filePath, [
      { action: 'add', cardName: 'Sol Ring\n- Black Lotus &3' },
    ])

    expect(resp.status).toBe(400)
    expect(await resp.json()).toMatchObject({
      success: false,
      messageKey: 'admin.api.save.lineBreak',
      messageParams: { field: 'changes[0].cardName' },
    })
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  test('two changes sharing a client-sent id both apply: the route stamps its own envelope', async () => {
    const filePath = await writeWishlist()

    const resp = await saveList('wanted', 'wishlist', filePath, [
      { id: 'dup', timestamp: 1, action: 'add', cardName: 'Mana Crypt' },
      { id: 'dup', timestamp: 1, action: 'add', cardName: 'Mana Vault' },
    ])

    expect(resp.status).toBe(200)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('- Mana Crypt &2')
    expect(content).toContain('- Mana Vault &3')
  })

  test('an add claiming an id far past the list’s own is a 400 that writes nothing', async () => {
    // The id pool fills every number up to the file's highest, so honouring
    // `&999999` would cost every later load of this list that many entries.
    const filePath = await writeWishlist()
    const before = await snapshotTree(ws.dir)

    const resp = await saveList('wanted', 'wishlist', filePath, [
      toWireChange(createAddChange('Mana Crypt', { cardId: 999_999 })),
    ])

    expect(resp.status).toBe(400)
    expect(((await resp.json()) as ApiErrorResponse).message).toContain('&999999')
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  test('a deck without a # Title, found through a loose slug, keeps its file name as its title', async () => {
    // `winota-stax` resolves to `Winota Stax.md`; the title the write gives the
    // heading-less deck must be the file's name, never the request's slug.
    const filePath = path.join(ws.dir, 'decks', 'Winota Stax.md')
    await fs.writeFile(filePath, '## Main\n\n1 Lightning Bolt (LEA:161) &1\n')

    const resp = await saveList('deck', 'winota-stax', filePath, [
      toWireChange(createAddChange('Shock', { set: 'm19', collectorNumber: '156' })),
    ])

    expect(resp.status).toBe(200)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toMatch(/^\s*# Winota Stax\n/)
    expect(content).not.toContain('winota-stax')
    expect(content).toContain('1 Shock (M19:156) &2')
  })
})

/** A save body carrying a field the route used to read, beside the changes. */
type LegacyKeysCase = {
  type: Extract<ListType, 'deck' | 'wanted'>
  write: () => Promise<string>
  legacy: Record<string, unknown>
}

const LEGACY_KEYS: LegacyKeysCase[] = [
  {
    type: 'deck',
    write: () =>
      writeDeckFile(ws.dir, 'list', {
        name: 'List',
        cards: [{ name: 'Sol Ring', quantity: 1, cardId: 1 }],
      }),
    legacy: {
      deck: {
        name: 'Hijacked',
        sections: [{ name: 'Injected', cards: [{ name: 'Black Lotus', quantity: 1 }] }],
      },
      frontMatter: { description: 'Injected' },
    },
  },
  {
    type: 'wanted',
    write: () =>
      writeWantedFile(ws.dir, 'list', {
        title: 'List',
        entries: [{ name: 'Sol Ring', cardId: 1 }],
      }),
    legacy: {
      entries: [{ name: 'Black Lotus', section: 'Injected' }],
      sectionOrder: ['Injected'],
      frontMatter: { description: 'Injected' },
    },
  },
]

describe.each(LEGACY_KEYS)(
  'POST /api/$type/:slug/save — body fields',
  ({ type, write, legacy }) => {
    test('the list fields older clients sent beside the changes are ignored', async () => {
      const filePath = await write()
      const req = new Request(`http://localhost/api/${type}/list/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: [toWireChange(createAddChange('Mana Crypt'))],
          contentHash: await hashOf(filePath),
          ...legacy,
        }),
      })

      const resp = await handleListSave(req, type)

      expect(resp.status).toBe(200)
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('# List')
      expect(content).toContain('Sol Ring')
      expect(content).toContain('Mana Crypt')
      for (const injected of ['Hijacked', 'Injected', 'Black Lotus']) {
        expect(content).not.toContain(injected)
      }
    })
  },
)

describe('cross-list moves through the save route', () => {
  /** The collection's title differs from its slug and file name on purpose. */
  const TRADE_BINDER: ListRef = { type: 'collection', name: 'Trade Binder' }
  const BURN: ListRef = { type: 'deck', name: 'Burn' }

  let binderPath: string
  let deckPath: string

  beforeEach(async () => {
    binderPath = await writeCollectionFile(ws.dir, 'binder', {
      title: 'Trade Binder',
      entries: [
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
        { name: 'Counterspell', set: 'lea', collectorNumber: '55', cardId: 2 },
      ],
    })
    deckPath = await writeDeckFile(ws.dir, 'burn', {
      name: 'Burn',
      cards: [{ name: 'Shock', quantity: 1, set: 'm19', collectorNumber: '156', cardId: 1 }],
    })
  })

  test('a collection’s outgoing move names it by its # Title in the other list’s changelog', async () => {
    const resp = await saveList('collection', 'binder', binderPath, [
      toWireChange(
        createMoveFromChange('Lightning Bolt', {
          set: 'lea',
          collectorNumber: '161',
          cardId: 1,
          to: BURN,
        }),
      ),
    ])

    expect(resp.status).toBe(200)
    expect(await fs.readFile(deckPath, 'utf-8')).toContain('Lightning Bolt (LEA:161)')
    const deckLog = await fs.readFile(changelogOf(deckPath), 'utf-8')
    expect(deckLog).toMatch(/Moved "Lightning Bolt".*from Collection 'Trade Binder'/)
    expect(deckLog).not.toContain("Collection 'binder'")
  })

  test('a move that drains the source’s last copy of a categorized name reports the prune', async () => {
    // The prune happens on the *other* list's write; the response is still the
    // one place the client learns of it.
    await saveCardCategories(
      binderPath,
      categoriesRecord(['Burn', 'Control'], {
        'Lightning Bolt': ['Burn'],
        Counterspell: ['Control'],
      }),
    )

    const resp = await saveList('deck', 'burn', deckPath, [
      toWireChange(
        createMoveToChange('Lightning Bolt', {
          set: 'lea',
          collectorNumber: '161',
          cardId: 2,
          sourceCardId: 1,
          from: TRADE_BINDER,
        }),
      ),
    ])

    expect(resp.status).toBe(200)
    expect(((await resp.json()) as ListSaveResponse).prunedCategories).toEqual(['Lightning Bolt'])
  })
})
