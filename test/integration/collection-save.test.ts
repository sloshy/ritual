import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createAddChange, createRemoveChange, type ChangeEvent } from '../../src/change-event'
import { handleCollectionSave } from '../../src/admin/api/collection-save'
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
  filePath = await writeCollectionFile(tmpDir, 'binder', {
    title: 'Binder',
    entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
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
    expect(content).toContain('- Sol Ring (C21:167) &2')
  })
})
