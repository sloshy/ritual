import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  handleListCreate,
  handleListRename,
  handleListDelete,
  type ListLifecycleConfig,
} from '../../src/admin/api/list-lifecycle'
import { resolveFlatListFile } from '../../src/admin/api/list-file'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'

/**
 * The create/rename/delete handlers write real files, so they belong here rather
 * than in the unit suite — and on a throwaway workspace rather than a fixed
 * directory under `test/`, which two suites running at once would share.
 *
 * Both flat list types run through here; the **deck** arm of the same fold
 * (`resolveDeckFile` instead of `resolveFlatListFile`, which is the only thing
 * the three list types differ by) is exercised in
 * `test/integration/deck-slug-decoding.test.ts`.
 */

let ws: BoundWorkspace
let collectionsDir: string
let wantedDir: string

const COLLECTION_CFG: ListLifecycleConfig = {
  kind: 'collection',
  getDir: () => collectionsDir,
  label: 'collection',
  resolveFile: resolveFlatListFile,
}

const WANTED_CFG: ListLifecycleConfig = {
  kind: 'wanted',
  getDir: () => wantedDir,
  label: 'wanted list',
  resolveFile: resolveFlatListFile,
}

type SuccessBody = {
  success: boolean
  message: string
  slug?: string
  newSlug?: string
  newFilePath?: string
  oldFilePath?: string
  deletedFiles?: string[]
}

function makeRequest(method: string, urlPath: string, body?: unknown): Request {
  const url = `http://localhost${urlPath}`
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  collectionsDir = path.join(ws.dir, 'collections')
  wantedDir = path.join(ws.dir, 'wanted')
  await fs.mkdir(collectionsDir, { recursive: true })
  await fs.mkdir(wantedDir, { recursive: true })
})

afterEach(async () => {
  await ws.dispose()
})

describe('list-lifecycle create handler', () => {
  test('creates a collection file with the H1 heading', async () => {
    const req = makeRequest('POST', '/api/collection/create', { name: 'My Collection' })
    const resp = await handleListCreate(req, COLLECTION_CFG)
    const data = (await resp.json()) as SuccessBody

    expect(resp.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.slug).toBe('My Collection')

    const content = await fs.readFile(path.join(collectionsDir, 'My Collection.md'), 'utf-8')
    expect(content).toBe('# My Collection\n\n')
  })

  test('creates a wanted list file with the H1 heading', async () => {
    const req = makeRequest('POST', '/api/wanted/create', { name: 'My Wanted' })
    const resp = await handleListCreate(req, WANTED_CFG)
    const data = (await resp.json()) as SuccessBody

    expect(data.success).toBe(true)
    expect(data.slug).toBe('My Wanted')

    const content = await fs.readFile(path.join(wantedDir, 'My Wanted.md'), 'utf-8')
    expect(content).toBe('# My Wanted\n\n')
  })

  test('returns 400 for missing name', async () => {
    const req = makeRequest('POST', '/api/collection/create', { name: '' })
    const resp = await handleListCreate(req, COLLECTION_CFG)
    const data = (await resp.json()) as SuccessBody

    expect(resp.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.message).toContain('name is required')
  })

  test('returns 409 when slug already exists', async () => {
    await Bun.write(path.join(collectionsDir, 'Existing.md'), '# Existing\n')

    const req = makeRequest('POST', '/api/collection/create', { name: 'Existing' })
    const resp = await handleListCreate(req, COLLECTION_CFG)
    const data = (await resp.json()) as SuccessBody

    expect(resp.status).toBe(409)
    expect(data.success).toBe(false)
    expect(data.message).toContain('already exists')
  })

  test('returns 409 for a name that only folds onto an existing list', async () => {
    await Bun.write(path.join(collectionsDir, 'Trade Binder.md'), '# Trade Binder\n')

    const req = makeRequest('POST', '/api/collection/create', { name: 'trade-binder' })
    const resp = await handleListCreate(req, COLLECTION_CFG)
    const data = (await resp.json()) as SuccessBody

    expect(resp.status).toBe(409)
    expect(data.message).toContain("A collection named 'Trade Binder' already exists")
    expect(await Bun.file(path.join(collectionsDir, 'trade-binder.md')).exists()).toBe(false)
  })

  test('strips reserved filesystem characters from the slug', async () => {
    const req = makeRequest('POST', '/api/collection/create', { name: 'Foo/Bar:Baz' })
    const resp = await handleListCreate(req, COLLECTION_CFG)
    const data = (await resp.json()) as SuccessBody

    expect(data.success).toBe(true)
    expect(data.slug).toBe('FooBarBaz')

    const exists = await Bun.file(path.join(collectionsDir, 'FooBarBaz.md')).exists()
    expect(exists).toBe(true)
  })
})

describe('list-lifecycle rename handler', () => {
  beforeEach(async () => {
    await Bun.write(path.join(collectionsDir, 'old-collection.md'), '# Old Collection\n\n')
  })

  test('renames file and rewrites the H1', async () => {
    const req = makeRequest('POST', '/api/collection/old-collection/rename', {
      newName: 'New Collection',
    })
    const resp = await handleListRename(req, COLLECTION_CFG)
    const data = (await resp.json()) as SuccessBody

    expect(resp.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.newSlug).toBe('New Collection')
    expect(data.oldFilePath).toBe(path.join(collectionsDir, 'old-collection.md'))
    expect(data.newFilePath).toBe(path.join(collectionsDir, 'New Collection.md'))

    const newExists = await Bun.file(path.join(collectionsDir, 'New Collection.md')).exists()
    expect(newExists).toBe(true)
    const oldExists = await Bun.file(path.join(collectionsDir, 'old-collection.md')).exists()
    expect(oldExists).toBe(false)

    const content = await fs.readFile(path.join(collectionsDir, 'New Collection.md'), 'utf-8')
    expect(content.startsWith('# New Collection\n')).toBe(true)
  })

  test('also moves the .changes.md sidecar', async () => {
    await Bun.write(
      path.join(collectionsDir, 'old-collection.changes.md'),
      '# Changelog\n\n- entry\n',
    )

    const req = makeRequest('POST', '/api/collection/old-collection/rename', {
      newName: 'New Collection',
    })
    await handleListRename(req, COLLECTION_CFG)

    const newSidecar = await Bun.file(
      path.join(collectionsDir, 'New Collection.changes.md'),
    ).exists()
    expect(newSidecar).toBe(true)
    const oldSidecar = await Bun.file(
      path.join(collectionsDir, 'old-collection.changes.md'),
    ).exists()
    expect(oldSidecar).toBe(false)
  })

  test('returns 404 when source does not exist', async () => {
    const req = makeRequest('POST', '/api/collection/missing/rename', { newName: 'Whatever' })
    const resp = await handleListRename(req, COLLECTION_CFG)
    expect(resp.status).toBe(404)
  })

  test('returns 409 when target slug already exists', async () => {
    await Bun.write(path.join(collectionsDir, 'taken.md'), '# Taken\n')

    const req = makeRequest('POST', '/api/collection/old-collection/rename', { newName: 'taken' })
    const resp = await handleListRename(req, COLLECTION_CFG)
    expect(resp.status).toBe(409)
  })

  test('preserves body content below the H1', async () => {
    await Bun.write(
      path.join(collectionsDir, 'old-collection.md'),
      '# Old Collection\n\n- Sol Ring (C19:221) &1\n- Lightning Bolt (LEA:161) &2\n',
    )

    const req = makeRequest('POST', '/api/collection/old-collection/rename', {
      newName: 'New Collection',
    })
    await handleListRename(req, COLLECTION_CFG)

    const content = await fs.readFile(path.join(collectionsDir, 'New Collection.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C19:221) &1')
    expect(content).toContain('- Lightning Bolt (LEA:161) &2')
    expect(content.startsWith('# New Collection\n')).toBe(true)
  })

  test('updates the H1 in place when slug does not change', async () => {
    // Slug stays 'old-collection' but title changes from 'Old Collection' to 'old-collection'
    const req = makeRequest('POST', '/api/collection/old-collection/rename', {
      newName: 'old-collection',
    })
    const resp = await handleListRename(req, COLLECTION_CFG)
    expect(resp.status).toBe(200)

    const filePath = path.join(collectionsDir, 'old-collection.md')
    const stillExists = await Bun.file(filePath).exists()
    expect(stillExists).toBe(true)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content.startsWith('# old-collection\n')).toBe(true)
  })
})

describe('list-lifecycle delete handler', () => {
  beforeEach(async () => {
    await Bun.write(path.join(collectionsDir, 'My Collection.md'), '# My Collection\n\n')
  })

  test('deletes the file when confirmation matches the H1', async () => {
    const req = makeRequest('DELETE', '/api/collection/My%20Collection', {
      confirmName: 'My Collection',
    })
    const resp = await handleListDelete(req, COLLECTION_CFG)
    const data = (await resp.json()) as SuccessBody

    expect(resp.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.deletedFiles).toEqual([path.join(collectionsDir, 'My Collection.md')])
    const exists = await Bun.file(path.join(collectionsDir, 'My Collection.md')).exists()
    expect(exists).toBe(false)
  })

  test('also deletes the changelog sidecar when present', async () => {
    await Bun.write(path.join(collectionsDir, 'My Collection.changes.md'), '# Changelog\n')

    const req = makeRequest('DELETE', '/api/collection/My%20Collection', {
      confirmName: 'My Collection',
    })
    await handleListDelete(req, COLLECTION_CFG)

    const exists = await Bun.file(path.join(collectionsDir, 'My Collection.changes.md')).exists()
    expect(exists).toBe(false)
  })

  test('returns 400 when confirmation does not match', async () => {
    const req = makeRequest('DELETE', '/api/collection/My%20Collection', {
      confirmName: 'Wrong Name',
    })
    const resp = await handleListDelete(req, COLLECTION_CFG)
    expect(resp.status).toBe(400)

    const exists = await Bun.file(path.join(collectionsDir, 'My Collection.md')).exists()
    expect(exists).toBe(true)
  })

  test('returns 404 when the file does not exist', async () => {
    const req = makeRequest('DELETE', '/api/collection/missing', { confirmName: 'missing' })
    const resp = await handleListDelete(req, COLLECTION_CFG)
    expect(resp.status).toBe(404)
  })
})
