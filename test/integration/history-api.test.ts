import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setBaseDir, getBaseDir } from '../../src/base-dir'
import { resetRitualConfigCache, getDefaultRitualConfig } from '../../src/ritual-config'
import {
  handleHistoryLists,
  handleHistoryLoad,
  handleHistorySave,
} from '../../src/admin/api/history'
import type { ChangeSet } from '../../src/changelog-blocks'

/**
 * End-to-end coverage for the admin change-history endpoints: enumerating lists,
 * loading parsed change sets (+ rewrite defaults), and saving back — verifying the
 * write lands only on the `.changes.md`, preserves the header, and is rejected on
 * malformed input.
 */

type ListsResponse = { success: true; lists: { type: string; slug: string; name: string }[] }
type LoadResponse = { success: true; header: string; sets: ChangeSet[]; defaultLines: string[] }
type SaveResponse = { success: boolean; message?: string; setCount?: number }

let tmpDir: string
let originalBase: string

const BINDER_MD = '# Binder\n\n- Sol Ring (C21:240) &1\n- Mana Crypt (2XM:270) &2\n'
const BINDER_CHANGES = [
  '# Changelog for Binder',
  '',
  '## 2026-01-01T00:00:00.000Z',
  '',
  '- Added "Sol Ring" (C21:240) &1',
  '',
  '## 2026-02-01T00:00:00.000Z',
  '',
  '- Added "Mana Crypt" &2',
  '',
].join('\n')

beforeEach(async () => {
  originalBase = getBaseDir()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'history-api-'))
  await fs.mkdir(path.join(tmpDir, 'decks'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'collections'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'wanted'), { recursive: true })
  setBaseDir(tmpDir)
  resetRitualConfigCache()
})

afterEach(async () => {
  setBaseDir(originalBase)
  resetRitualConfigCache()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeBinder(): Promise<void> {
  await fs.writeFile(path.join(tmpDir, 'collections', 'binder.md'), BINDER_MD)
  await fs.writeFile(path.join(tmpDir, 'collections', 'binder.changes.md'), BINDER_CHANGES)
}

async function load(type: string, slug: string): Promise<{ status: number; body: LoadResponse }> {
  const req = new Request(`http://localhost/api/history/${type}/${slug}`)
  const resp = await handleHistoryLoad(req)
  return { status: resp.status, body: (await resp.json()) as LoadResponse }
}

async function save(
  type: string,
  slug: string,
  sets: unknown,
): Promise<{ status: number; body: SaveResponse }> {
  const req = new Request(`http://localhost/api/history/${type}/${slug}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sets }),
  })
  const resp = await handleHistorySave(req)
  return { status: resp.status, body: (await resp.json()) as SaveResponse }
}

describe('history API', () => {
  test('lists every list across the three types', async () => {
    await writeBinder()
    await fs.writeFile(
      path.join(tmpDir, 'wanted', 'wishlist.md'),
      '# Wishlist\n\n- Mana Crypt &1\n',
    )

    const resp = await handleHistoryLists()
    const data = (await resp.json()) as ListsResponse
    expect(data.success).toBe(true)
    expect(data.lists.map((l) => `${l.type}:${l.slug}`).sort()).toEqual([
      'collection:binder',
      'wanted:wishlist',
    ])
  })

  test('loads change sets newest-first with rewrite defaults', async () => {
    await writeBinder()
    const { status, body } = await load('collection', 'binder')
    expect(status).toBe(200)
    expect(body.header).toBe('# Changelog for Binder')
    // Newest set first.
    expect(body.sets.map((s) => s.timestamp)).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ])
    // Defaults are regenerated from the list's current contents.
    expect(body.defaultLines.join('\n')).toContain('Sol Ring')
    expect(body.defaultLines.join('\n')).toContain('Mana Crypt')
  })

  test('returns 404 for a list that does not exist', async () => {
    const { status } = await load('collection', 'nope')
    expect(status).toBe(404)
  })

  test('saves change sets to the changelog without touching the list file', async () => {
    await writeBinder()
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-01T00:00:00.000Z', lines: ['- Added "Sol Ring" (C21:240) &1'] },
    ]
    const { status, body } = await save('collection', 'binder', sets)
    expect(status).toBe(200)
    expect(body.setCount).toBe(1)

    // The list file is untouched.
    expect(await fs.readFile(path.join(tmpDir, 'collections', 'binder.md'), 'utf-8')).toBe(
      BINDER_MD,
    )

    // The changelog now holds only the saved set, with the header preserved.
    const reloaded = await load('collection', 'binder')
    expect(reloaded.body.header).toBe('# Changelog for Binder')
    expect(reloaded.body.sets).toHaveLength(1)
    expect(reloaded.body.sets[0]!.timestamp).toBe('2026-03-01T00:00:00.000Z')
  })

  test('creates a changelog for a list that had none', async () => {
    await fs.writeFile(path.join(tmpDir, 'decks', 'mydeck.md'), '# My Deck\n\n1 Sol Ring &1\n')
    const sets: ChangeSet[] = [
      { timestamp: '2026-04-01T00:00:00.000Z', lines: ['- Added "Sol Ring" &1'] },
    ]
    const { status } = await save('deck', 'mydeck', sets)
    expect(status).toBe(200)

    const changes = await fs.readFile(path.join(tmpDir, 'decks', 'mydeck.changes.md'), 'utf-8')
    expect(changes).toContain('# Changelog for mydeck')
    expect(changes).toContain('## 2026-04-01T00:00:00.000Z')
  })

  test('rejects a non-array sets field', async () => {
    await writeBinder()
    const { status } = await save('collection', 'binder', { not: 'an array' })
    expect(status).toBe(400)
  })

  test('rejects a set with an invalid timestamp', async () => {
    await writeBinder()
    const { status } = await save('collection', 'binder', [
      { timestamp: 'not-a-date', lines: ['- Added "Sol Ring" &1'] },
    ])
    expect(status).toBe(400)
  })

  test('rejects a change line that is not a "- " entry', async () => {
    await writeBinder()
    const { status } = await save('collection', 'binder', [
      { timestamp: '2026-03-01T00:00:00.000Z', lines: ['Added Sol Ring'] },
    ])
    expect(status).toBe(400)
  })

  test('rejects a set with no change lines', async () => {
    await writeBinder()
    const { status } = await save('collection', 'binder', [
      { timestamp: '2026-03-01T00:00:00.000Z', lines: [] },
    ])
    expect(status).toBe(400)
  })

  test('rejects a set missing the lines field', async () => {
    await writeBinder()
    const { status } = await save('collection', 'binder', [
      { timestamp: '2026-03-01T00:00:00.000Z' },
    ])
    expect(status).toBe(400)
  })

  test('rejects an invalid list type in the path', async () => {
    const { status } = await load('bogus', 'binder')
    expect(status).toBe(400)
  })

  test('save returns 404 for a list that does not exist', async () => {
    const { status } = await save('collection', 'ghost', [
      { timestamp: '2026-03-01T00:00:00.000Z', lines: ['- Added "Sol Ring" &1'] },
    ])
    expect(status).toBe(404)
  })

  test('auto-commits only the changelog when git auto-commit is enabled', async () => {
    execSync('git init -q', { cwd: tmpDir })
    execSync('git config user.email test@example.com', { cwd: tmpDir })
    execSync('git config user.name "Ritual Test"', { cwd: tmpDir })
    await writeBinder()

    const base = getDefaultRitualConfig()
    await fs.writeFile(
      path.join(tmpDir, 'ritual.config.json'),
      JSON.stringify({
        decksDir: './decks',
        collectionsDir: './collections',
        wantedDir: './wanted',
        admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: false },
      }),
    )
    resetRitualConfigCache()

    const { status } = await save('collection', 'binder', [
      { timestamp: '2026-03-01T00:00:00.000Z', lines: ['- Added "Sol Ring" (C21:240) &1'] },
    ])
    expect(status).toBe(200)

    const subject = execSync('git log -1 --pretty=%s', { cwd: tmpDir, encoding: 'utf-8' }).trim()
    expect(subject).toBe('Rewrite change history for binder')

    const tracked = execSync('git ls-files', { cwd: tmpDir, encoding: 'utf-8' })
    expect(tracked).toContain('collections/binder.changes.md')
    expect(tracked).not.toContain('collections/binder.md')
  })
})
