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

  it('preserves hand-written prose as the set it follows, surviving a round trip', () => {
    const content =
      '# H\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n\nNOTE TO SELF: this was the FNM tuning session.\n\n## 2026-01-02T00:00:00.000Z\n\n- Removed "X" &1\n'
    const log = parseChangeSets(content, 'n')
    expect(log.sets[0]!.trailing).toEqual(['NOTE TO SELF: this was the FNM tuning session.'])
    expect(log.sets[1]!.trailing).toBeUndefined()
    expect(parseChangeSets(serializeChangeSets(log), 'n')).toEqual(log)
  })

  it('keeps prose indentation through a round trip', () => {
    const content =
      '# H\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n\n  - a nested hand-written list item\n    with a continuation\n'
    const log = parseChangeSets(content, 'n')
    // The indented `- ` line trims to a change line by grammar; the deeper
    // continuation stays trailing prose, indentation intact.
    expect(log.sets[0]!.trailing).toEqual(['    with a continuation'])
    expect(parseChangeSets(serializeChangeSets(log), 'n')).toEqual(log)
  })

  it('reattaches prose from a dropped empty set to the previous surviving set', () => {
    const log = parseChangeSets(
      '# H\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n\n## not-a-real-set\n\nstray text here\n',
      'n',
    )
    expect(log.sets).toHaveLength(1)
    expect(log.sets[0]!.trailing).toEqual(['stray text here'])
  })

  it('reattaches prose to the header when no set survives before it', () => {
    const log = parseChangeSets(
      '# H\n\n## not-a-real-set\n\norphaned prose\n\n## 2026-01-02T00:00:00.000Z\n\n- Added "X" &1\n',
      'n',
    )
    expect(log.sets).toHaveLength(1)
    expect(log.header).toBe('# H\n\norphaned prose')
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

  it('combineSetsInto merges trailing prose older-first and keeps it on the merged set', () => {
    const withProse: ChangeSet[] = [
      {
        timestamp: '2026-03-09T10:00:00.000Z',
        lines: ['- Added "Sol Ring" &1'],
        trailing: ['newer note'],
      },
      {
        timestamp: '2026-03-07T22:01:21.452Z',
        lines: ['- Added "Bolt" &2'],
        trailing: ['older note'],
      },
    ]
    const combined = combineSetsInto(withProse, 0, 1)
    expect(combined).toHaveLength(1)
    expect(combined[0]!.trailing).toEqual(['older note', 'newer note'])
  })

  it('a fully-cancelled combine reattaches its prose instead of eating it', () => {
    const cancelling: ChangeSet[] = [
      { timestamp: '2026-03-05T00:00:00.000Z', lines: ['- Added "Opt" &9'] },
      {
        timestamp: '2026-03-09T10:00:00.000Z',
        lines: ['- Added "Sol Ring" &1'],
        trailing: ['do not lose me'],
      },
      { timestamp: '2026-03-07T22:01:21.452Z', lines: ['- Removed "Sol Ring" &1'] },
    ]
    const combined = combineSetsInto(cancelling, 1, 2)
    expect(combined).toHaveLength(1)
    expect(combined[0]!.lines).toEqual(['- Added "Opt" &9'])
    expect(combined[0]!.trailing).toEqual(['do not lose me'])
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

  it('combineSetsInto orders lines newest-at-bottom regardless of combine direction', () => {
    // Combining the older set into the newer (above) and the newer into the older
    // (below) both yield the same oldest-first line order; only the kept timestamp
    // differs (the target's).
    const intoNewer = combineSetsInto(base, 0, 1)
    const intoOlder = combineSetsInto(base, 1, 0)
    expect(intoNewer[0]!.lines).toEqual(intoOlder[0]!.lines)
    expect(intoNewer[0]!.lines).toEqual([
      '- Added "Bolt" &2',
      '- Removed "Forest" &3',
      '- Added "Sol Ring" &1',
    ])
    expect(intoNewer[0]!.timestamp).toBe('2026-03-09T10:00:00.000Z')
    expect(intoOlder[0]!.timestamp).toBe('2026-03-07T22:01:21.452Z')
  })

  it('combineSetsInto cancels an add against a later remove of the same card', () => {
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- Removed "Sol Ring" &1'] },
      {
        timestamp: '2026-03-07T22:01:21.452Z',
        lines: ['- Added "Sol Ring" &1', '- Added "Bolt" &2'],
      },
    ]
    // Older "Added Sol Ring" then newer "Removed Sol Ring" annihilate; the
    // unrelated "Added Bolt" survives.
    const result = combineSetsInto(sets, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]!.lines).toEqual(['- Added "Bolt" &2'])
  })

  it('combineSetsInto drops a set entirely when compaction empties it', () => {
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- Removed "Bolt" &1'] },
      { timestamp: '2026-03-07T22:01:21.452Z', lines: ['- Added "Bolt" &1'] },
    ]
    expect(combineSetsInto(sets, 0, 1)).toEqual([])
  })

  it('combineSetsInto does not cancel adds/removes of different printings', () => {
    // Same cardId on both — it is the printing difference (LEA vs 2ED) that
    // prevents the add/remove from cancelling.
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- Removed "Bolt" (2ED:162) &1'] },
      { timestamp: '2026-03-07T22:01:21.452Z', lines: ['- Added "Bolt" (LEA:161) &1'] },
    ]
    const result = combineSetsInto(sets, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]!.lines).toEqual([
      '- Added "Bolt" (LEA:161) &1',
      '- Removed "Bolt" (2ED:162) &1',
    ])
  })

  it('combineSetsInto does not cancel adds/removes with mismatched card IDs', () => {
    // Same name and printing, but different &N — distinct copies, so they stay.
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- Removed "Bolt" &2'] },
      { timestamp: '2026-03-07T22:01:21.452Z', lines: ['- Added "Bolt" &1'] },
    ]
    const result = combineSetsInto(sets, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]!.lines).toEqual(['- Added "Bolt" &1', '- Removed "Bolt" &2'])
  })

  it('combineSetsInto cancels set-commander against a later unset-commander', () => {
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- Unset "Urza" as commander &5'] },
      { timestamp: '2026-03-07T22:01:21.452Z', lines: ['- Set "Urza" as commander &5'] },
    ]
    expect(combineSetsInto(sets, 0, 1)).toEqual([])
  })

  it('combineSetsInto cancels add-section against a later remove-section', () => {
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- Removed section "Sideboard"'] },
      { timestamp: '2026-03-07T22:01:21.452Z', lines: ['- Added section "Sideboard"'] },
    ]
    expect(combineSetsInto(sets, 0, 1)).toEqual([])
  })

  it('combineSetsInto cancels only one add per opposing remove', () => {
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- Removed "Island" &1'] },
      {
        timestamp: '2026-03-07T22:01:21.452Z',
        lines: ['- Added "Island" &1', '- Added "Island" &1'],
      },
    ]
    const result = combineSetsInto(sets, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]!.lines).toEqual(['- Added "Island" &1'])
  })

  it('combineSetsInto leaves unparseable lines untouched (treated as opaque)', () => {
    const sets: ChangeSet[] = [
      { timestamp: '2026-03-09T10:00:00.000Z', lines: ['- something freeform'] },
      { timestamp: '2026-03-07T22:01:21.452Z', lines: ['- another note'] },
    ]
    const result = combineSetsInto(sets, 0, 1)
    expect(result[0]!.lines).toEqual(['- another note', '- something freeform'])
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
