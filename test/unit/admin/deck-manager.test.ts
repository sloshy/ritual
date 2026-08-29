import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleDeckCreate } from '../../../src/admin/api/deck-create'
import {
  handleListDelete,
  handleListRename,
  type ListLifecycleConfig,
} from '../../../src/admin/api/list-lifecycle'
import { resolveDeckFile } from '../../../src/admin/api/list-file'
import { parseDeckFrontMatter, type DeckFrontMatter } from '../../../src/list/deck-file'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'

let ws: BoundWorkspace
let decksDir: string

const DECK_CFG: ListLifecycleConfig = {
  kind: 'deck',
  getDir: () => decksDir,
  label: 'deck',
  resolveFile: resolveDeckFile,
}

function makeRequest(method: string, urlPath: string, body?: unknown): Request {
  const url = `http://localhost${urlPath}`
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

type CreatedDeck = { frontMatter: DeckFrontMatter; content: string }

async function readCreatedDeck(slug: string): Promise<CreatedDeck> {
  const filePath = path.join(decksDir, `${slug}.md`)
  return {
    frontMatter: await parseDeckFrontMatter(filePath),
    content: await fs.readFile(filePath, 'utf-8'),
  }
}

describe('deck-create handler', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: ['decks'], config: false })
    decksDir = path.join(ws.dir, 'decks')
  })

  afterEach(async () => {
    await ws.dispose()
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
    expect(data.slug).toBe('My Test Deck')

    const { frontMatter, content } = await readCreatedDeck('My Test Deck')
    expect(frontMatter.format).toBe('commander')
    expect(content).toContain('# My Test Deck\n\n## Main')
  })

  test('generates slug from name with special characters', async () => {
    const req = makeRequest('POST', '/api/deck/create', { name: "Atraxa: Praetors' Voice!" })
    const resp = await handleDeckCreate(req)
    const data = (await resp.json()) as { success: boolean; slug: string }

    expect(data.success).toBe(true)
    expect(data.slug).toBe("Atraxa Praetors' Voice!")
  })

  test('defaults format to commander', async () => {
    const req = makeRequest('POST', '/api/deck/create', { name: 'No Format Deck' })
    const resp = await handleDeckCreate(req)
    const data = (await resp.json()) as { success: boolean }

    expect(data.success).toBe(true)
    const { frontMatter } = await readCreatedDeck('No Format Deck')
    expect(frontMatter.format).toBe('commander')
  })

  test('normalizes a non-canonical format spelling', async () => {
    const req = makeRequest('POST', '/api/deck/create', { name: 'EDH Deck', format: 'EDH' })
    const resp = await handleDeckCreate(req)

    expect(resp.status).toBe(200)
    const { frontMatter } = await readCreatedDeck('EDH Deck')
    expect(frontMatter.format).toBe('commander')
  })

  test('returns 400 for an unknown format', async () => {
    const req = makeRequest('POST', '/api/deck/create', { name: 'Cube Deck', format: 'cube' })
    const resp = await handleDeckCreate(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.message).toContain("Invalid deck format 'cube'")
    expect(await fs.exists(path.join(decksDir, 'Cube Deck.md'))).toBe(false)
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
    await Bun.write(path.join(decksDir, 'My Deck.md'), '# My Deck')
    const req = makeRequest('POST', '/api/deck/create', { name: 'My Deck' })
    const resp = await handleDeckCreate(req)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(409)
    expect(data.success).toBe(false)
    expect(data.message).toContain('already exists')
  })
})

describe('deck-rename handler', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: ['decks'], config: false })
    decksDir = path.join(ws.dir, 'decks')

    // Create a test deck
    await Bun.write(
      path.join(decksDir, 'old-deck.md'),
      `---\nformat: "commander"\ntags: []\n---\n\n# Old Deck\n`,
    )
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('renames deck file and updates frontmatter', async () => {
    const req = makeRequest('POST', '/api/deck/old-deck/rename', { newName: 'New Deck Name' })
    const resp = await handleListRename(req, DECK_CFG)
    const data = (await resp.json()) as { success: boolean; newSlug: string }

    expect(resp.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.newSlug).toBe('New Deck Name')

    const newFileExists = await Bun.file(path.join(decksDir, 'New Deck Name.md')).exists()
    expect(newFileExists).toBe(true)

    const oldFileExists = await Bun.file(path.join(decksDir, 'old-deck.md')).exists()
    expect(oldFileExists).toBe(false)

    const content = await fs.readFile(path.join(decksDir, 'New Deck Name.md'), 'utf-8')
    expect(content).toContain('# New Deck Name')
    expect(content).not.toContain('name:')
  })

  test('also renames changelog when it exists', async () => {
    await Bun.write(path.join(decksDir, 'old-deck.changes.md'), '# Changelog for Old Deck\n')

    const req = makeRequest('POST', '/api/deck/old-deck/rename', { newName: 'New Deck Name' })
    await handleListRename(req, DECK_CFG)

    const newChangelog = await Bun.file(path.join(decksDir, 'New Deck Name.changes.md')).exists()
    expect(newChangelog).toBe(true)

    const oldChangelog = await Bun.file(path.join(decksDir, 'old-deck.changes.md')).exists()
    expect(oldChangelog).toBe(false)
  })

  test('returns 404 when deck does not exist', async () => {
    const req = makeRequest('POST', '/api/deck/nonexistent/rename', { newName: 'Whatever' })
    const resp = await handleListRename(req, DECK_CFG)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(404)
    expect(data.success).toBe(false)
  })

  test('returns 400 for missing new name', async () => {
    const req = makeRequest('POST', '/api/deck/old-deck/rename', { newName: '' })
    const resp = await handleListRename(req, DECK_CFG)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(400)
    expect(data.success).toBe(false)
  })

  test('returns 409 when target slug already exists', async () => {
    await Bun.write(path.join(decksDir, 'Existing Deck.md'), '# Existing\n')

    const req = makeRequest('POST', '/api/deck/old-deck/rename', { newName: 'Existing Deck' })
    const resp = await handleListRename(req, DECK_CFG)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(409)
    expect(data.success).toBe(false)
  })
})

describe('deck-delete handler', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: ['decks'], config: false })
    decksDir = path.join(ws.dir, 'decks')

    await Bun.write(
      path.join(decksDir, 'test-deck.md'),
      `---\nformat: "commander"\ntags: []\n---\n\n# Test Deck\n`,
    )
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('deletes deck file when confirmation matches', async () => {
    const req = makeRequest('DELETE', '/api/deck/test-deck', { confirmName: 'Test Deck' })
    const resp = await handleListDelete(req, DECK_CFG)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(200)
    expect(data.success).toBe(true)

    const exists = await Bun.file(path.join(decksDir, 'test-deck.md')).exists()
    expect(exists).toBe(false)
  })

  test('also deletes changelog when it exists', async () => {
    await Bun.write(path.join(decksDir, 'test-deck.changes.md'), '# Changelog\n')

    const req = makeRequest('DELETE', '/api/deck/test-deck', { confirmName: 'Test Deck' })
    await handleListDelete(req, DECK_CFG)

    const exists = await Bun.file(path.join(decksDir, 'test-deck.changes.md')).exists()
    expect(exists).toBe(false)
  })

  test('returns 400 when confirmation does not match', async () => {
    const req = makeRequest('DELETE', '/api/deck/test-deck', { confirmName: 'Wrong Name' })
    const resp = await handleListDelete(req, DECK_CFG)
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
    const resp = await handleListDelete(req, DECK_CFG)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(404)
    expect(data.success).toBe(false)
  })

  test('returns 400 when confirmName is missing', async () => {
    const req = makeRequest('DELETE', '/api/deck/test-deck', {})
    const resp = await handleListDelete(req, DECK_CFG)
    const data = (await resp.json()) as { success: boolean; message: string }

    expect(resp.status).toBe(400)
    expect(data.success).toBe(false)
  })
})
