import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleMetadataSave, type MetadataResponse } from '../../src/admin/api/metadata'
import { parseCollectionFile } from '../../src/list/collection-file'
import { bindWorkspace, writeCollectionFile } from './helpers/workspace'
import type { BoundWorkspace } from './helpers/workspace'
import { callJson } from './helpers/request'
import { computeHash } from '../../src/changes/content-hash'

/**
 * `PUT /api/metadata/collection/:slug` — `labels` and `description` front-matter
 * writes against real collection files. The body validator and the label vocabulary are
 * unit-tested; what matters here is the file side effect: the block is created,
 * replaced, or removed while the card lines survive byte for byte.
 */

let ws: BoundWorkspace
let filePath: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  filePath = await writeCollectionFile(ws.dir, 'binder', {
    title: 'Binder',
    entries: [
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', labels: ['keep'], cardId: 2 },
    ],
  })
})

afterEach(async () => {
  await ws.dispose()
})

type MetadataBody = MetadataResponse | { success: false; message: string }
type MetadataCall = { status: number; body: MetadataBody }

function put(body: unknown): Promise<MetadataCall> {
  return callJson<MetadataBody>(handleMetadataSave, 'PUT', '/api/metadata/collection/binder', body)
}

function expectSuccess(body: MetadataBody): MetadataResponse {
  if (!body.success) throw new Error(`expected a successful metadata write, got: ${body.message}`)
  return body
}

describe('handleMetadataSave — collections', () => {
  test('creates the front-matter block on a bare file, card lines untouched', async () => {
    const { status, body } = await put({ labels: ['trade', 'sale'] })
    expect(status).toBe(200)
    expect(expectSuccess(body).frontMatter).toEqual({ labels: ['sale', 'trade'] })

    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = parseCollectionFile(content)
    expect(parsed.labels).toEqual(['sale', 'trade'])
    expect(parsed.warnings).toHaveLength(0)
    expect(content).toContain('- Sol Ring (C21:263) &1')
    expect(content).toContain('- Lightning Bolt (LEA:161) [keep] &2')
    // The canonical single blank line separates the block from the title.
    expect(content).toMatch(/^---\n[\s\S]*?---\n\n# Binder/)
  })

  test('null clears the labels and removes an otherwise-empty block', async () => {
    await put({ labels: ['keep'] })
    const { body } = await put({ labels: null })
    expect('labels' in expectSuccess(body).frontMatter).toBeFalse()

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content.startsWith('# Binder')).toBeTrue()
    expect(content).not.toContain('---')
  })

  test('an empty array clears exactly like null', async () => {
    await put({ labels: ['sale'] })
    await put({ labels: [] })
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content.startsWith('# Binder')).toBeTrue()
  })

  test('unknown keys a user hand-authored round-trip through a labels write', async () => {
    await fs.writeFile(filePath, '---\nowner: me\n---\n\n' + (await fs.readFile(filePath, 'utf-8')))
    const { body } = await put({ labels: ['sale'] })
    expect(expectSuccess(body).frontMatter).toMatchObject({ owner: 'me', labels: ['sale'] })

    // The response could lie; the file is the contract. Both keys must be on
    // disk, and the card lines must still parse cleanly around them.
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('owner: me')
    const parsed = parseCollectionFile(content)
    expect(parsed.labels).toEqual(['sale'])
    expect(parsed.entries).toHaveLength(2)
  })

  test('a keep conflict is a 400 and writes nothing', async () => {
    const before = await fs.readFile(filePath, 'utf-8')
    const { status } = await put({ labels: ['keep', 'sale'] })
    expect(status).toBe(400)
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })

  test('an unknown field is a 400 and writes nothing', async () => {
    const { status, body } = await put({ tags: ['x'] })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain("Unknown metadata field 'tags'")
  })

  test('writes a description beside the labels, card lines untouched', async () => {
    await put({ labels: ['sale'] })
    const { status, body } = await put({ description: '  Cards I am happy to move.  ' })
    expect(status).toBe(200)
    // Stored trimmed, and the labels written before it survive.
    expect(expectSuccess(body).frontMatter).toEqual({
      labels: ['sale'],
      description: 'Cards I am happy to move.',
    })

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('- Sol Ring (C21:263) &1')
    expect(parseCollectionFile(content).warnings).toHaveLength(0)
  })

  test('an empty description clears the key, exactly as null does', async () => {
    await put({ description: 'Temporary.' })
    const empty = await put({ description: '' })
    expect('description' in expectSuccess(empty.body).frontMatter).toBeFalse()
    expect((await fs.readFile(filePath, 'utf-8')).startsWith('# Binder')).toBeTrue()

    await put({ description: 'Back again.' })
    const nulled = await put({ description: null })
    expect('description' in expectSuccess(nulled.body).frontMatter).toBeFalse()
  })

  test('a non-string description is a 400 and writes nothing', async () => {
    const before = await fs.readFile(filePath, 'utf-8')
    const { status, body } = await put({ description: ['a'] })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('a list description must be text')
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })

  test('a stale contentHash is a 409', async () => {
    const hash = computeHash(await fs.readFile(filePath, 'utf-8'))
    await put({ labels: ['sale'] })
    const stale = await put({ labels: ['trade'], contentHash: hash })
    expect(stale.status).toBe(409)
    expect(parseCollectionFile(await fs.readFile(filePath, 'utf-8')).labels).toEqual(['sale'])
  })

  test('unreadable existing YAML refuses rather than clobbering it', async () => {
    await fs.writeFile(filePath, '---\nlabels: [sale\n---\n\n# Binder\n')
    const { status, body } = await put({ labels: ['trade'] })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('could not be read as YAML')
  })

  test('a metadata write records no changelog — the changelog is card-level', async () => {
    await put({ labels: ['sale'] })
    expect(await fs.exists(path.join(ws.dir, 'collections', 'binder.changes.md'))).toBeFalse()
  })

  test('an unrecorded hand edit keeps its stale sidecar', async () => {
    const sidecarPath = filePath + '.sha256'
    const staleHash = computeHash('something else entirely\n')
    await fs.writeFile(sidecarPath, staleHash + '\n')

    await put({ labels: ['sale'] })
    expect((await fs.readFile(sidecarPath, 'utf-8')).trim()).toBe(staleHash)
  })
})
