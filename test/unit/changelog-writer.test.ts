import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { appendChangelog } from '../../src/changes/changelog-writer'
import {
  createAddChange,
  createMoveFromChange,
  createRemoveChange,
  createSetLabelChange,
  type ChangeEvent,
} from '../../src/changes/change-event'
import { parseChangelog } from '../../src/changes/changelog-parser'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'

/** Test helper — builds a ChangeEvent with add-change defaults.
 *  Uses assertion since overrides may switch to a different union branch. */
function makeChange(overrides: Record<string, unknown> = {}): ChangeEvent {
  return {
    id: 'test-id',
    timestamp: Date.now(),
    action: 'add',
    cardName: 'Sol Ring',
    ...overrides,
  }
}

let tmpDir: string
let filePath: string
let changelogPath: string

beforeEach(async () => {
  tmpDir = await createWorkspace({ dirs: [], config: false })
  filePath = path.join(tmpDir, 'Test.md')
  changelogPath = path.join(tmpDir, 'Test.changes.md')
  await fs.writeFile(filePath, '# Test\n')
})

afterEach(async () => {
  await removeWorkspace(tmpDir)
})

describe('appendChangelog', () => {
  test('creates changelog file when it does not exist', async () => {
    const returnedPath = await appendChangelog(filePath, 'Test', [makeChange()])

    expect(returnedPath).toBe(changelogPath)
    const content = await fs.readFile(changelogPath, 'utf-8')
    expect(content).toContain('# Changelog for Test')
    expect(content).toContain('- Added "Sol Ring"')
  })

  test('appends to existing changelog', async () => {
    await fs.writeFile(
      changelogPath,
      '# Changelog for Test\n\n## 2026-01-01T00:00:00Z\n\n- Added "Lightning Bolt"\n',
    )

    await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })])

    const content = await fs.readFile(changelogPath, 'utf-8')
    expect(content).toContain('- Added "Lightning Bolt"')
    expect(content).toContain('- Added "Counterspell"')
  })

  test('formats each action into its changelog line', async () => {
    const changes = [
      makeChange({ cardName: 'Demonic Tutor', set: 'UMA', collectorNumber: '93', finish: 'foil' }),
      makeChange({ cardName: 'Cavern-Hoard Dragon', board: 'Maybeboard' }),
      makeChange({ action: 'remove', cardName: 'Lightning Bolt', board: 'Sideboard' }),
      makeChange({ cardName: 'Sol Ring', board: 'Main' }),
      makeChange({ action: 'remove', cardName: 'Misty Rainforest' }),
      makeChange({ action: 'set-commander', cardName: 'Atraxa' }),
      makeChange({ action: 'unset-commander', cardName: 'Atraxa' }),
      makeChange({ action: 'set-finish', cardName: 'Sol Ring', finish: 'foil' }),
      makeChange({ action: 'set-language', cardName: 'Sol Ring', language: 'ja' }),
      makeChange({
        cardName: 'Ambition’s Cost',
        set: 'NEO',
        collectorNumber: '234',
        finish: 'foil',
        language: 'ja',
      }),
      makeChange({
        cardName: 'Black Lotus',
        set: 'LEA',
        collectorNumber: '1',
        finish: 'nonfoil',
        condition: 'LP',
      }),
    ]
    await appendChangelog(filePath, 'Test', changes)

    const content = await fs.readFile(changelogPath, 'utf-8')
    // Add with printing info
    expect(content).toContain('- Added "Demonic Tutor" (UMA:93) [foil]')
    // Non-main board annotated on add, and on remove with "from"
    expect(content).toContain('- Added "Cavern-Hoard Dragon" to Maybeboard')
    expect(content).toContain('- Removed "Lightning Bolt" from Sideboard')
    // The main board carries no annotation
    expect(content).toContain('- Added "Sol Ring"\n')
    expect(content).not.toContain('to Main')
    // Plain remove
    expect(content).toContain('- Removed "Misty Rainforest"')
    // Commander set/unset
    expect(content).toContain('- Set "Atraxa" as commander')
    expect(content).toContain('- Unset "Atraxa" as commander')
    // Finish change
    expect(content).toContain('- Set "Sol Ring" finish to foil')
    // Language change uses the display name, not the code
    expect(content).toContain('- Set language of "Sol Ring" to Japanese')
    // A non-en add annotates the language token after finish/condition
    expect(content).toContain('- Added "Ambition’s Cost" (NEO:234) [foil] [ja]')
    // Condition info for collection cards
    expect(content).toContain('- Added "Black Lotus" (LEA:1) [LP]')
  })

  test('returns changelog path without writing when changes array is empty', async () => {
    const returnedPath = await appendChangelog(filePath, 'Test', [])

    expect(returnedPath).toBe(changelogPath)
    // File should not have been created
    const exists = await Bun.file(changelogPath).exists()
    expect(exists).toBe(false)
  })

  describe('the ritual-changes block', () => {
    test('writes each entry as its prose lines followed by one JSON line per event', async () => {
      const changes: ChangeEvent[] = [
        createAddChange('Sol Ring', {
          set: 'ltc',
          collectorNumber: '284',
          finish: 'foil',
          cardId: 12,
          labels: ['proxy'],
          section: 'Ramp',
        }),
        createMoveFromChange('Sol Ring', {
          set: 'ltc',
          collectorNumber: '284',
          cardId: 5,
          to: { type: 'deck', name: 'Burn' },
        }),
      ]
      await appendChangelog(filePath, 'Test', changes)

      const content = await fs.readFile(changelogPath, 'utf-8')
      const body = content.replace(/^## .*$/m, '## <ts>')
      expect(body).toBe(
        [
          '# Changelog for Test',
          '',
          '## <ts>',
          '',
          '- Added "Sol Ring" (LTC:284) [foil] &12',
          '- Moved "Sol Ring" (LTC:284) &5 to Deck \'Burn\'',
          '',
          '```ritual-changes',
          '{"action":"add","cardName":"Sol Ring","cardId":12,"set":"ltc","collectorNumber":"284","finish":"foil","labels":["proxy"],"section":"Ramp"}',
          '{"action":"move-from","cardName":"Sol Ring","cardId":5,"set":"ltc","collectorNumber":"284","to":{"type":"deck","name":"Burn"}}',
          '```',
          '',
        ].join('\n'),
      )
    })

    test('is deterministic: the same events written twice are byte-identical', async () => {
      const events: ChangeEvent[] = [
        createAddChange('Sol Ring', {
          set: 'ltc',
          collectorNumber: '284',
          finish: 'foil',
          cardId: 12,
        }),
        createRemoveChange('Forest', { cardId: 3, labels: ['sale'], board: 'Sideboard' }),
        createSetLabelChange('Sol Ring', { labels: ['trade', 'sale'], cardId: 12 }),
      ]
      // Structurally equal events with a different key order and fresh envelopes.
      const shuffled: ChangeEvent[] = events.map((e) => {
        const entries = Object.entries(e).reverse()
        return Object.fromEntries([...entries, ['id', 'other'], ['timestamp', 1]]) as ChangeEvent
      })

      const strip = (content: string): string => content.replace(/^## .*$/gm, '## <ts>')
      await appendChangelog(filePath, 'Test', events)
      const first = strip(await fs.readFile(changelogPath, 'utf-8'))
      await fs.rm(changelogPath)
      await appendChangelog(filePath, 'Test', shuffled)
      const second = strip(await fs.readFile(changelogPath, 'utf-8'))

      expect(second).toBe(first)
      expect(first).not.toMatch(/[ \t]+$/m)
      expect(first).not.toContain('"id"')
      expect(first).not.toContain('undefined')
    })
  })

  describe('continueSession', () => {
    /** Count the `## ` blocks (one per changelog entry) in a changelog file. */
    function countBlocks(content: string): number {
      return content.split('\n').filter((line) => line.startsWith('## ')).length
    }

    /** One entry as the writer lays it out: prose, then its events block. */
    function entry(timestamp: string, cardName: string, cardId: number): string {
      return (
        `\n## ${timestamp}\n\n- Added "${cardName}" &${cardId}\n\n` +
        '```ritual-changes\n' +
        `{"action":"add","cardName":"${cardName}","cardId":${cardId}}\n` +
        '```\n'
      )
    }
    const BOLT_ENTRY = `# Changelog for Test\n${entry('2026-01-01T00:00:00.000Z', 'Lightning Bolt', 1)}`

    test('merges into the last block and bumps its timestamp, prose and events in lockstep', async () => {
      await fs.writeFile(changelogPath, BOLT_ENTRY)

      await appendChangelog(
        filePath,
        'Test',
        [makeChange({ cardName: 'Counterspell', cardId: 2 })],
        {
          continueSession: true,
        },
      )

      const content = await fs.readFile(changelogPath, 'utf-8')
      // Both changes live under a single block — no second `## ` header.
      expect(countBlocks(content)).toBe(1)
      expect(content).toContain('- Added "Lightning Bolt" &1\n- Added "Counterspell" &2\n')
      expect(content).toContain(
        '{"action":"add","cardName":"Lightning Bolt","cardId":1}\n{"action":"add","cardName":"Counterspell","cardId":2}\n',
      )
      // The original timestamp was replaced with a fresh one.
      expect(content).not.toContain('2026-01-01T00:00:00.000Z')
      const { pages, advisories } = parseChangelog(content)
      expect(advisories).toEqual([])
      expect(pages[0]!.changes.map((c) => ('cardName' in c ? c.cardName : ''))).toEqual([
        'Lightning Bolt',
        'Counterspell',
      ])
    })

    test('preserves the order: existing lines first, then new ones', async () => {
      await fs.writeFile(changelogPath, BOLT_ENTRY)

      await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })], {
        continueSession: true,
      })

      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(content.indexOf('Lightning Bolt')).toBeLessThan(content.indexOf('Counterspell'))
    })

    test('keeps hand-written prose after the merged block', async () => {
      await fs.writeFile(changelogPath, `${BOLT_ENTRY}\nNOTE: the FNM tuning session.\n`)

      await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })], {
        continueSession: true,
      })

      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(countBlocks(content)).toBe(1)
      expect(content.endsWith('```\n\nNOTE: the FNM tuning session.\n')).toBe(true)
    })

    test('starts a new block beneath a legacy (block-less) final entry instead of merging', async () => {
      // A legacy entry's prose has no events to pair the new ones with, so it
      // is left exactly as written and the session opens a fresh entry.
      const legacy =
        '# Changelog for Test\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "Lightning Bolt"\n'
      await fs.writeFile(changelogPath, legacy)

      await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })], {
        continueSession: true,
      })

      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(content.startsWith(legacy)).toBe(true)
      expect(countBlocks(content)).toBe(2)
    })

    test('only merges into the most recent block, leaving earlier blocks intact', async () => {
      await fs.writeFile(
        changelogPath,
        `# Changelog for Test\n${entry('2026-01-01T00:00:00.000Z', 'Sol Ring', 1)}${entry('2026-02-02T00:00:00.000Z', 'Lightning Bolt', 2)}`,
      )

      await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })], {
        continueSession: true,
      })

      const content = await fs.readFile(changelogPath, 'utf-8')
      // First block untouched; second block absorbed the new line and was retimed.
      expect(countBlocks(content)).toBe(2)
      expect(content).toContain('## 2026-01-01T00:00:00.000Z')
      expect(content).not.toContain('2026-02-02T00:00:00.000Z')
      expect(content).toContain('- Added "Sol Ring"')
      expect(content).toContain('- Added "Lightning Bolt"')
      expect(content).toContain('- Added "Counterspell"')
    })

    test('leaves an existing block untouched when changes is empty', async () => {
      const original = BOLT_ENTRY
      await fs.writeFile(changelogPath, original)

      await appendChangelog(filePath, 'Test', [], { continueSession: true })

      // Empty changes short-circuit before any read/write — the block and its
      // timestamp are left exactly as they were.
      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(content).toBe(original)
    })

    test('starts a fresh block when the changelog does not exist yet', async () => {
      await appendChangelog(filePath, 'Test', [makeChange()], { continueSession: true })

      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(content).toContain('# Changelog for Test')
      expect(countBlocks(content)).toBe(1)
    })

    test('appends a new block when continueSession is false', async () => {
      await fs.writeFile(changelogPath, BOLT_ENTRY)

      await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })], {
        continueSession: false,
      })

      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(countBlocks(content)).toBe(2)
    })
  })
})
