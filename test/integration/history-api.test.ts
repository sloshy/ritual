import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { resetRitualConfigCache, getDefaultRitualConfig } from '../../src/config/ritual-config'
import { handleHistoryLoad, handleHistorySave } from '../../src/admin/api/history'
import { changeSetFromEvents, type ChangeSet } from '../../src/changes/changelog-blocks'
import {
  createAddChange,
  createSetLabelChange,
  type ChangeEvent,
} from '../../src/changes/change-event'
import {
  bindWorkspace,
  collectionMarkdown,
  initGitRepo,
  writeConfig,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'

/**
 * End-to-end coverage for the admin change-history endpoints: loading parsed
 * change sets (+ rewrite defaults) and saving back — verifying the write lands
 * only on the `.changes.md`, preserves the header, and is rejected on malformed
 * input. (List enumeration lives on GET /api/lists, covered elsewhere.)
 */

type LoadResponse = {
  success: true
  header: string
  sets: ChangeSet[]
  defaultEvents: ChangeEvent[]
  categoryWarnings?: string[]
}
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
    // Defaults are regenerated from the list's current contents, as typed events.
    expect(body.defaultEvents.map((e) => ('cardName' in e ? e.cardName : ''))).toEqual([
      'Sol Ring',
      'Mana Crypt',
    ])
    expect(body.defaultEvents[0]).toMatchObject({ action: 'add', set: 'c21', cardId: 1 })
  })

  test('the rewrite defaults describe the categories sidecar too', async () => {
    await writeBinder()
    await fs.writeFile(
      path.join(tmpDir, 'collections', 'binder.categories.json'),
      JSON.stringify({ order: ['Ramp'], cards: { 'Sol Ring': ['Ramp'] } }),
    )

    const { body } = await load('collection', 'binder')
    // The caller loads the sidecar and passes it; forgetting to would silently
    // drop every category from a rebuilt history.
    expect(body.defaultEvents.map((e) => e.action)).toContain('set-category-order')
    const categories = body.defaultEvents.find((e) => e.action === 'set-categories')
    expect(categories).toMatchObject({ cardName: 'Sol Ring', categories: ['Ramp'] })
    expect(Object.keys(body)).not.toContain('categoryWarnings')
  })

  test('an unreadable categories sidecar warns instead of failing the rebuild', async () => {
    await writeBinder()
    await fs.writeFile(path.join(tmpDir, 'collections', 'binder.categories.json'), '{ nope')

    const { status, body } = await load('collection', 'binder')
    expect(status).toBe(200)
    expect(body.defaultEvents.map((e) => e.action)).not.toContain('set-categories')
    expect(body.categoryWarnings?.join(' ')).toContain('binder.categories.json')
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

  test('a legacy (block-less) set loads with no events and echoes back verbatim', async () => {
    await writeBinder()
    const loaded = await load('collection', 'binder')
    expect(loaded.body.sets.map((s) => s.events)).toEqual([[], []])

    const { status } = await save('collection', 'binder', loaded.body.sets)
    expect(status).toBe(200)
    expect(await fs.readFile(path.join(tmpDir, 'collections', 'binder.changes.md'), 'utf-8')).toBe(
      BINDER_CHANGES,
    )
  })

  test('saves change sets to the changelog without touching the list file', async () => {
    await writeBinder()
    const sets: ChangeSet[] = [
      changeSetFromEvents('2026-03-01T00:00:00.000Z', [
        createAddChange('Sol Ring', { set: 'c21', collectorNumber: '240', cardId: 1 }),
      ]),
    ]
    const { status, body } = await save('collection', 'binder', sets)
    expect(status).toBe(200)
    expect(body.setCount).toBe(1)

    // The saved entry carries its prose and its events block.
    const written = await fs.readFile(
      path.join(tmpDir, 'collections', 'binder.changes.md'),
      'utf-8',
    )
    expect(written).toContain('- Added "Sol Ring" (C21:240) &1\n\n```ritual-changes\n')
    expect(written).toContain(
      '{"action":"add","cardName":"Sol Ring","cardId":1,"set":"c21","collectorNumber":"240"}',
    )

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
      name: 'My Deck',
      cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
    })
    const sets: ChangeSet[] = [
      changeSetFromEvents('2026-04-01T00:00:00.000Z', [createAddChange('Sol Ring', { cardId: 1 })]),
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
      sets: [{ timestamp: 'not-a-date', lines: ['- Added "Sol Ring" &1'], events: [] }],
    },
    {
      description: 'a change line that is not a "- " entry',
      sets: [{ timestamp: '2026-03-01T00:00:00.000Z', lines: ['Added Sol Ring'], events: [] }],
    },
    {
      description: 'a set with no change lines',
      sets: [{ timestamp: '2026-03-01T00:00:00.000Z', lines: [], events: [] }],
    },
    {
      description: 'a set missing the lines field',
      sets: [{ timestamp: '2026-03-01T00:00:00.000Z', events: [] }],
    },
    {
      description: 'a set missing the events field',
      sets: [{ timestamp: '2026-03-01T00:00:00.000Z', lines: ['- Added "X" &1'] }],
    },
    {
      description: 'an event the decoder refuses',
      sets: [
        {
          timestamp: '2026-03-01T00:00:00.000Z',
          lines: ['- Added "X" &1'],
          events: [{ id: 'x', timestamp: 0, action: 'add', cardName: 'X', finish: 'shiny' }],
        },
      ],
    },
    {
      description: 'a label outside the vocabulary',
      sets: [
        {
          timestamp: '2026-03-01T00:00:00.000Z',
          lines: ['- Added "X" &1'],
          events: [{ id: 'x', timestamp: 0, action: 'add', cardName: 'X', labels: ['shiny'] }],
        },
      ],
    },
    {
      description: 'more change lines than events',
      sets: [
        {
          timestamp: '2026-03-01T00:00:00.000Z',
          lines: ['- Added "X" &1', '- Added "Y" &2'],
          events: [{ id: 'x', timestamp: 0, action: 'add', cardName: 'X', cardId: 1 }],
        },
      ],
    },
    {
      description: 'a trailing field that is not an array of strings',
      sets: [
        {
          timestamp: '2026-03-01T00:00:00.000Z',
          lines: ['- Added "X" &1'],
          events: [],
          trailing: [42],
        },
      ],
    },
    {
      description: 'a trailing line that looks like a change line',
      sets: [
        {
          timestamp: '2026-03-01T00:00:00.000Z',
          lines: ['- Added "X" &1'],
          events: [],
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
          events: [],
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

  // The save route passes the list type from the path into the decoder; the
  // label-vs-list-type semantics themselves are pinned in the bundle unit tests.
  test('rejects a label the list type does not support', async () => {
    await writeDeckFile(tmpDir, 'mydeck', {
      name: 'My Deck',
      cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
    })
    const deckSets: ChangeSet[] = [
      changeSetFromEvents('2026-04-01T00:00:00.000Z', [
        createSetLabelChange('Sol Ring', { labels: ['sale'], cardId: 1 }),
      ]),
    ]
    expect((await save('deck', 'mydeck', deckSets)).status).toBe(400)

    await writeWantedFile(tmpDir, 'wants', { entries: [{ name: 'Sol Ring' }] })
    const wantedSets: ChangeSet[] = [
      changeSetFromEvents('2026-04-01T00:00:00.000Z', [
        createSetLabelChange('Sol Ring', { labels: ['proxy'], cardId: 1 }),
      ]),
    ]
    expect((await save('wanted', 'wants', wantedSets)).status).toBe(400)
  })

  test('accepts a change-looking line inside a fenced trailing block, but not an unclosed fence', async () => {
    await writeBinder()
    const fenced = {
      timestamp: '2026-03-01T00:00:00.000Z',
      lines: ['- Added "X" &1'],
      events: [],
      trailing: ['Example:', '```text', '- Removed "X" &1', '## not a header', '```'],
    }
    expect((await save('collection', 'binder', [fenced])).status).toBe(200)
    const reloaded = await load('collection', 'binder')
    expect(reloaded.body.sets[0]!.trailing).toEqual(fenced.trailing)

    const unclosed = { ...fenced, trailing: ['```text', '- Removed "X" &1'] }
    expect((await save('collection', 'binder', [unclosed])).status).toBe(400)
  })

  test('rejects an invalid list type in the path', async () => {
    const { status } = await load('bogus', 'binder')
    expect(status).toBe(400)
  })

  test('save returns 404 for a list that does not exist', async () => {
    const { status } = await save('collection', 'ghost', [
      { timestamp: '2026-03-01T00:00:00.000Z', lines: ['- Added "Sol Ring" &1'], events: [] },
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
      changeSetFromEvents('2026-03-01T00:00:00.000Z', [
        createAddChange('Sol Ring', { set: 'c21', collectorNumber: '240', cardId: 1 }),
      ]),
    ])
    expect(status).toBe(200)

    const subject = execSync('git log -1 --pretty=%s', { cwd: tmpDir, encoding: 'utf-8' }).trim()
    expect(subject).toBe('Rewrite change history for binder')

    const tracked = execSync('git ls-files', { cwd: tmpDir, encoding: 'utf-8' })
    expect(tracked).toContain('collections/binder.changes.md')
    expect(tracked).not.toContain('collections/binder.md')
  })
})
