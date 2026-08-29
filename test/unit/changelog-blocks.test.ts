import { describe, expect, it } from 'bun:test'
import {
  parseChangeSets,
  serializeChangeSets,
  serializeChangeSet,
  sortNewestFirst,
  cloneSets,
  deleteSetAt,
  retimeSetAt,
  combineSetsInto,
  canCombineSets,
  changeSetFromEvents,
  isLegacyChangeSet,
  isValidIso8601,
  type ChangeSet,
} from '../../src/changes/changelog-blocks'
import {
  createAddChange,
  createAddSectionChange,
  createRemoveChange,
  createRemoveSectionChange,
  createSetCommanderChange,
  createUnsetCommanderChange,
  type ChangeEvent,
} from '../../src/changes/change-event'

/** A set with prose lines and its events block, as the writer emits it. */
function set(timestamp: string, events: ChangeEvent[], trailing?: string[]): ChangeSet {
  const made = changeSetFromEvents(timestamp, events)
  return trailing ? { ...made, trailing } : made
}

/** A legacy set: prose lines and no block. */
function legacy(timestamp: string, lines: string[], trailing?: string[]): ChangeSet {
  return { timestamp, lines, events: [], ...(trailing ? { trailing } : {}) }
}

/** Sets compared by their persisted fields (the envelope is re-synthesized on read). */
function persisted(sets: ChangeSet[]): unknown[] {
  return sets.map((s) => ({
    ...s,
    events: s.events.map(({ id: _id, timestamp: _timestamp, ...rest }) => rest),
  }))
}

const SAMPLE = `# Changelog for My Deck

## 2026-03-07T22:01:21.452Z

- Added "Demonic Tutor" (UMA:75) [foil] &3
- Removed "Misty Rainforest" &4

\`\`\`ritual-changes
{"action":"add","cardName":"Demonic Tutor","cardId":3,"set":"uma","collectorNumber":"75","finish":"foil"}
{"action":"remove","cardName":"Misty Rainforest","cardId":4}
\`\`\`

## 2026-03-09T10:00:00.000Z

- Added "Sol Ring" &1

\`\`\`ritual-changes
{"action":"add","cardName":"Sol Ring","cardId":1}
\`\`\`
`

describe('parseChangeSets', () => {
  it('parses the header and sets: prose lines verbatim, events from the block', () => {
    const log = parseChangeSets(SAMPLE, 'Fallback')
    expect(log.header).toBe('# Changelog for My Deck')
    expect(log.advisories).toEqual([])
    expect(log.sets).toHaveLength(2)
    expect(log.sets[0]!.lines).toEqual([
      '- Added "Demonic Tutor" (UMA:75) [foil] &3',
      '- Removed "Misty Rainforest" &4',
    ])
    expect(persisted(log.sets)[0]).toEqual({
      timestamp: '2026-03-07T22:01:21.452Z',
      lines: ['- Added "Demonic Tutor" (UMA:75) [foil] &3', '- Removed "Misty Rainforest" &4'],
      events: [
        {
          action: 'add',
          cardName: 'Demonic Tutor',
          cardId: 3,
          set: 'uma',
          collectorNumber: '75',
          finish: 'foil',
        },
        { action: 'remove', cardName: 'Misty Rainforest', cardId: 4 },
      ],
    })
    // The envelope comes from the header: the entry time, and an id stable across reads.
    expect(log.sets[0]!.events[0]!.timestamp).toBe(Date.parse('2026-03-07T22:01:21.452Z'))
    expect(log.sets[0]!.events.map((e) => e.id)).toEqual([
      '2026-03-07T22:01:21.452Z#0',
      '2026-03-07T22:01:21.452Z#1',
    ])
    expect(log.sets[1]!.lines).toEqual(['- Added "Sol Ring" &1'])
  })

  it('reads a block-less entry as a legacy set with no events and one advisory', () => {
    const log = parseChangeSets(
      '# H\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n- Removed "Y" &2\n',
      'n',
    )
    expect(log.sets).toEqual([
      legacy('2026-01-01T00:00:00.000Z', ['- Added "X" &1', '- Removed "Y" &2']),
    ])
    expect(isLegacyChangeSet(log.sets[0]!)).toBe(true)
    expect(log.advisories).toEqual([
      { kind: 'missing-block', timestamp: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('reports an entry whose block is empty, apart from a block-less one', () => {
    const log = parseChangeSets(
      '## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n\n```ritual-changes\n\n```\n',
      'n',
    )
    expect(log.sets).toEqual([legacy('2026-01-01T00:00:00.000Z', ['- Added "X" &1'])])
    expect(log.advisories).toEqual([{ kind: 'empty-block', timestamp: '2026-01-01T00:00:00.000Z' }])
  })

  it('ignores a block line’s own id and timestamp: the envelope is the reader’s', () => {
    const log = parseChangeSets(
      '## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n- Added "Y" &2\n\n```ritual-changes\n{"action":"add","cardName":"X","cardId":1,"id":"dup","timestamp":"2026-01-01T00:00:00.000Z"}\n{"action":"add","cardName":"Y","cardId":2,"id":"dup"}\n```\n',
      'n',
    )
    expect(log.advisories).toEqual([])
    expect(log.sets[0]!.events.map((e) => e.id)).toEqual([
      '2026-01-01T00:00:00.000Z#0',
      '2026-01-01T00:00:00.000Z#1',
    ])
    expect(log.sets[0]!.events.map((e) => e.timestamp)).toEqual([
      Date.parse('2026-01-01T00:00:00.000Z'),
      Date.parse('2026-01-01T00:00:00.000Z'),
    ])
  })

  it('rejects a non-string cardName even on a section-meta action', () => {
    const log = parseChangeSets(
      '## 2026-01-01T00:00:00.000Z\n\n- Added section "Sideboard"\n\n```ritual-changes\n{"action":"add-section","section":"Sideboard","cardName":42}\n```\n',
      'n',
    )
    expect(log.sets[0]!.events).toEqual([])
    expect(log.advisories).toEqual([
      {
        kind: 'invalid-event',
        timestamp: '2026-01-01T00:00:00.000Z',
        error: 'has an invalid "cardName".',
      },
    ])
  })

  it('reports an undecodable block line and keeps the rest of the entry', () => {
    const log = parseChangeSets(
      '## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n\n```ritual-changes\n{"action":"add","cardName":"X","cardId":1}\n{"action":"nope"}\n```\n',
      'n',
    )
    expect(log.sets[0]!.events).toHaveLength(1)
    expect(log.advisories).toEqual([
      {
        kind: 'invalid-event',
        timestamp: '2026-01-01T00:00:00.000Z',
        error: 'has an unknown action: nope.',
      },
    ])
  })

  it('falls back to a generated header when content has none', () => {
    const log = parseChangeSets('## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n', 'Goblins')
    expect(log.header).toBe('# Changelog for Goblins')
  })

  it('returns the fallback header and no sets for empty content', () => {
    const log = parseChangeSets('', 'Goblins')
    expect(log.header).toBe('# Changelog for Goblins')
    expect(log.sets).toEqual([])
    expect(log.advisories).toEqual([])
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
      '# H\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n\n```ritual-changes\n{"action":"add","cardName":"X","cardId":1}\n```\n\nNOTE TO SELF: this was the FNM tuning session.\n\n## 2026-01-02T00:00:00.000Z\n\n- Removed "X" &1\n\n```ritual-changes\n{"action":"remove","cardName":"X","cardId":1}\n```\n'
    const log = parseChangeSets(content, 'n')
    expect(log.sets[0]!.trailing).toEqual(['NOTE TO SELF: this was the FNM tuning session.'])
    expect(log.sets[1]!.trailing).toBeUndefined()
    expect(serializeChangeSets(log)).toBe(content)
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

  it('keeps a user’s own fenced block as trailing prose, `- ` lines and headers inside it included', () => {
    const content =
      '# H\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "X" &1\n\n```ritual-changes\n{"action":"add","cardName":"X","cardId":1}\n```\n\n```text\n- Added "Not a change"\n## not a header\n```\n'
    const log = parseChangeSets(content, 'n')
    expect(log.sets).toHaveLength(1)
    expect(log.sets[0]!.lines).toEqual(['- Added "X" &1'])
    expect(log.sets[0]!.events).toHaveLength(1)
    expect(log.sets[0]!.trailing).toEqual([
      '```text',
      '- Added "Not a change"',
      '## not a header',
      '```',
    ])
    expect(serializeChangeSets(log)).toBe(content)
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
  it('round-trips parsed content byte for byte (sets already in chronological order)', () => {
    const log = parseChangeSets(SAMPLE, 'x')
    expect(serializeChangeSets(log)).toBe(SAMPLE)
  })

  it('lays an entry out as prose, then the events block, then trailing prose', () => {
    const out = serializeChangeSet(
      set('2026-03-09T10:00:00.000Z', [createAddChange('Sol Ring', { cardId: 1 })], ['a note']),
    )
    expect(out).toBe(
      '\n## 2026-03-09T10:00:00.000Z\n\n- Added "Sol Ring" &1\n\n```ritual-changes\n{"action":"add","cardName":"Sol Ring","cardId":1}\n```\n\na note\n',
    )
  })

  it('writes a legacy set with no block', () => {
    expect(serializeChangeSet(legacy('2026-03-09T10:00:00.000Z', ['- Added "Sol Ring" &1']))).toBe(
      '\n## 2026-03-09T10:00:00.000Z\n\n- Added "Sol Ring" &1\n',
    )
  })

  it('sorts sets oldest-first regardless of in-memory order', () => {
    const sets: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [createAddChange('Sol Ring', { cardId: 1 })]),
      set('2026-03-07T22:01:21.452Z', [createAddChange('Bolt', { cardId: 2 })]),
    ]
    const out = serializeChangeSets({ header: '# H', sets })
    expect(out.indexOf('2026-03-07')).toBeLessThan(out.indexOf('2026-03-09'))
  })

  it('omits empty sets', () => {
    const out = serializeChangeSets({
      header: '# H',
      sets: [{ timestamp: '2026-01-01T00:00:00.000Z', lines: [], events: [] }],
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
    set('2026-03-09T10:00:00.000Z', [createAddChange('Sol Ring', { cardId: 1 })]),
    set('2026-03-07T22:01:21.452Z', [
      createAddChange('Bolt', { cardId: 2 }),
      createRemoveChange('Forest', { cardId: 3 }),
    ]),
  ]

  it('sortNewestFirst orders descending by timestamp regardless of input order', () => {
    const unsorted: ChangeSet[] = [
      legacy('2026-03-07T22:01:21.452Z', ['- a']),
      legacy('2026-03-11T00:00:00.000Z', ['- b']),
      legacy('2026-03-09T10:00:00.000Z', ['- c']),
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
    copy[0]!.events.push(createAddChange('Mutated'))
    expect(base[0]!.lines).toHaveLength(1)
    expect(base[0]!.events).toHaveLength(1)
  })

  it('combineSetsInto merges trailing prose older-first and keeps it on the merged set', () => {
    const withProse: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [createAddChange('Sol Ring', { cardId: 1 })], ['newer note']),
      set('2026-03-07T22:01:21.452Z', [createAddChange('Bolt', { cardId: 2 })], ['older note']),
    ]
    const combined = combineSetsInto(withProse, 0, 1)
    expect(combined).toHaveLength(1)
    expect(combined[0]!.trailing).toEqual(['older note', 'newer note'])
  })

  it('a fully-cancelled combine reattaches its prose instead of eating it', () => {
    const cancelling: ChangeSet[] = [
      set('2026-03-05T00:00:00.000Z', [createAddChange('Opt', { cardId: 9 })]),
      set(
        '2026-03-09T10:00:00.000Z',
        [createAddChange('Sol Ring', { cardId: 1 })],
        ['do not lose me'],
      ),
      set('2026-03-07T22:01:21.452Z', [createRemoveChange('Sol Ring', { cardId: 1 })]),
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
    expect(result[1]!.events).toEqual(base[1]!.events)
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
    // The events travel with their lines, in lockstep.
    expect(intoNewer[0]!.events.map((e) => ('cardName' in e ? e.cardName : ''))).toEqual([
      'Bolt',
      'Forest',
      'Sol Ring',
    ])
    expect(intoNewer[0]!.timestamp).toBe('2026-03-09T10:00:00.000Z')
    expect(intoOlder[0]!.timestamp).toBe('2026-03-07T22:01:21.452Z')
  })

  it('combineSetsInto cancels an add against a later remove of the same card, line and event together', () => {
    const sets: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [createRemoveChange('Sol Ring', { cardId: 1 })]),
      set('2026-03-07T22:01:21.452Z', [
        createAddChange('Sol Ring', { cardId: 1 }),
        createAddChange('Bolt', { cardId: 2 }),
      ]),
    ]
    // Older "Added Sol Ring" then newer "Removed Sol Ring" annihilate; the
    // unrelated "Added Bolt" survives.
    const result = combineSetsInto(sets, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]!.lines).toEqual(['- Added "Bolt" &2'])
    expect(result[0]!.events).toEqual([sets[1]!.events[1]!])
  })

  it('combineSetsInto drops a set entirely when compaction empties it', () => {
    const sets: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [createRemoveChange('Bolt', { cardId: 1 })]),
      set('2026-03-07T22:01:21.452Z', [createAddChange('Bolt', { cardId: 1 })]),
    ]
    expect(combineSetsInto(sets, 0, 1)).toEqual([])
  })

  it('combineSetsInto does not cancel adds/removes of different printings', () => {
    // Same cardId on both — it is the printing difference (LEA vs 2ED) that
    // prevents the add/remove from cancelling.
    const sets: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [
        createRemoveChange('Bolt', { set: '2ed', collectorNumber: '162', cardId: 1 }),
      ]),
      set('2026-03-07T22:01:21.452Z', [
        createAddChange('Bolt', { set: 'lea', collectorNumber: '161', cardId: 1 }),
      ]),
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
      set('2026-03-09T10:00:00.000Z', [createRemoveChange('Bolt', { cardId: 2 })]),
      set('2026-03-07T22:01:21.452Z', [createAddChange('Bolt', { cardId: 1 })]),
    ]
    const result = combineSetsInto(sets, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]!.lines).toEqual(['- Added "Bolt" &1', '- Removed "Bolt" &2'])
  })

  it('combineSetsInto cancels on the typed event, not the prose (labels count as identity)', () => {
    // The prose lines are identical — labels are never annotated — but the
    // events differ: a [proxy] copy re-added is not the real removal undone.
    const sets: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [
        createRemoveChange('Bolt', { cardId: 1, labels: ['proxy'] }),
      ]),
      set('2026-03-07T22:01:21.452Z', [createAddChange('Bolt', { cardId: 1 })]),
    ]
    expect(sets[0]!.lines).toEqual(['- Removed "Bolt" &1'])
    const result = combineSetsInto(sets, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]!.lines).toEqual(['- Added "Bolt" &1', '- Removed "Bolt" &1'])
  })

  it('combineSetsInto cancels set-commander against a later unset-commander', () => {
    const sets: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [createUnsetCommanderChange('Urza', { cardId: 5 })]),
      set('2026-03-07T22:01:21.452Z', [createSetCommanderChange('Urza', { cardId: 5 })]),
    ]
    expect(combineSetsInto(sets, 0, 1)).toEqual([])
  })

  it('combineSetsInto cancels add-section against a later remove-section', () => {
    const sets: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [createRemoveSectionChange('Sideboard')]),
      set('2026-03-07T22:01:21.452Z', [createAddSectionChange('Sideboard')]),
    ]
    expect(combineSetsInto(sets, 0, 1)).toEqual([])
  })

  it('combineSetsInto cancels only one add per opposing remove', () => {
    const sets: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [createRemoveChange('Island', { cardId: 1 })]),
      set('2026-03-07T22:01:21.452Z', [
        createAddChange('Island', { cardId: 1 }),
        createAddChange('Island', { cardId: 1 }),
      ]),
    ]
    const result = combineSetsInto(sets, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]!.lines).toEqual(['- Added "Island" &1'])
    expect(result[0]!.events).toHaveLength(1)
  })

  it('combineSetsInto merges two legacy sets as opaque prose, cancelling nothing', () => {
    const sets: ChangeSet[] = [
      legacy('2026-03-09T10:00:00.000Z', ['- Removed "Sol Ring" &1']),
      legacy('2026-03-07T22:01:21.452Z', ['- Added "Sol Ring" &1']),
    ]
    expect(canCombineSets(sets[0]!, sets[1]!)).toBe(true)
    const result = combineSetsInto(sets, 0, 1)
    expect(result).toEqual([
      legacy('2026-03-09T10:00:00.000Z', ['- Added "Sol Ring" &1', '- Removed "Sol Ring" &1']),
    ])
  })

  it('combineSetsInto refuses to merge a legacy set with a block-bearing one', () => {
    // The merged prose and events could no longer pair up, and the migration
    // could no longer tell which lines the block covers — so it is a no-op.
    const sets: ChangeSet[] = [
      set('2026-03-09T10:00:00.000Z', [createRemoveChange('Sol Ring', { cardId: 1 })]),
      legacy('2026-03-07T22:01:21.452Z', ['- Added "Sol Ring" &1']),
    ]
    expect(canCombineSets(sets[0]!, sets[1]!)).toBe(false)
    expect(combineSetsInto(sets, 0, 1)).toEqual(sets)
  })

  it('combineSetsInto refuses a set whose prose and events have drifted apart', () => {
    const desynced: ChangeSet = {
      timestamp: '2026-03-09T10:00:00.000Z',
      lines: ['- Removed "Sol Ring" &1', '- Removed "Forest" &2'],
      events: [createRemoveChange('Sol Ring', { cardId: 1 })],
    }
    const sets: ChangeSet[] = [desynced, base[1]!]
    expect(canCombineSets(desynced, base[1]!)).toBe(false)
    expect(combineSetsInto(sets, 0, 1)).toEqual(sets)
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
