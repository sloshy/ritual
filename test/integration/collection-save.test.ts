import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createAddChange, createRemoveChange, type ChangeEvent } from '../../src/change-event'
import { handleCollectionSave } from '../../src/admin/api/collection-save'
import type { ListSaveResponse } from '../../src/admin/api/move-save'
import { computeHash } from '../../src/content-hash'
import { bindWorkspace, writeCollectionFile, type BoundWorkspace } from './helpers/workspace'

/**
 * Collection saves must refuse changes that would write a printing-less entry —
 * a collection line without `(SET:NUM)` serializes as a malformed `(:)` token
 * that no longer parses. The full apply/serialize semantics are pinned by the
 * unit layers; this covers the handler wiring: the 400 rejection path and one
 * representative happy path.
 */

let ws: BoundWorkspace
let tmpDir: string
let filePath: string
let contentHash: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
  // Two entries, so `&1` and `&2` are both taken: an add that *requests* `&2`
  // can then only come back as `&3`, and a handler that echoed the requested id
  // instead of allocating one would be caught.
  filePath = await writeCollectionFile(tmpDir, 'binder', {
    title: 'Binder',
    entries: [
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      { name: 'Counterspell', set: 'lea', collectorNumber: '55', cardId: 2 },
    ],
  })
  contentHash = computeHash(await fs.readFile(filePath, 'utf-8'))
})

afterEach(async () => {
  await ws.dispose()
})

async function save(changes: ChangeEvent[]): Promise<Response> {
  const req = new Request('http://localhost/api/collection/binder/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes, contentHash }),
  })
  return handleCollectionSave(req)
}

describe('POST /api/collection/:slug/save', () => {
  test('rejects an add without set and collector number, leaving the file untouched', async () => {
    const before = await fs.readFile(filePath, 'utf-8')
    const resp = await save([createAddChange('Sol Ring', { cardId: 2 })])

    expect(resp.status).toBe(400)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toBe(
      'Cannot add "Sol Ring" to a collection without set and collector number',
    )

    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
    expect(await fs.exists(path.join(tmpDir, 'collections', 'binder.changes.md'))).toBe(false)
  })

  test('rejects a change whose target does not exist, leaving the file untouched', async () => {
    const before = await fs.readFile(filePath, 'utf-8')
    // Wrong case — replay targeting is exact and case-sensitive.
    const resp = await save([createRemoveChange('lightning bolt')])
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toContain('matched no card')
    expect(body.message).toContain('lightning bolt')
    expect(body.message).toContain('Nothing was saved')

    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
    expect(await fs.exists(path.join(tmpDir, 'collections', 'binder.changes.md'))).toBe(false)
  })

  test('a fully specified add appends the canonical line and succeeds', async () => {
    const resp = await save([
      createAddChange('Sol Ring', { set: 'c21', collectorNumber: '167', cardId: 2 }),
    ])

    expect(resp.status).toBe(200)
    const content = await fs.readFile(filePath, 'utf-8')
    // `&3`, not the requested `&2`: that number is already this list's.
    expect(content).toContain('- Sol Ring (C21:167) &3')
  })

  test('refuses a slug that would escape the collections directory', async () => {
    const req = new Request('http://localhost/api/collection/..%2Fescape/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: [], contentHash }),
    })
    const resp = await handleCollectionSave(req)
    expect(resp.status).toBe(400)
    // Refused by the shared slug rule before the file is ever resolved;
    // `resolveFlatListFile`'s own containment check is the second line.
    expect(((await resp.json()) as { message: string }).message).toBe('Invalid list slug')
  })

  test('the response reports the effects of an add and of a removal', async () => {
    // `&N` ids are allocated at serialization, inside the handler, so the
    // response is the only place a client can learn the id its add received.
    const added = await save([
      createAddChange('Sol Ring', { set: 'c21', collectorNumber: '167', cardId: 2 }),
    ])
    expect(added.status).toBe(200)
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

    contentHash = addedBody.contentHash
    const removed = await save([createRemoveChange('Lightning Bolt', { cardId: 1 })])
    expect(removed.status).toBe(200)
    const removedBody = (await removed.json()) as ListSaveResponse
    expect(removedBody.effects).toHaveLength(1)
    expect(removedBody.effects[0]).toMatchObject({
      action: 'removed',
      cardId: 1,
      name: 'Lightning Bolt',
    })
  })
})
