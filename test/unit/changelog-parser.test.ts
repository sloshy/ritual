import { describe, test, expect } from 'bun:test'
import { parseChangelog, extractChangelogCardNames } from '../../src/changes/changelog-parser'
import {
  createAddChange,
  createAddSectionChange,
  createRemoveChange,
  type ChangeEvent,
} from '../../src/changes/change-event'
import { changeSetFromEvents, serializeChangeSets } from '../../src/changes/changelog-blocks'

/** A changelog written the way the writer writes it: prose lines plus the events block. */
function changelog(entries: { timestamp: string; events: ChangeEvent[] }[]): string {
  return serializeChangeSets({
    header: '# Changelog for Test Deck',
    sets: entries.map((e) => changeSetFromEvents(e.timestamp, e.events)),
  })
}

/** `event` without its session envelope, which the block never persists. */
function persisted(event: ChangeEvent): Record<string, unknown> {
  const { id: _id, timestamp: _timestamp, ...rest } = event
  return rest
}

describe('parseChangelog', () => {
  test('reads each entry’s events from its ritual-changes block, newest first', () => {
    const older = [
      createAddChange('Sol Ring', {
        set: 'ltc',
        collectorNumber: '284',
        finish: 'foil',
        cardId: 1,
      }),
      createAddSectionChange('Ramp'),
    ]
    const newer = [createRemoveChange('Sol Ring', { cardId: 1, labels: ['proxy'] })]
    const { pages, advisories } = parseChangelog(
      changelog([
        { timestamp: '2026-01-01T00:00:00.000Z', events: older },
        { timestamp: '2026-02-01T00:00:00.000Z', events: newer },
      ]),
    )
    expect(advisories).toEqual([])
    expect(pages.map((p) => p.timestamp)).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ])
    expect(pages[0]!.changes.map(persisted)).toEqual(newer.map(persisted))
    expect(pages[1]!.changes.map(persisted)).toEqual(older.map(persisted))
  })

  test('re-synthesizes each event’s envelope from the entry header', () => {
    const { pages } = parseChangelog(
      changelog([
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          events: [createAddChange('Sol Ring'), createAddChange('Forest')],
        },
      ]),
    )
    const [first, second] = pages[0]!.changes
    expect(first!.timestamp).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
    expect(second!.timestamp).toBe(first!.timestamp)
    expect(first!.id).not.toBe(second!.id)
  })

  test('never reads prose: a block-less entry yields no page and exactly one advisory', () => {
    const content = [
      '# Changelog for Test Deck',
      '',
      '## 2026-01-01T00:00:00.000Z',
      '',
      '- Added "Sol Ring" &1',
      '- Removed "Forest" &2',
      '',
      '## 2026-02-01T00:00:00.000Z',
      '',
      '- Added "Island" &3',
      '',
      '```ritual-changes',
      '{"action":"add","cardName":"Island","cardId":3}',
      '```',
      '',
    ].join('\n')
    const { pages, advisories } = parseChangelog(content)
    expect(advisories).toEqual([{ kind: 'missing-block', timestamp: '2026-01-01T00:00:00.000Z' }])
    expect(pages).toHaveLength(1)
    expect(pages[0]!.timestamp).toBe('2026-02-01T00:00:00.000Z')
    expect(pages[0]!.changes.map(persisted)).toEqual([
      { action: 'add', cardName: 'Island', cardId: 3 },
    ])
  })

  test('reports each undecodable block line as an advisory and keeps the rest', () => {
    const content = [
      '# Changelog',
      '',
      '## 2026-01-01T00:00:00.000Z',
      '',
      '- Added "Sol Ring" &1',
      '- Frobnicated "Sol Ring" &1',
      '- Added "Forest" &2',
      '',
      '```ritual-changes',
      '{"action":"add","cardName":"Sol Ring","cardId":1}',
      '{"action":"frobnicate","cardName":"Sol Ring","cardId":1}',
      'not json at all',
      '{"action":"add","cardName":"Forest","cardId":2}',
      '```',
      '',
    ].join('\n')
    const { pages, advisories } = parseChangelog(content)
    expect(advisories.map((a) => a.kind)).toEqual(['invalid-event', 'invalid-event'])
    expect(advisories[0]).toMatchObject({ timestamp: '2026-01-01T00:00:00.000Z' })
    const first = advisories[0]!
    expect(first.kind === 'invalid-event' ? first.error : '').toContain('frobnicate')
    expect(pages[0]!.changes.map((c) => ('cardName' in c ? c.cardName : ''))).toEqual([
      'Sol Ring',
      'Forest',
    ])
  })

  test('validates block events through the shared decoder (folding set and language)', () => {
    const content = [
      '## 2026-01-01T00:00:00.000Z',
      '',
      '- Added "Sol Ring" (LTC:284) [JA] &1',
      '',
      '```ritual-changes',
      '{"action":"add","cardName":"Sol Ring","cardId":1,"set":"LTC","collectorNumber":"284","language":"JA"}',
      '```',
      '',
    ].join('\n')
    const { pages, advisories } = parseChangelog(content)
    expect(advisories).toEqual([])
    expect(pages[0]!.changes[0]).toMatchObject({ set: 'ltc', language: 'ja' })
  })

  test('a user’s own fenced block is prose, not events', () => {
    const content = [
      '## 2026-01-01T00:00:00.000Z',
      '',
      '- Added "Sol Ring" &1',
      '',
      '```ritual-changes',
      '{"action":"add","cardName":"Sol Ring","cardId":1}',
      '```',
      '',
      'A note with an example:',
      '',
      '```json',
      '{"action":"remove","cardName":"Sol Ring","cardId":1}',
      '```',
      '',
    ].join('\n')
    const { pages, advisories } = parseChangelog(content)
    expect(advisories).toEqual([])
    expect(pages[0]!.changes).toHaveLength(1)
  })

  test('returns no pages for empty content', () => {
    expect(parseChangelog('')).toEqual({ pages: [], advisories: [] })
    expect(parseChangelog('# Changelog for Nothing')).toEqual({ pages: [], advisories: [] })
  })
})

describe('extractChangelogCardNames', () => {
  test('extracts unique card names across all pages, skipping section-structural events', () => {
    const { pages } = parseChangelog(
      changelog([
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          events: [
            createAddChange('Sol Ring'),
            createRemoveChange('Lightning Bolt'),
            createAddSectionChange('Foils'),
          ],
        },
        {
          timestamp: '2026-02-01T00:00:00.000Z',
          events: [
            createAddChange('Sol Ring', { set: 'mh3', collectorNumber: '301' }),
            createAddChange('Demonic Tutor'),
          ],
        },
      ]),
    )
    expect(extractChangelogCardNames(pages).sort()).toEqual([
      'Demonic Tutor',
      'Lightning Bolt',
      'Sol Ring',
    ])
  })
})
