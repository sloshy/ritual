/**
 * Tests for the MIGRATION-ONLY legacy changelog converter. Delete with the
 * module once every workspace has been migrated.
 */

import { describe, expect, test } from 'bun:test'
import { migrateLegacyChangelog } from '../../src/changes/changelog-migrate'
import { parseChangelog } from '../../src/changes/changelog-parser'
import { changeSetFromEvents, serializeChangeSets } from '../../src/changes/changelog-blocks'
import type { ChangeEvent } from '../../src/changes/change-event'

const LEGACY_ENTRY = `# Changelog for Binder

## 2026-03-07T22:01:21.452Z

- Added "Sol Ring" (LTC:284) [foil] &1
- Removed "Mox Emerald" &2
`

const ADD_SOL_RING: ChangeEvent = {
  id: 'x',
  timestamp: 1,
  action: 'add',
  cardName: 'Sol Ring',
  cardId: 1,
  set: 'ltc',
  collectorNumber: '284',
  finish: 'foil',
}

describe('migrateLegacyChangelog', () => {
  test('a legacy entry gains a block beneath its prose, which is kept byte for byte', () => {
    const { content, converted, skipped, undecodable } = migrateLegacyChangelog(
      LEGACY_ENTRY,
      'Binder',
    )

    expect(converted).toBe(1)
    expect(skipped).toEqual([])
    expect(undecodable).toBeFalse()
    expect(content).toBe(
      `${LEGACY_ENTRY}\n\`\`\`ritual-changes\n` +
        '{"action":"add","cardName":"Sol Ring","cardId":1,"set":"ltc","collectorNumber":"284","finish":"foil"}\n' +
        '{"action":"remove","cardName":"Mox Emerald","cardId":2}\n' +
        '```\n',
    )
    // The live reader — which parses no prose — now sees the events.
    const { pages, advisories } = parseChangelog(content)
    expect(advisories).toEqual([])
    expect(pages[0]!.changes.map((change) => change.action)).toEqual(['add', 'remove'])
  })

  test('a file with nothing to convert is returned unchanged, so a second run writes nothing', () => {
    const original = serializeChangeSets({
      header: '# Changelog for Binder',
      sets: [changeSetFromEvents('2026-03-07T22:01:21.452Z', [ADD_SOL_RING])],
    })

    const first = migrateLegacyChangelog(original, 'Binder')
    expect(first).toMatchObject({ content: original, converted: 0, skipped: [] })

    const migrated = migrateLegacyChangelog(LEGACY_ENTRY, 'Binder')
    const second = migrateLegacyChangelog(migrated.content, 'Binder')
    expect(second).toMatchObject({ content: migrated.content, converted: 0, skipped: [] })
  })

  test('an entry with an unreadable prose line is left verbatim and named', () => {
    const original = `${LEGACY_ENTRY}
## 2026-03-08T10:00:00.000Z

- Added "Sol Ring" &3
- Tidied the binder up a bit
`
    const { content, converted, skipped } = migrateLegacyChangelog(original, 'Binder')

    expect(converted).toBe(1)
    expect(skipped).toEqual([
      {
        timestamp: '2026-03-08T10:00:00.000Z',
        reason: 'unparsed-lines',
        lines: ['- Tidied the binder up a bit'],
      },
    ])
    // The convertible entry converted; the other kept its prose and got no block.
    expect(content).toContain('- Tidied the binder up a bit')
    expect(content).toContain('- Added "Sol Ring" &3')
    expect(content.match(/```ritual-changes/g)).toHaveLength(1)
    const { pages } = parseChangelog(content)
    expect(pages.map((page) => page.timestamp)).toEqual(['2026-03-07T22:01:21.452Z'])
  })

  test('a hand-desynchronized entry is left as it was and named', () => {
    const desynced = `# Changelog for Binder

## 2026-03-07T22:01:21.452Z

- Added "Sol Ring" (LTC:284) &1
- Removed "Mox Emerald" &2

\`\`\`ritual-changes
{"action":"add","cardName":"Sol Ring","cardId":1,"set":"ltc","collectorNumber":"284"}
\`\`\`
`
    const result = migrateLegacyChangelog(desynced, 'Binder')

    expect(result).toMatchObject({
      content: desynced,
      converted: 0,
      skipped: [{ timestamp: '2026-03-07T22:01:21.452Z', reason: 'desynchronized', lines: [] }],
    })
  })

  test('a present-but-empty block converts from its prose like a legacy entry', () => {
    const original = `${LEGACY_ENTRY}
\`\`\`ritual-changes
\`\`\`
`
    const result = migrateLegacyChangelog(original, 'Binder')

    expect(result).toMatchObject({ converted: 1, skipped: [], undecodable: false })
    expect(result.content).toBe(migrateLegacyChangelog(LEGACY_ENTRY, 'Binder').content)
  })

  test('an entry that lost one block line to an undecodable line is not misreported as desynchronized', () => {
    const original = `# Changelog for Binder

## 2026-03-07T22:01:21.452Z

- Added "Sol Ring" (LTC:284) &1
- Added "Arcane Signet" (ELD:331) &2

\`\`\`ritual-changes
{"action":"add","cardName":"Sol Ring","cardId":1,"set":"ltc","collectorNumber":"284"}
{not json}
\`\`\`
`
    const result = migrateLegacyChangelog(original, 'Binder')

    expect(result).toMatchObject({
      content: original,
      converted: 0,
      skipped: [],
      undecodable: true,
    })
  })

  test('a block holding an undecodable line blocks the whole file, since a rewrite would drop it', () => {
    const original = `${LEGACY_ENTRY}
## 2026-03-08T10:00:00.000Z

- Added "Sol Ring" &3

\`\`\`ritual-changes
{"action":"add","cardName":"Sol Ring","cardId":3}
not json at all
\`\`\`
`
    const result = migrateLegacyChangelog(original, 'Binder')

    expect(result.undecodable).toBeTrue()
    expect(result.converted).toBe(0)
    expect(result.content).toBe(original)
  })
})
