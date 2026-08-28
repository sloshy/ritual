import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { resetRitualConfigCache, getDefaultRitualConfig } from '../../src/config/ritual-config'
import { handleHistoryLoad, handleHistorySave } from '../../src/admin/api/history'
import type { ChangeSet } from '../../src/changes/changelog-blocks'
import {
  bindWorkspace,
  collectionMarkdown,
  initGitRepo,
  writeConfig,
  writeDeckFile,
  type BoundWorkspace,
} from '../helpers/workspace'

/**
 * End-to-end coverage for the admin change-history endpoints: loading parsed
 * change sets (+ rewrite defaults) and saving back — verifying the write lands
 * only on the `.changes.md`, preserves the header, and is rejected on malformed
 * input. (List enumeration lives on GET /api/lists, covered elsewhere.)
 */

type LoadResponse = { success: true; header: string; sets: ChangeSet[]; defaultLines: string[] }
type SaveResponse = { success: boolean; message?: string; setCount?: number }
type InvalidSetsCase = { description: string; sets: unknown }

let ws: BoundWorkspace
let tmpDir: string

const BINDER_MD = collectionMarkdown({
  title: 'Binder',
  entries: [
    { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
    { name: 'Mana Crypt', set: '2xm', collectorNumber: '270', cardId: 2 },
  ],
})
// The changelog format itself is the input under test, so it stays literal.
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
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
})

afterEach(async () => {
  await ws.dispose()
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

  test('hand-written prose loads as trailing and survives a save round trip', async () => {
    await writeBinder()
    const withProse = BINDER_CHANGES.replace(
      '- Added "Sol Ring" (C21:240) &1',
      '- Added "Sol Ring" (C21:240) &1\n\nNOTE: FNM tuning session.',
    )
    await fs.writeFile(path.join(tmpDir, 'collections', 'binder.changes.md'), withProse)

    const loaded = await load('collection', 'binder')
    // Newest-first: the prose-bearing 2026-01 set is second.
    expect(loaded.body.sets[1]!.trailing).toEqual(['NOTE: FNM tuning session.'])

    const { status } = await save('collection', 'binder', loaded.body.sets)
    expect(status).toBe(200)
    const written = await fs.readFile(
      path.join(tmpDir, 'collections', 'binder.changes.md'),
      'utf-8',
    )
    expect(written).toContain('NOTE: FNM tuning session.')
    const reloaded = await load('collection', 'binder')
    expect(reloaded.body.sets[1]!.trailing).toEqual(['NOTE: FNM tuning session.'])
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
    await writeDeckFile(tmpDir, 'mydeck', {
      frontMatter: { name: 'My Deck' },
      cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
    })
    const sets: ChangeSet[] = [
      { timestamp: '2026-04-01T00:00:00.000Z', lines: ['- Added "Sol Ring" &1'] },
    ]
    const { status } = await save('deck', 'mydeck', sets)
    expect(status).toBe(200)

    const changes = await fs.readFile(path.join(tmpDir, 'decks', 'mydeck.changes.md'), 'utf-8')
    expect(changes).toContain('# Changelog for mydeck')
    expect(changes).toContain('## 2026-04-01T00:00:00.000Z')
  })

  const invalidSetsCases: InvalidSetsCase[] = [
    { description: 'a non-array sets field', sets: { not: 'an array' } },
    {
      description: 'a set with an invalid timestamp',
      sets: [{ timestamp: 'not-a-date', lines: ['- Added "Sol Ring" &1'] }],
    },
    {
      description: 'a change line that is not a "- " entry',
      sets: [{ timestamp: '2026-03-01T00:00:00.000Z', lines: ['Added Sol Ring'] }],
    },
    {
      description: 'a set with no change lines',
      sets: [{ timestamp: '2026-03-01T00:00:00.000Z', lines: [] }],
    },
    {
      description: 'a set missing the lines field',
      sets: [{ timestamp: '2026-03-01T00:00:00.000Z' }],
    },
    {
      description: 'a trailing field that is not an array of strings',
      sets: [{ timestamp: '2026-03-01T00:00:00.000Z', lines: ['- Added "X" &1'], trailing: [42] }],
    },
    {
      description: 'a trailing line that looks like a change line',
      sets: [
        {
          timestamp: '2026-03-01T00:00:00.000Z',
          lines: ['- Added "X" &1'],
          trailing: ['- Removed "X" &1'],
        },
      ],
    },
    {
      description: 'a trailing line with an embedded newline (a smuggled set header)',
      sets: [
        {
          timestamp: '2026-03-01T00:00:00.000Z',
          lines: ['- Added "X" &1'],
          trailing: ['note\n## 2026-04-01T00:00:00.000Z'],
        },
      ],
    },
  ]

  for (const { description, sets } of invalidSetsCases) {
    test(`rejects ${description}`, async () => {
      await writeBinder()
      const { status } = await save('collection', 'binder', sets)
      expect(status).toBe(400)
    })
  }

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
    initGitRepo(tmpDir)
    await writeBinder()

    const base = getDefaultRitualConfig()
    await writeConfig(tmpDir, {
      admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: false },
    })
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
