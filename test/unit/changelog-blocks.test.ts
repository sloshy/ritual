import { describe, expect, it } from 'bun:test'
import {
  parseChangeSets,
  serializeChangeSets,
  sortNewestFirst,
  cloneSets,
  deleteSetAt,
  retimeSetAt,
  combineSetsInto,
  isValidIso8601,
  type ChangeSet,
} from '../../src/changelog-blocks'

const SAMPLE = `# Changelog for My Deck

## 2026-03-07T22:01:21.452Z

- Added "Demonic Tutor" (UMA:75) [foil] &3
- Removed "Misty Rainforest" &4

## 2026-03-09T10:00:00.000Z

- Added "Sol Ring" &1
`

describe('parseChangeSets', () => {
  it('parses the header and sets, preserving raw lines including card IDs', () => {
    const log = parseChangeSets(SAMPLE, 'Fallback')
    expect(log.header).toBe('# Changelog for My Deck')
    expect(log.sets).toHaveLength(2)
    expect(log.sets[0]).toEqual({
      timestamp: '2026-03-07T22:01:21.452Z',
      lines: ['- Added "Demonic Tutor" (UMA:75) [foil] &3', '- Removed "Misty Rainforest" &4'],
    })
    expect(log.sets[1]!.lines).toEqual(['- Added "Sol Ring" &1'])
  })

  it('falls back to a generated header when content has none', () => {
    const log = parseChangeSets('## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n', 'Goblins')
    expect(log.header).toBe('# Changelog for Goblins')
  })

  it('returns the fallback header and no sets for empty content', () => {
    const log = parseChangeSets('', 'Goblins')
    expect(log.header).toBe('# Changelog for Goblins')
    expect(log.sets).toEqual([])
  })

  it('drops sets that have no change lines', () => {
    const log = parseChangeSets(
      '# H\n\n## 2026-01-01T00:00:00.000Z\n\n## 2026-01-02T00:00:00.000Z\n\n- Added "X" &1\n',
      'n',
    )
    expect(log.sets).toHaveLength(1)
    expect(log.sets[0]!.timestamp).toBe('2026-01-02T00:00:00.000Z')
  })
})

describe('serializeChangeSets', () => {
  it('round-trips parsed content (sets already in chronological order)', () => {
    const log = parseChangeSets(SAMPLE, 'x')
    expect(serializeChangeSets(log)).toBe(SAMPLE)
  })

  it('sorts sets oldest-first regardless of in-memory order', () => {
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- Added "Sol Ring" &1'] },
      { timestamp: '2026-03-07T22:01:21.452Z', lines: ['- Added "Bolt" &2'] },
    ]
    const out = serializeChangeSets({ header: '# H', sets })
    expect(out.indexOf('2026-03-07')).toBeLessThan(out.indexOf('2026-03-09'))
  })

  it('omits empty sets', () => {
    const out = serializeChangeSets({
      header: '# H',
      sets: [{ timestamp: '2026-01-01T00:00:00.000Z', lines: [] }],
    })
    expect(out).toBe('# H\n')
  })
})

describe('isValidIso8601', () => {
  it('accepts the writer format and rejects junk', () => {
    expect(isValidIso8601('2026-03-07T22:01:21.452Z')).toBe(true)
    expect(isValidIso8601('2026-03-07T22:01Z')).toBe(true)
    expect(isValidIso8601('2026-03-07T22:01:21+02:00')).toBe(true)
    expect(isValidIso8601('2026-03-07')).toBe(false)
    expect(isValidIso8601('not a date')).toBe(false)
    expect(isValidIso8601('2026-13-40T99:99:99Z')).toBe(false)
  })
})

describe('editing operations', () => {
  const base: ChangeSet[] = [
    { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- Added "Sol Ring" &1'] },
    {
      timestamp: '2026-03-07T22:01:21.452Z',
      lines: ['- Added "Bolt" &2', '- Removed "Forest" &3'],
    },
  ]

  it('sortNewestFirst orders descending by timestamp regardless of input order', () => {
    const unsorted: ChangeSet[] = [
      { timestamp: '2026-03-07T22:01:21.452Z', lines: ['- a'] },
      { timestamp: '2026-03-11T00:00:00.000Z', lines: ['- b'] },
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- c'] },
    ]
    const sorted = sortNewestFirst(unsorted)
    expect(sorted.map((s) => s.timestamp)).toEqual([
      '2026-03-11T00:00:00.000Z',
      '2026-03-09T10:00:00.000Z',
      '2026-03-07T22:01:21.452Z',
    ])
  })

  it('cloneSets produces an independent deep copy', () => {
    const copy = cloneSets(base)
    copy[0]!.lines.push('- mutated')
    expect(base[0]!.lines).toHaveLength(1)
  })

  it('deleteSetAt removes the indexed set without touching others', () => {
    const result = deleteSetAt(base, 0)
    expect(result).toHaveLength(1)
    expect(result[0]!.timestamp).toBe('2026-03-07T22:01:21.452Z')
  })

  it('retimeSetAt changes only the targeted timestamp', () => {
    const result = retimeSetAt(base, 1, '2026-04-01T00:00:00.000Z')
    expect(result[1]!.timestamp).toBe('2026-04-01T00:00:00.000Z')
    expect(result[1]!.lines).toEqual(base[1]!.lines)
    expect(result[0]!.timestamp).toBe(base[0]!.timestamp)
  })

  it('combineSetsInto merges other into target, keeping the target timestamp', () => {
    const result = combineSetsInto(base, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]!.timestamp).toBe('2026-03-09T10:00:00.000Z')
    expect(result[0]!.lines).toEqual([
      '- Added "Sol Ring" &1',
      '- Added "Bolt" &2',
      '- Removed "Forest" &3',
    ])
  })

  it('combineSetsInto is a no-op copy when indices are equal', () => {
    const result = combineSetsInto(base, 0, 0)
    expect(result).toHaveLength(2)
    expect(result).not.toBe(base)
  })

  it('combineSetsInto returns an unchanged copy when an index is out of range', () => {
    const result = combineSetsInto(base, 0, 5)
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.timestamp)).toEqual(base.map((s) => s.timestamp))
  })

  it('retimeSetAt is a no-op copy when the index is out of range', () => {
    const result = retimeSetAt(base, 9, '2026-04-01T00:00:00.000Z')
    expect(result.map((s) => s.timestamp)).toEqual(base.map((s) => s.timestamp))
  })

  it('editing operations do not mutate the input array', () => {
    deleteSetAt(base, 0)
    retimeSetAt(base, 0, '2026-04-01T00:00:00.000Z')
    combineSetsInto(base, 0, 1)
    expect(base).toHaveLength(2)
    expect(base[0]!.timestamp).toBe('2026-03-09T10:00:00.000Z')
  })
})
