import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { handleWantedListSave } from '../../src/admin/api/wanted-save'
import type { ListSaveResponse } from '../../src/admin/api/list-save'
import { createAddChange, createSetLanguageChange } from '../../src/changes/change-event'
import { computeHash } from '../../src/changes/content-hash'
import {
  bindWorkspace,
  writeWantedFile,
  type BoundWorkspace,
  type WantedFixtureEntry,
} from './helpers/workspace'

/**
 * The wanted list's half of the save-effects contract, which the collection
 * suite covers for the other flat list type.
 *
 * The two handlers differ in where the entries come from: a collection save
 * replays the changes against the file itself, while a wanted save serializes
 * the `entries` the client sends. Only the second path can hand the serializer
 * an entry with no id at all, which is exactly the case where the response is
 * the only place the allocated `&N` appears — so it gets its own coverage. Diff
 * semantics are pinned by `test/unit/save-effects.test.ts`.
 */

let ws: BoundWorkspace
let filePath: string
let contentHash: string

/**
 * Two seeded entries, so `&1` and `&2` are taken and a new line can only be
 * `&3`. `section` is spelled out because the save re-sends the whole entry list
 * and the parser defaults an unsectioned line to `Main` — a client that dropped
 * it would be asking to move every line, not to add one.
 */
const SEEDED: WantedFixtureEntry[] = [
  { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1, section: 'Main' },
  { name: 'Counterspell', set: 'lea', collectorNumber: '55', cardId: 2, section: 'Main' },
]

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  filePath = await writeWantedFile(ws.dir, 'wishlist', { title: 'Wishlist', entries: SEEDED })
  contentHash = computeHash(await fs.readFile(filePath, 'utf-8'))
})

afterEach(async () => {
  await ws.dispose()
})

function save(body: Record<string, unknown>): Promise<Response> {
  const req = new Request('http://localhost/api/wanted/wishlist/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentHash, ...body }),
  })
  return handleWantedListSave(req)
}

describe('POST /api/wanted/:slug/save', () => {
  test('reports the &N id it allocated for an entry that arrived without one', async () => {
    const resp = await save({
      changes: [createAddChange('Sol Ring', { set: 'c21', collectorNumber: '167' })],
      entries: [
        ...SEEDED,
        { name: 'Sol Ring', set: 'c21', collectorNumber: '167', section: 'Main' },
      ],
    })

    expect(resp.status).toBe(200)
    const body = (await resp.json()) as ListSaveResponse
    expect(body.effects).toEqual([
      {
        action: 'added',
        cardId: 3,
        name: 'Sol Ring',
        section: 'Main',
        quantity: 1,
        printing: { set: 'c21', collectorNumber: '167' },
      },
    ])
    // The id the response reported is the id on disk — the agreement is the
    // point, since the client had no id to compare against.
    expect(await fs.readFile(filePath, 'utf-8')).toContain('- Sol Ring (C21:167) &3')
  })

  test('set-language writes the [ja] token, the changelog line, and an updated effect', async () => {
    // A wanted save serializes the entries the client sends, so the entry
    // carries the applied language and the change drives changelog + validation.
    const resp = await save({
      changes: [createSetLanguageChange('Lightning Bolt', { language: 'ja', cardId: 1 })],
      entries: [{ ...SEEDED[0]!, language: 'ja' }, SEEDED[1]!],
    })

    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('- Lightning Bolt (LEA:161) [ja] &1')

    const changelog = await fs.readFile(path.join(ws.dir, 'wanted', 'wishlist.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set language of "Lightning Bolt" to Japanese &1')

    const body = (await resp.json()) as ListSaveResponse
    expect(body.effects).toHaveLength(1)
    expect(body.effects[0]).toMatchObject({
      action: 'updated',
      cardId: 1,
      name: 'Lightning Bolt',
    })
  })

  test('an add carrying a language writes the token on the new line', async () => {
    const resp = await save({
      changes: [
        createAddChange('Sol Ring', { set: 'c21', collectorNumber: '167', language: 'ja' }),
      ],
      entries: [
        ...SEEDED,
        { name: 'Sol Ring', set: 'c21', collectorNumber: '167', language: 'ja', section: 'Main' },
      ],
    })

    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('- Sol Ring (C21:167) [ja] &3')
  })

  test('an unknown entry language is a 400 that writes nothing', async () => {
    const before = await fs.readFile(filePath, 'utf-8')
    const resp = await save({
      changes: [],
      // Not a Scryfall code — the cast is the point: the wire is unvalidated.
      entries: [{ ...SEEDED[0]!, language: 'xx' as never }, SEEDED[1]!],
    })
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.message).toContain('"xx"')
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })

  test('refuses a slug that would escape the wanted directory', async () => {
    const req = new Request('http://localhost/api/wanted/..%2Fescape/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: [], entries: [], contentHash }),
    })
    const resp = await handleWantedListSave(req)
    expect(resp.status).toBe(400)
    // Refused by the shared slug rule before the file is ever resolved;
    // `resolveFlatListFile`'s own containment check is the second line.
    expect(((await resp.json()) as { message: string }).message).toBe('Invalid list slug')
  })
})
