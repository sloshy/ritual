import { describe, expect, test } from 'bun:test'
import { parseCollectionFile, type CollectionEntry } from '../../src/collection-file'
import {
  parseWantedListFile,
  formatWantedListLine,
  type WantedListEntry,
} from '../../src/commands/wanted-helpers'
import { formatCollectionLine } from '../../src/commands/collection-helpers'
import {
  orderedSections,
  serializeSectionedList,
  matchSectionHeader,
} from '../../src/section-format'
import {
  replaySectionOrder,
  consolidateSetSection,
  formatChange,
  formatChangeCore,
  createSetSectionChange,
  createAddSectionChange,
  type ChangeEvent,
} from '../../src/change-event'
import { applyChangeToCollection } from '../../src/editor/collection-changes'
import { applyChangeToWantedList } from '../../src/editor/wanted-changes'
import { applyChangeToDeck } from '../../src/editor/deck-changes'
import { ensureCollectionIdsInContent, ensureWantedIdsInContent } from '../../src/ensure-card-ids'
import { parseChangelog } from '../../src/changelog-parser'
import type { CollectionCardEntry, WantedListCardEntry } from '../../src/site/data-types'
import type { DeckData } from '../../src/types'

// ── Parser: section assignment ───────────────────────────────────────

describe('parseCollectionFile sections', () => {
  test('assigns the implicit Main section to cards before any header', () => {
    const { entries, sectionOrder } = parseCollectionFile(`# C\n\n- Sol Ring (C21:167) &1\n`)
    expect(entries[0]!.section).toBe('Main')
    expect(sectionOrder).toEqual(['Main'])
  })

  test('assigns cards to their preceding ## header and records section order', () => {
    const content = `# C\n\n## Rares\n- Sol Ring (C21:167) &1\n\n## Foils\n- Mana Crypt (2XM:270) [foil] &2\n`
    const { entries, sectionOrder } = parseCollectionFile(content)
    expect(entries.map((e) => [e.name, e.section])).toEqual([
      ['Sol Ring', 'Rares'],
      ['Mana Crypt', 'Foils'],
    ])
    expect(sectionOrder).toEqual(['Rares', 'Foils'])
  })

  test('does not treat the # title as a section header', () => {
    const { sectionOrder } = parseCollectionFile(`# My Binder\n\n- Sol Ring (C21:167) &1\n`)
    expect(sectionOrder).toEqual(['Main'])
  })

  test('keeps empty sections (a header with no cards) in the order', () => {
    const { entries, sectionOrder } = parseCollectionFile(
      `# C\n\n## Empty\n\n## Has\n- Sol Ring (C21:167) &1\n`,
    )
    expect(entries).toHaveLength(1)
    expect(sectionOrder).toEqual(['Empty', 'Has'])
  })
})

describe('parseWantedListFile sections', () => {
  test('assigns sections and preserves the implicit Main default', () => {
    const content = `# W\n\n- Queen Marchesa &1\n\n## Foils\n- Sol Ring (C21:167) [foil] &2\n`
    const { entries, sectionOrder } = parseWantedListFile(content)
    expect(entries.map((e) => [e.name, e.section])).toEqual([
      ['Queen Marchesa', 'Main'],
      ['Sol Ring', 'Foils'],
    ])
    expect(sectionOrder).toEqual(['Main', 'Foils'])
  })
})

describe('matchSectionHeader', () => {
  test('matches ## headers but not the # title or list items', () => {
    expect(matchSectionHeader('## Sideboard')).toBe('Sideboard')
    expect(matchSectionHeader('# Title')).toBeNull()
    expect(matchSectionHeader('- Sol Ring')).toBeNull()
  })
})

// ── Serializer round-trip ────────────────────────────────────────────

const collectionLine = (e: CollectionEntry): string =>
  formatCollectionLine(
    e.name,
    e.set,
    e.collectorNumber,
    e.finish ?? 'nonfoil',
    e.condition,
    e.note,
    e.cardId,
  )

const wantedLine = (e: WantedListEntry): string =>
  formatWantedListLine(
    e.name,
    e.set && e.collectorNumber ? { set: e.set, collectorNumber: e.collectorNumber } : undefined,
    e.finish,
    e.note,
    e.cardId,
  )

describe('serializeSectionedList round-trip', () => {
  test('promotes the implicit Main section to an explicit ## Main header', () => {
    const { entries, sectionOrder } = parseCollectionFile(`# C\n\n- Sol Ring (C21:167) &1\n`)
    const out = serializeSectionedList('C', entries, sectionOrder, collectionLine)
    expect(out).toContain('## Main')
    // Re-parsing yields the same section assignment.
    const reparsed = parseCollectionFile(out)
    expect(reparsed.entries[0]!.section).toBe('Main')
    expect(reparsed.entries[0]!.cardId).toBe(1)
  })

  test('preserves multi-section grouping, order, and IDs across a parse→serialize→parse cycle', () => {
    const content = `# C\n\n## Rares\n- Sol Ring (C21:167) [NM] &1\n\n## Foils\n- Mana Crypt (2XM:270) [foil] [NM] &2\n`
    const first = parseCollectionFile(content)
    const out = serializeSectionedList('C', first.entries, first.sectionOrder, collectionLine)
    const second = parseCollectionFile(out)
    expect(second.sectionOrder).toEqual(['Rares', 'Foils'])
    expect(second.entries.map((e) => [e.name, e.section, e.cardId])).toEqual([
      ['Sol Ring', 'Rares', 1],
      ['Mana Crypt', 'Foils', 2],
    ])
    // Set codes are uppercased on write.
    expect(out).toContain('(C21:167)')
  })

  test('emits a bare header for empty sections in the order', () => {
    const out = serializeSectionedList<CollectionEntry>('C', [], ['Wishlist'], collectionLine)
    expect(out).toContain('## Wishlist')
  })

  test('wanted lists round-trip name-only entries within sections', () => {
    const content = `# W\n\n## Top\n- Queen Marchesa &1\n`
    const first = parseWantedListFile(content)
    const out = serializeSectionedList('W', first.entries, first.sectionOrder, wantedLine)
    const second = parseWantedListFile(out)
    expect(second.entries[0]!.section).toBe('Top')
    expect(second.entries[0]!.set).toBeUndefined()
  })
})

describe('orderedSections', () => {
  test('lists order-list sections first, then any entry-only sections', () => {
    expect(orderedSections(['B', 'C'], ['A', 'B'])).toEqual(['A', 'B', 'C'])
  })
  test('collapses duplicates', () => {
    expect(orderedSections(['A', 'A'], ['A'])).toEqual(['A'])
  })
})

// ── replaySectionOrder ───────────────────────────────────────────────

describe('replaySectionOrder', () => {
  test('applies add, rename, and remove section changes in order', () => {
    const changes: ChangeEvent[] = [
      createAddSectionChange('Foils'),
      { id: 'x', timestamp: 0, action: 'rename-section', section: 'Foils', newSection: 'Shiny' },
      { id: 'y', timestamp: 0, action: 'remove-section', section: 'Main' },
    ]
    expect(replaySectionOrder(['Main'], changes)).toEqual(['Shiny'])
  })

  test('is a no-op for card-level changes', () => {
    const changes: ChangeEvent[] = [createSetSectionChange('Sol Ring', 'Foils', 1)]
    expect(replaySectionOrder(['Main', 'Foils'], changes)).toEqual(['Main', 'Foils'])
  })

  test('follows a chained rename (A → B → C)', () => {
    const changes: ChangeEvent[] = [
      { id: '1', timestamp: 0, action: 'rename-section', section: 'A', newSection: 'B' },
      { id: '2', timestamp: 0, action: 'rename-section', section: 'B', newSection: 'C' },
    ]
    expect(replaySectionOrder(['A'], changes)).toEqual(['C'])
  })

  test('renaming a section absent from the order is a no-op', () => {
    const changes: ChangeEvent[] = [
      { id: '1', timestamp: 0, action: 'rename-section', section: 'Ghost', newSection: 'X' },
    ]
    expect(replaySectionOrder(['Main'], changes)).toEqual(['Main'])
  })
})

// ── consolidateSetSection ────────────────────────────────────────────

describe('consolidateSetSection', () => {
  test('cancels when a card is moved back to its original section', () => {
    const first = consolidateSetSection([], 'Sol Ring', 'Foils', 'Main', 1)
    expect(first.addedChange).not.toBeNull()
    const second = consolidateSetSection(first.changes, 'Sol Ring', 'Main', 'Main', 1)
    expect(second.addedChange).toBeNull()
    expect(second.cancelledChange).not.toBeNull()
    expect(second.changes).toHaveLength(0)
  })

  test('keeps only the latest target (latest wins)', () => {
    const first = consolidateSetSection([], 'Sol Ring', 'A', 'Main', 1)
    const second = consolidateSetSection(first.changes, 'Sol Ring', 'B', 'Main', 1)
    expect(second.changes).toHaveLength(1)
    expect((second.changes[0] as { section: string }).section).toBe('B')
  })
})

// ── Change application: flat lists ───────────────────────────────────

const collectionEntry = (over: Partial<CollectionCardEntry> = {}): CollectionCardEntry => ({
  name: 'Sol Ring',
  set: 'c21',
  collectorNumber: '167',
  finish: 'nonfoil',
  condition: 'NM',
  price: 0,
  fileOrder: 0,
  section: 'Main',
  cardId: 1,
  ...over,
})

describe('applyChangeToCollection sections', () => {
  test('set-section moves the targeted entry', () => {
    const result = applyChangeToCollection([collectionEntry()], {
      action: 'set-section',
      cardName: 'Sol Ring',
      section: 'Foils',
      cardId: 1,
    })
    expect(result[0]!.section).toBe('Foils')
  })

  test('rename-section updates every member entry', () => {
    const entries = [collectionEntry({ cardId: 1 }), collectionEntry({ cardId: 2, name: 'Mox' })]
    const result = applyChangeToCollection(entries, {
      action: 'rename-section',
      section: 'Main',
      newSection: 'Core',
    })
    expect(result.every((e) => e.section === 'Core')).toBe(true)
  })

  test('add and a new card adopt the requested section', () => {
    const result = applyChangeToCollection([], {
      action: 'add',
      cardName: 'Dark Ritual',
      section: 'Spells',
    })
    expect(result[0]!.section).toBe('Spells')
  })

  test('add-section and remove-section leave entries untouched', () => {
    const entries = [collectionEntry()]
    expect(applyChangeToCollection(entries, { action: 'add-section', section: 'X' })).toEqual(
      entries,
    )
    expect(applyChangeToCollection(entries, { action: 'remove-section', section: 'X' })).toEqual(
      entries,
    )
  })
})

describe('applyChangeToWantedList sections', () => {
  test('set-section moves the targeted entry', () => {
    const entry: WantedListCardEntry = {
      name: 'Sol Ring',
      price: 0,
      fileOrder: 0,
      state: 'name-only',
      section: 'Main',
      cardId: 1,
    }
    const result = applyChangeToWantedList([entry], {
      action: 'set-section',
      cardName: 'Sol Ring',
      section: 'Foils',
      cardId: 1,
    })
    expect(result[0]!.section).toBe('Foils')
  })

  test('rename-section updates every member entry', () => {
    const mk = (cardId: number, name: string): WantedListCardEntry => ({
      name,
      price: 0,
      fileOrder: cardId,
      state: 'name-only',
      section: 'Main',
      cardId,
    })
    const result = applyChangeToWantedList([mk(1, 'Sol Ring'), mk(2, 'Mox')], {
      action: 'rename-section',
      section: 'Main',
      newSection: 'Core',
    })
    expect(result.every((e) => e.section === 'Core')).toBe(true)
  })
})

// ── Change application: decks ────────────────────────────────────────

const deckWith = (sections: DeckData['sections']): DeckData => ({ name: 'D', sections })

describe('applyChangeToDeck sections', () => {
  test('add-section appends an empty section', () => {
    const result = applyChangeToDeck(deckWith([{ name: 'Main', cards: [] }]), {
      action: 'add-section',
      section: 'Sideboard',
    })
    expect(result.sections.map((s) => s.name)).toEqual(['Main', 'Sideboard'])
  })

  test('remove-section only deletes an empty section', () => {
    const deck = deckWith([
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] },
      { name: 'Spare', cards: [] },
    ])
    expect(
      applyChangeToDeck(deck, { action: 'remove-section', section: 'Main' }).sections,
    ).toHaveLength(2)
    expect(
      applyChangeToDeck(deck, { action: 'remove-section', section: 'Spare' }).sections,
    ).toHaveLength(1)
  })

  test('set-section moves a card between sections, creating the target', () => {
    const deck = deckWith([{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] }])
    const result = applyChangeToDeck(deck, {
      action: 'set-section',
      cardName: 'Sol Ring',
      section: 'Ramp',
      cardId: 1,
    })
    expect(result.sections.find((s) => s.name === 'Main')!.cards).toHaveLength(0)
    expect(result.sections.find((s) => s.name === 'Ramp')!.cards[0]!.name).toBe('Sol Ring')
  })

  test('set-section moves a card into a pre-existing empty section', () => {
    const deck = deckWith([
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] },
      { name: 'Ramp', cards: [] },
    ])
    const result = applyChangeToDeck(deck, {
      action: 'set-section',
      cardName: 'Sol Ring',
      section: 'Ramp',
      cardId: 1,
    })
    expect(result.sections).toHaveLength(2)
    expect(result.sections.find((s) => s.name === 'Ramp')!.cards[0]!.name).toBe('Sol Ring')
  })

  test('rename-section renames in place', () => {
    const result = applyChangeToDeck(deckWith([{ name: 'Main', cards: [] }]), {
      action: 'rename-section',
      section: 'Main',
      newSection: 'Deck',
    })
    expect(result.sections[0]!.name).toBe('Deck')
  })
})

// ── Changelog formatting + round-trip ────────────────────────────────

describe('section changelog formatting', () => {
  test('formatChange renders each section action', () => {
    expect(formatChange(createAddSectionChange('Foils'))).toBe('Add section "Foils"')
    expect(formatChange(createSetSectionChange('Sol Ring', 'Foils', 5))).toBe(
      'Move Sol Ring to section "Foils" &5',
    )
  })

  test('past-tense lines round-trip through the changelog parser', () => {
    const events: ChangeEvent[] = [
      createAddSectionChange('Foils'),
      { id: '1', timestamp: 0, action: 'remove-section', section: 'Old' },
      { id: '2', timestamp: 0, action: 'rename-section', section: 'A', newSection: 'B' },
      createSetSectionChange('Sol Ring', 'Foils', 5),
    ]
    const lines = events.map(
      (e) => `- ${formatChangeCore(e, { tense: 'past', quoteCardName: true })}`,
    )
    const page = parseChangelog(
      `# Changelog\n\n## 2026-01-01T00:00:00.000Z\n\n${lines.join('\n')}\n`,
    )[0]!
    expect(page.changes.map((c) => c.action)).toEqual([
      'Added section',
      'Removed section',
      'Renamed section',
      'Moved to section',
    ])
    expect(page.changes[0]!.section).toBe('Foils')
    expect(page.changes[2]!.section).toBe('A')
    expect(page.changes[2]!.newSection).toBe('B')
    expect(page.changes[3]!.cardName).toBe('Sol Ring')
  })
})

// ── Card-ID backfill leaves headers intact ───────────────────────────

describe('ensureCardIds with section headers', () => {
  test('collection backfill IDs cards but preserves ## headers', () => {
    const { content, added } = ensureCollectionIdsInContent(
      `# C\n\n## Rares\n- Sol Ring (C21:167)\n\n## Foils\n- Mana Crypt (2XM:270) [foil]\n`,
    )
    expect(added).toBe(2)
    expect(content).toContain('## Rares')
    expect(content).toContain('## Foils')
    expect(content).toMatch(/- Sol Ring \(C21:167\) &\d+/)
  })

  test('wanted backfill preserves headers', () => {
    const { content, added } = ensureWantedIdsInContent(`# W\n\n## Top\n- Queen Marchesa\n`)
    expect(added).toBe(1)
    expect(content).toContain('## Top')
  })
})
