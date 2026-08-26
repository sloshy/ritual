import { describe, test, expect } from 'bun:test'
import {
  applyAddToStaged,
  applyRemoveFromStaged,
  applyRemoveIncomingFromStaged,
  type StagedFile,
} from '../../src/commands/move-io'
import type { PhysicalCard } from '../../src/commands/move-helpers'
import type { DeckData } from '../../src/list/deck'

function deckStaged(deck: DeckData): StagedFile {
  return { kind: 'deck', data: { deck, frontMatter: {} } }
}

function physicalCard(name: string, extra?: Partial<PhysicalCard>): PhysicalCard {
  return {
    key: name,
    name,
    listEntry: { ref: { type: 'deck', name: 'Test' }, filePath: 'Test.md' },
    ...extra,
  }
}

describe('applyRemoveFromStaged (text) line matching', () => {
  test('a card ID is authoritative: an ID miss never falls back to the name match', () => {
    // Two lines share name/set/collector and differ only in finish. Removing
    // the foil copy (&2) must not touch the nonfoil line (&1).
    const staged: StagedFile = {
      kind: 'text',
      content: '# finishes\n\n## Main\n- Sol Ring (C19:221) &1\n- Sol Ring (C19:221) [foil] &2\n',
    }
    const removed = applyRemoveFromStaged(
      staged,
      physicalCard('Sol Ring', {
        set: 'c19',
        collectorNumber: '221',
        finish: 'foil',
        cardId: 2,
      }),
    )
    expect(removed).toBe(true)
    expect(staged).toEqual({
      kind: 'text',
      content: '# finishes\n\n## Main\n- Sol Ring (C19:221) &1\n',
    })
  })

  test('a card ID present in the source but missing from the file removes nothing', () => {
    const staged: StagedFile = {
      kind: 'text',
      content: '# binder\n\n## Main\n- Sol Ring (C19:221) &1\n',
    }
    const removed = applyRemoveFromStaged(
      staged,
      physicalCard('Sol Ring', { set: 'c19', collectorNumber: '221', cardId: 9 }),
    )
    expect(removed).toBe(false)
    expect(staged.kind === 'text' && staged.content).toContain('- Sol Ring (C19:221) &1')
  })

  test('without an ID, the name match narrows by set and collector number', () => {
    const staged: StagedFile = {
      kind: 'text',
      content: '# binder\n\n## Main\n- Sol Ring (C19:221)\n- Sol Ring (LEA:270)\n',
    }
    const removed = applyRemoveFromStaged(
      staged,
      physicalCard('Sol Ring', { set: 'lea', collectorNumber: '270' }),
    )
    expect(removed).toBe(true)
    expect(staged.kind === 'text' && staged.content).toContain('- Sol Ring (C19:221)')
    expect(staged.kind === 'text' && staged.content).not.toContain('- Sol Ring (LEA:270)')
  })
})

describe('applyAddToStaged label handling', () => {
  test('a deck destination keeps only the labels a deck line can express', () => {
    const deck: DeckData = { name: 'Test', sections: [{ name: 'Main', cards: [] }] }
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Sol Ring', { labels: ['proxy'] }), 'deck')
    applyAddToStaged(staged, physicalCard('Mana Crypt', { labels: ['sale', 'trade'] }), 'deck')

    const cards = deck.sections[0]!.cards
    expect(cards.find((c) => c.name === 'Sol Ring')!.labels).toEqual(['proxy'])
    expect(cards.find((c) => c.name === 'Mana Crypt')!.labels).toBeUndefined()
  })

  test('a moved proxy never merges onto the deck line holding the real copies', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        {
          name: 'Main',
          cards: [{ quantity: 2, name: 'Sol Ring', set: 'lea', collectorNumber: '270', cardId: 1 }],
        },
      ],
    }
    const staged = deckStaged(deck)
    const result = applyAddToStaged(
      staged,
      physicalCard('Sol Ring', { set: 'lea', collectorNumber: '270', labels: ['proxy'] }),
      'deck',
    )
    expect(result.merged).toBe(false)
    expect(deck.sections[0]!.cards).toHaveLength(2)
    expect(deck.sections[0]!.cards[1]).toMatchObject({ quantity: 1, labels: ['proxy'] })
  })

  test('a moved copy whose override the deck drops merges onto the plain line', () => {
    // `sale` cannot be written on a deck line, so the moved copy arrives
    // unlabeled — and unlabeled is exactly what the existing line is.
    const deck: DeckData = {
      name: 'Test',
      sections: [
        {
          name: 'Main',
          cards: [{ quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '270', cardId: 1 }],
        },
      ],
    }
    const staged = deckStaged(deck)
    const result = applyAddToStaged(
      staged,
      physicalCard('Sol Ring', { set: 'lea', collectorNumber: '270', labels: ['sale'] }),
      'deck',
    )
    expect(result).toMatchObject({ merged: true, cardId: 1 })
    expect(deck.sections[0]!.cards).toHaveLength(1)
    expect(deck.sections[0]!.cards[0]!.quantity).toBe(2)
  })

  test('a collection destination keeps the whole override', () => {
    const staged: StagedFile = { kind: 'text', content: '# Binder\n\n- Mox Pearl (LEA:265) &1\n' }
    applyAddToStaged(
      staged,
      physicalCard('Sol Ring', {
        set: 'c19',
        collectorNumber: '221',
        labels: ['sale', 'trade'],
      }),
      'collection',
    )
    expect(staged.kind === 'text' && staged.content).toContain(
      '- Sol Ring (C19:221) [sale,trade] &2',
    )
  })
})

describe('applyAddToStaged (deck) ID allocation', () => {
  test('reuses the smallest released ID gap instead of taking the next-highest', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', cardId: 1 },
            { quantity: 1, name: 'Mana Crypt', cardId: 3 }, // gap at 2
          ],
        },
      ],
    }
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck')
    expect(deck.sections[0]!.cards.find((c) => c.name === 'Lightning Bolt')!.cardId).toBe(2)

    // The deck now holds [1, 2, 3]; the next add falls through to 4.
    applyAddToStaged(staged, physicalCard('Counterspell'), 'deck')
    expect(deck.sections[0]!.cards.find((c) => c.name === 'Counterspell')!.cardId).toBe(4)
  })

  test('merges into an identical existing line without allocating a new ID', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        {
          name: 'Main',
          cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167', cardId: 1 }],
        },
      ],
    }
    const staged = deckStaged(deck)

    applyAddToStaged(
      staged,
      physicalCard('Sol Ring', { set: 'c21', collectorNumber: '167' }),
      'deck',
    )

    const main = deck.sections[0]!.cards
    expect(main).toHaveLength(1)
    expect(main[0]!.quantity).toBe(2)
    expect(main[0]!.cardId).toBe(1)
  })
})

describe('applyAddToStaged (deck) section targeting', () => {
  function twoSectionDeck(): DeckData {
    return {
      name: 'Test',
      sections: [
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] },
        { name: 'Sideboard', cards: [{ quantity: 1, name: 'Duress', cardId: 2 }] },
      ],
    }
  }

  test('adds to the exactly-named section when it exists', () => {
    const deck = twoSectionDeck()
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck', 'Sideboard')

    const sideboard = deck.sections.find((s) => s.name === 'Sideboard')!
    expect(sideboard.cards.map((c) => c.name)).toContain('Lightning Bolt')
    expect(deck.sections.find((s) => s.name === 'Main')!.cards).toHaveLength(1)
  })

  test('section matching is exact — a case-different name creates a new section', () => {
    const deck = twoSectionDeck()
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck', 'sideboard')

    expect(deck.sections.map((s) => s.name)).toEqual(['Main', 'Sideboard', 'sideboard'])
    expect(deck.sections.find((s) => s.name === 'sideboard')!.cards[0]!.name).toBe('Lightning Bolt')
  })

  test('creates the section when missing', () => {
    const deck = twoSectionDeck()
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck', 'Maybeboard')

    const created = deck.sections.find((s) => s.name === 'Maybeboard')
    expect(created).toBeDefined()
    expect(created!.cards.map((c) => c.name)).toEqual(['Lightning Bolt'])
  })

  test('merges quantity within the targeted section only', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] },
        { name: 'Sideboard', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 2 }] },
      ],
    }
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Sol Ring'), 'deck', 'Sideboard')

    expect(deck.sections.find((s) => s.name === 'Main')!.cards[0]!.quantity).toBe(1)
    expect(deck.sections.find((s) => s.name === 'Sideboard')!.cards[0]!.quantity).toBe(2)
  })

  test('without a section, the default behavior is unchanged', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa, Praetors’ Voice', cardId: 1 }] },
        { name: 'Spells', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 2 }] },
      ],
    }
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck')

    // First non-commander/sideboard section receives the card.
    expect(deck.sections.find((s) => s.name === 'Spells')!.cards.map((c) => c.name)).toContain(
      'Lightning Bolt',
    )
  })

  test('without a section and no eligible section, Main is created', () => {
    const deck: DeckData = { name: 'Test', sections: [] }
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck')

    expect(deck.sections.map((s) => s.name)).toEqual(['Main'])
  })
})

describe('applyAddToStaged (deck) dropped-note reporting', () => {
  function deckWithLine(note?: string): DeckData {
    return {
      name: 'Test',
      sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', note, cardId: 1 }] }],
    }
  }

  test('reports the incoming note when a merge discards it', () => {
    const staged = deckStaged(deckWithLine('keep me'))

    const added = applyAddToStaged(
      staged,
      physicalCard('Sol Ring', { note: 'incoming note', cardId: 7 }),
      'deck',
    )

    expect(added).toEqual({
      cardId: 1,
      merged: true,
      droppedNote: { cardName: 'Sol Ring', cardId: 7, note: 'incoming note' },
    })
    // The destination line's existing note wins; nothing is merged into it.
    expect(staged.kind === 'deck' && staged.data.deck.sections[0]!.cards[0]!.note).toBe('keep me')
  })

  test('reports nothing when the incoming card has no note', () => {
    const staged = deckStaged(deckWithLine('existing'))

    const added = applyAddToStaged(staged, physicalCard('Sol Ring'), 'deck')

    expect(added).toEqual({ cardId: 1, merged: true, droppedNote: undefined })
  })

  test('reports nothing when the incoming note matches the existing line note', () => {
    const staged = deckStaged(deckWithLine('same note'))

    const added = applyAddToStaged(staged, physicalCard('Sol Ring', { note: 'same note' }), 'deck')

    expect(added.droppedNote).toBeUndefined()
  })

  test('reports nothing when the card appends a new line (note travels with it)', () => {
    const staged = deckStaged(deckWithLine())

    const added = applyAddToStaged(
      staged,
      physicalCard('Lightning Bolt', { note: 'travels' }),
      'deck',
    )

    // A new line, so the note travels with it and the id is the one allocated.
    expect(added).toEqual({ cardId: 2, merged: false })
    const deck = staged.kind === 'deck' ? staged.data.deck : null
    expect(deck!.sections[0]!.cards.find((c) => c.name === 'Lightning Bolt')!.note).toBe('travels')
  })
})

describe('applyRemoveIncomingFromStaged line matching', () => {
  const text = (): Extract<StagedFile, { kind: 'text' }> => ({
    kind: 'text',
    content:
      '# binder\n\n## Main\n- Brainstorm &1\n- Sol Ring (C21:263) &2\n- Sol Ring (C19:221) [foil] &3\n- Sol Ring (C19:221) [foil] &4\n- Bruce Banner (MUL:1) &5\n',
  })
  const foilCopy = { name: 'Sol Ring', set: 'c19', collectorNumber: '221', finish: 'foil' } as const

  test('the source id hint picks among identical sibling lines; without it the first tuple match goes', () => {
    const hinted = text()
    expect(applyRemoveIncomingFromStaged(hinted, { ...foilCopy, cardId: 4 })).toMatchObject({
      cardId: 4,
    })
    expect(hinted.content).toContain('[foil] &3')
    expect(hinted.content).not.toContain('&4')

    const unhinted = text()
    expect(applyRemoveIncomingFromStaged(unhinted, foilCopy)).toMatchObject({ cardId: 3 })
    expect(unhinted.content).toContain('[foil] &4')
  })

  test('a bare line is the printing’s default finish: it matches a resolved foil event, tokened lines do not', () => {
    // A bare line pinning a foil-only printing arrives as `finish: 'foil'`
    // (the planner resolves the display finish); the id tier ignores finish
    // and the tuple tier treats a token-less line as any finish — after the
    // line whose token states the finish exactly.
    const bare =
      '# binder\n\n## Main\n- Jeweled Lotus (CMR:725) &1\n- Jeweled Lotus (CMR:725) [foil] &2\n'
    const hinted: Extract<StagedFile, { kind: 'text' }> = { kind: 'text', content: bare }
    expect(
      applyRemoveIncomingFromStaged(hinted, {
        name: 'Jeweled Lotus',
        set: 'cmr',
        collectorNumber: '725',
        finish: 'foil',
        cardId: 1,
      }),
    ).toMatchObject({ cardId: 1, finish: undefined })
    expect(hinted.content).toContain('[foil] &2')

    // Unhinted, the `[foil]` line is the exact copy and goes first; the bare
    // line is taken once no tokened line is left.
    const unhinted: Extract<StagedFile, { kind: 'text' }> = { kind: 'text', content: bare }
    const lotusFoil = {
      name: 'Jeweled Lotus',
      set: 'cmr',
      collectorNumber: '725',
      finish: 'foil',
    } as const
    expect(applyRemoveIncomingFromStaged(unhinted, lotusFoil)).toMatchObject({ cardId: 2 })
    expect(applyRemoveIncomingFromStaged(unhinted, lotusFoil)).toMatchObject({ cardId: 1 })

    // A tokened `[foil]` line is never taken for a nonfoil copy.
    const tokened: Extract<StagedFile, { kind: 'text' }> = {
      kind: 'text',
      content: '# binder\n\n## Main\n- Jeweled Lotus (CMR:725) [foil] &2\n',
    }
    expect(
      applyRemoveIncomingFromStaged(tokened, {
        name: 'Jeweled Lotus',
        set: 'cmr',
        collectorNumber: '725',
        finish: 'nonfoil',
      }),
    ).toBeNull()
  })

  test('a tokened line with the exact finish outranks a bare line of the printing, whatever the file order', () => {
    const staged: Extract<StagedFile, { kind: 'text' }> = {
      kind: 'text',
      content: '# binder\n\n## Main\n- Sol Ring (LEA:1) &3\n- Sol Ring (LEA:1) [foil] &4\n',
    }
    expect(
      applyRemoveIncomingFromStaged(staged, {
        name: 'Sol Ring',
        set: 'lea',
        collectorNumber: '1',
        finish: 'foil',
      }),
    ).toMatchObject({ cardId: 4, finish: 'foil' })
    expect(staged.content).toContain('(LEA:1) &3')
    expect(staged.content).not.toContain('&4')
  })

  test('a stale id never overrides the printing: the exact tuple is matched instead', () => {
    const staged = text()
    // &2 pins another printing now (C21:263); the copy is found by its tuple
    // and the stale line is left alone.
    expect(applyRemoveIncomingFromStaged(staged, { ...foilCopy, cardId: 2 })).toMatchObject({
      cardId: 3,
    })
    expect(staged.content).toContain('(C21:263) &2')
  })

  test('a printing the list does not hold is refused rather than swapped for a sibling', () => {
    const staged = text()
    expect(
      applyRemoveIncomingFromStaged(staged, { name: 'Sol Ring', set: 'lea', collectorNumber: '1' }),
    ).toBeNull()
    expect(staged.content).toBe(text().content)
  })

  test('a printing-less line is taken by an event that carries the printing chosen on the way in', () => {
    const staged = text()
    expect(
      applyRemoveIncomingFromStaged(staged, {
        name: 'Brainstorm',
        set: 'ice',
        collectorNumber: '64',
      }),
    ).toMatchObject({ cardId: 1, set: undefined })
    expect(staged.content).not.toContain('Brainstorm')
  })

  test('names match by front face, folded, and the removed line reports its own spelling', () => {
    const staged = text()
    expect(
      applyRemoveIncomingFromStaged(staged, {
        name: 'Bruce Banner // The Incredible Hulk',
        set: 'mul',
        collectorNumber: '1',
      }),
    ).toEqual({
      name: 'Bruce Banner',
      cardId: 5,
      set: 'mul',
      collectorNumber: '1',
      finish: undefined,
      condition: undefined,
      language: undefined,
    })
  })

  test('deck lines: the same tiers, and a copy leaves without releasing the line’s id', () => {
    const staged = deckStaged({
      name: 'Test',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', cardId: 1 },
            { quantity: 2, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 4 },
          ],
        },
      ],
    })
    const cards = (): { quantity: number; cardId?: number }[] =>
      staged.kind === 'deck' ? staged.data.deck.sections[0]!.cards : []
    // Exact printing (tier 2) decrements the pinned line and keeps &4.
    expect(
      applyRemoveIncomingFromStaged(staged, {
        name: 'Sol Ring',
        set: 'c19',
        collectorNumber: '221',
      }),
    ).toMatchObject({ cardId: 4 })
    expect(cards()).toMatchObject([{ cardId: 1 }, { quantity: 1, cardId: 4 }])
    // A printing the deck does not hold falls to the printing-less line (tier 3), never to &4.
    expect(
      applyRemoveIncomingFromStaged(staged, { name: 'Sol Ring', set: 'lea', collectorNumber: '1' }),
    ).toMatchObject({ cardId: 1 })
    expect(cards()).toMatchObject([{ quantity: 1, cardId: 4 }])
    // No printing on the event at all: any line of that name (tier 4), then nothing left.
    expect(applyRemoveIncomingFromStaged(staged, { name: 'Sol Ring' })).toMatchObject({ cardId: 4 })
    expect(applyRemoveIncomingFromStaged(staged, { name: 'Sol Ring' })).toBeNull()
  })
})
