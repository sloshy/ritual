import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleDeckCreate } from '../../../src/admin/api/deck-create'
import { handleDeckRename } from '../../../src/admin/api/deck-rename'
import { handleDeckDelete } from '../../../src/admin/api/deck-delete'
import { setBaseDir } from '../../../src/base-dir'

const testDir = path.join(import.meta.dir, '../../.test-deck-manager')
const decksDir = path.join(testDir, 'decks')

function makeRequest(method: string, urlPath: string, body?: unknown): Request {
  const url = `http://localhost${urlPath}`
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('deck-create handler', () => {
  const originalCwd = process.cwd()

  beforeEach(async () => {
    await fs.mkdir(decksDir, { recursive: true })
    setBaseDir(testDir)
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
    await fs.rm(testDir, { recursive: true, force: true })
  })

  test('creates a deck file with correct slug', async () => {
    const req = makeRequest('POST', '/api/deck/create', {
      name: 'My Test Deck',
      format: 'commander',
    })
    const resp = await handleDeckCreate(req)
    const data = (await resp.json()) as { success: boolean; slug: string; message: string }

    expect(resp.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.slug).toBe('my-test-deck')

    const fileContent = await fs.readFile(path.join(decksDir, 'my-test-deck.md'), 'utf-8')
    expect(fileContent).toContain('name: "My Test Deck"')
    expect(fileContent).toContain('format: "commander"')
    expect(fileContent).toContain('# My Test Deck')
  })

  test('generates slug from name with special characters', async () => {
    const req = makeRequest('POST', '/api/deck/create', { name: "Atraxa: Praetors' Voice!" })
    const resp = await handleDeckCreate(req)
    const data = (await resp.json()) as { success: boolean; slug: string }

    expect(data.success).toBe(true)
    expect(data.slug).toBe('atraxa-praetors-voice')
  })

  test('defaults format to commander', async () => {
    const req = makeRequest('POST', '/api/deck/create', { name: 'No Format Deck' })
    const resp = await handleDeckCreate(req)
    const data = (await resp.json()) as { success: boolean }

    expect(data.success).toBe(true)
    const fileContent = await fs.readFile(path.join(decksDir, 'no-format-deck.md'), 'utf-8')
    expect(fileContent).toContain('format: "commander"')
  })

  test('returns 400 for missing name', async () => {
    const req = makeRequest('POST', '/api/deck/create', { name: '' })
    const resp = await handleDeckCreate(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.message).toContain('name is required')
  })

  test('returns 409 when deck with same slug already exists', async () => {
    await Bun.write(path.join(decksDir, 'my-deck.md'), '# My Deck')
    const req = makeRequest('POST', '/api/deck/create', { name: 'My Deck' })
    const resp = await handleDeckCreate(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(409)
    expect(data.success).toBe(false)
    expect(data.message).toContain('already exists')
  })
})

describe('deck-rename handler', () => {
  const originalCwd = process.cwd()

  beforeEach(async () => {
    await fs.mkdir(decksDir, { recursive: true })
    setBaseDir(testDir)

    // Create a test deck
    await Bun.write(
      path.join(decksDir, 'old-deck.md'),
      `---\nname: "Old Deck"\nformat: "commander"\ncreated: "2024-01-01T00:00:00.000Z"\ntags: []\n---\n\n# Old Deck\n`,
    )
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
    await fs.rm(testDir, { recursive: true, force: true })
  })

  test('renames deck file and updates frontmatter', async () => {
    const req = makeRequest('POST', '/api/deck/old-deck/rename', { newName: 'New Deck Name' })
    const resp = await handleDeckRename(req)
    const data = (await resp.json()) as { success: boolean; newSlug: string }

    expect(resp.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.newSlug).toBe('new-deck-name')

    const newFileExists = await Bun.file(path.join(decksDir, 'new-deck-name.md')).exists()
    expect(newFileExists).toBe(true)

    const oldFileExists = await Bun.file(path.join(decksDir, 'old-deck.md')).exists()
    expect(oldFileExists).toBe(false)

    const content = await fs.readFile(path.join(decksDir, 'new-deck-name.md'), 'utf-8')
    expect(content).toContain('name: "New Deck Name"')
  })

  test('also renames changelog when it exists', async () => {
    await Bun.write(path.join(decksDir, 'old-deck.changes.md'), '# Changelog for Old Deck\n')

    const req = makeRequest('POST', '/api/deck/old-deck/rename', { newName: 'New Deck Name' })
    await handleDeckRename(req)

    const newChangelog = await Bun.file(path.join(decksDir, 'new-deck-name.changes.md')).exists()
    expect(newChangelog).toBe(true)

    const oldChangelog = await Bun.file(path.join(decksDir, 'old-deck.changes.md')).exists()
    expect(oldChangelog).toBe(false)
  })

  test('returns 404 when deck does not exist', async () => {
    const req = makeRequest('POST', '/api/deck/nonexistent/rename', { newName: 'Whatever' })
    const resp = await handleDeckRename(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(404)
    expect(data.success).toBe(false)
  })

  test('returns 400 for missing new name', async () => {
    const req = makeRequest('POST', '/api/deck/old-deck/rename', { newName: '' })
    const resp = await handleDeckRename(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(400)
    expect(data.success).toBe(false)
  })

  test('returns 409 when target slug already exists', async () => {
    await Bun.write(path.join(decksDir, 'existing-deck.md'), '# Existing\n')

    const req = makeRequest('POST', '/api/deck/old-deck/rename', { newName: 'Existing Deck' })
    const resp = await handleDeckRename(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(409)
    expect(data.success).toBe(false)
  })
})

describe('deck-delete handler', () => {
  const originalCwd = process.cwd()

  beforeEach(async () => {
    await fs.mkdir(decksDir, { recursive: true })
    setBaseDir(testDir)

    await Bun.write(
      path.join(decksDir, 'test-deck.md'),
      `---\nname: "Test Deck"\nformat: "commander"\ncreated: "2024-01-01T00:00:00.000Z"\ntags: []\n---\n\n# Test Deck\n`,
    )
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
    await fs.rm(testDir, { recursive: true, force: true })
  })

  test('deletes deck file when confirmation matches', async () => {
    const req = makeRequest('DELETE', '/api/deck/test-deck', { confirmName: 'Test Deck' })
    const resp = await handleDeckDelete(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(200)
    expect(data.success).toBe(true)

    const exists = await Bun.file(path.join(decksDir, 'test-deck.md')).exists()
    expect(exists).toBe(false)
  })

  test('also deletes changelog when it exists', async () => {
    await Bun.write(path.join(decksDir, 'test-deck.changes.md'), '# Changelog\n')

    const req = makeRequest('DELETE', '/api/deck/test-deck', { confirmName: 'Test Deck' })
    await handleDeckDelete(req)

    const exists = await Bun.file(path.join(decksDir, 'test-deck.changes.md')).exists()
    expect(exists).toBe(false)
  })

  test('returns 400 when confirmation does not match', async () => {
    const req = makeRequest('DELETE', '/api/deck/test-deck', { confirmName: 'Wrong Name' })
    const resp = await handleDeckDelete(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.message).toContain('does not match')

    // File should still exist
    const exists = await Bun.file(path.join(decksDir, 'test-deck.md')).exists()
    expect(exists).toBe(true)
  })

  test('returns 404 when deck does not exist', async () => {
    const req = makeRequest('DELETE', '/api/deck/nonexistent', { confirmName: 'Nonexistent' })
    const resp = await handleDeckDelete(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(404)
    expect(data.success).toBe(false)
  })

  test('returns 400 when confirmName is missing', async () => {
    const req = makeRequest('DELETE', '/api/deck/test-deck', {})
    const resp = await handleDeckDelete(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(400)
    expect(data.success).toBe(false)
  })
})
