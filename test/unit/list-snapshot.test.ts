import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  buildDefaultChangeLines,
  loadListSnapshot,
  type ListSnapshot,
} from '../../src/changes/list-snapshot'
import { withWorkspace } from '../helpers/workspace'

/**
 * Write `content` to a list file in a throwaway workspace and hand the path to
 * `run`. These cases exercise `loadListSnapshot`, which only takes a path, so
 * they do real filesystem I/O despite living in the unit suite.
 */
async function withSnapshotFile(content: string, run: (file: string) => Promise<void>) {
  await withWorkspace(
    async (dir) => {
      const file = path.join(dir, 'test.md')
      await fs.writeFile(file, content)
      await run(file)
    },
    { dirs: [], config: false },
  )
}

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

  it('emits add-section, per-copy adds, commander, note, labels and section lines in order', () => {
    const snapshot: ListSnapshot = {
      sectionOrder: ['Main', 'Commanders', 'Sideboard'],
      entries: [
        {
          name: "Atraxa, Praetors' Voice",
          set: 'cmr',
          collectorNumber: '3',
          cardId: 1,
          section: 'Commanders',
          quantity: 1,
          isCommander: true,
          note: 'signed',
          labels: ['proxy'],
        },
        { name: 'Sol Ring', cardId: 2, section: 'Sideboard', quantity: 2, isCommander: false },
      ],
    }

    expect(buildDefaultChangeLines(snapshot)).toEqual([
      '- Added section "Commanders"',
      '- Added section "Sideboard"',
      '- Added "Atraxa, Praetors\' Voice" (CMR:3) &1',
      '- Set "Atraxa, Praetors\' Voice" as commander &1',
      '- Set note on "Atraxa, Praetors\' Voice" &1 to "signed"',
      '- Set labels on "Atraxa, Praetors\' Voice" &1 to [proxy]',
      '- Moved "Atraxa, Praetors\' Voice" to section "Commanders" &1',
      '- Added "Sol Ring" &2',
      '- Added "Sol Ring" &2',
      '- Moved "Sol Ring" to section "Sideboard" &2',
    ])
  })
})

describe('loadListSnapshot', () => {
  it('treats a "## Commanders" heading as the command zone, like the parser does', async () => {
    await withSnapshotFile(
      '# Test\n\n## Commanders\n\n1 Atraxa &1\n\n## Main\n\n1 Sol Ring &2\n',
      async (file) => {
        const snapshot = await loadListSnapshot('deck', file)
        expect(snapshot.entries.map((e) => [e.name, e.isCommander])).toEqual([
          ['Atraxa', true],
          ['Sol Ring', false],
        ])
      },
    )
  })

  it('reads a collection file, carrying condition, labels and section', async () => {
    await withSnapshotFile(
      '# Binder\n\n## Trade\n\n- Sol Ring (C21:263) [foil] [LP] [keep] &1\n',
      async (file) => {
        const snapshot = await loadListSnapshot('collection', file)
        expect(snapshot.sectionOrder).toEqual(['Trade'])
        expect(snapshot.entries).toEqual([
          {
            name: 'Sol Ring',
            set: 'c21',
            collectorNumber: '263',
            finish: 'foil',
            condition: 'LP',
            language: undefined,
            labels: ['keep'],
            note: undefined,
            cardId: 1,
            section: 'Trade',
            quantity: 1,
            isCommander: false,
          },
        ])
      },
    )
  })

  it('reads a wanted list, which has no condition or commander zone', async () => {
    await withSnapshotFile('# Wanted\n\n- Sol Ring (C21:263) [foil] {cheap} &4\n', async (file) => {
      const snapshot = await loadListSnapshot('wanted', file)
      expect(snapshot.entries).toEqual([
        {
          name: 'Sol Ring',
          set: 'c21',
          collectorNumber: '263',
          finish: 'foil',
          language: undefined,
          note: 'cheap',
          cardId: 4,
          section: 'Main',
          quantity: 1,
          isCommander: false,
        },
      ])
    })
  })
})
