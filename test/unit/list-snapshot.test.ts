import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildDefaultChangeLines,
  loadListSnapshot,
  type ListSnapshot,
} from '../../src/changes/list-snapshot'
import { buildMainChoices, type EditorState } from '../../src/commands/history'

describe('buildDefaultChangeLines', () => {
  it('renders foil/condition annotations on add lines', () => {
    const snapshot: ListSnapshot = {
      sectionOrder: ['Main'],
      entries: [
        {
          name: 'Mana Crypt',
          set: '2xm',
          collectorNumber: '1',
          finish: 'foil',
          condition: 'LP',
          cardId: 5,
          section: 'Main',
          quantity: 1,
          isCommander: false,
        },
      ],
    }

    expect(buildDefaultChangeLines(snapshot)).toEqual([
      '- Added "Mana Crypt" (2XM:1) [foil] [LP] &5',
    ])
  })

  it('returns no lines for an empty list', () => {
    expect(buildDefaultChangeLines({ sectionOrder: ['Main'], entries: [] })).toEqual([])
  })

  it('treats a "## Commanders" heading as the command zone, like the parser does', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'list-snapshot-'))
    try {
      const file = path.join(dir, 'test.md')
      await fs.writeFile(
        file,
        '# Test\n\n## Commanders\n\n1 Atraxa &1\n\n## Main\n\n1 Sol Ring &2\n',
      )
      const snapshot = await loadListSnapshot('deck', file)
      expect(snapshot.entries.map((e) => [e.name, e.isCommander])).toEqual([
        ['Atraxa', true],
        ['Sol Ring', false],
      ])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('buildMainChoices', () => {
  const state = (undoDepth: number): EditorState => ({
    header: '# Changes\n',
    sets: [
      { timestamp: '2026-07-13T10:00:00.000Z', lines: ['- Added Sol Ring &1'] },
      { timestamp: '2026-07-12T10:00:00.000Z', lines: ['- Added Mox Ruby &2'] },
    ],
    originalSerialized: '',
    undoStack: Array.from({ length: undoDepth }, () => []),
  })

  it('lists the change sets, then undo, preview, and only then the destructive rewrite', () => {
    const values = buildMainChoices(state(2)).map((c) => c.value)
    expect(values).toEqual(['set:0', 'set:1', '__undo__', '__preview__', '__rewrite__', '__exit__'])
  })

  it('drops undo when nothing has been done, keeping rewrite below preview', () => {
    const values = buildMainChoices(state(0)).map((c) => c.value)
    expect(values).toEqual(['set:0', 'set:1', '__preview__', '__rewrite__', '__exit__'])
  })
})
