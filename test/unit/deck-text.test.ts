import { describe, it, expect } from 'bun:test'
import type { Card, DeckData } from '../../src/types'
import { deckToExportText, deckToMarkdown, serializeCardLine } from '../../src/deck-text'

const deck = (sections: DeckData['sections']): DeckData => ({ name: 'Test', sections })

describe('deckToExportText', () => {
  it('renders commander first, then the main section', () => {
    const text = deckToExportText(
      deck([
        { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring' },
            { quantity: 1, name: 'Arcane Signet' },
          ],
        },
      ]),
    )
    expect(text).toBe('## Commander\n1 Atraxa\n\n## Main\n1 Sol Ring\n1 Arcane Signet')
  })

  it('includes other sections when there is no explicit Main, excluding extras', () => {
    const text = deckToExportText(
      deck([
        { name: 'Creatures', cards: [{ quantity: 4, name: 'Llanowar Elves' }] },
        { name: 'Sideboard', cards: [{ quantity: 2, name: 'Naturalize' }] },
        { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Worldspine Wurm' }] },
        { name: 'Tokens', cards: [{ quantity: 1, name: 'Treasure' }] },
      ]),
    )
    expect(text).toContain('## Creatures\n4 Llanowar Elves')
    expect(text).not.toContain('Sideboard')
    expect(text).not.toContain('Maybeboard')
    expect(text).not.toContain('Tokens')
  })

  it('treats Mainboard as the main section', () => {
    const text = deckToExportText(
      deck([{ name: 'Mainboard', cards: [{ quantity: 2, name: 'Forest' }] }]),
    )
    expect(text).toBe('## Mainboard\n2 Forest')
  })
})

describe('deckToMarkdown', () => {
  it('renders every section as a `## Section` block with full card lines', () => {
    const md = deckToMarkdown(
      deck([
        { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa', cardId: 1 }] },
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 2 },
            { quantity: 1, name: 'Arcane Signet', cardId: 3 },
          ],
        },
      ]),
    )
    expect(md).toBe(
      '## Commander\n1 Atraxa &1\n\n## Main\n1 Sol Ring (C21:263) &2\n1 Arcane Signet &3\n',
    )
  })

  it('includes extras (sideboard, tokens) unlike the plain-text export', () => {
    const md = deckToMarkdown(
      deck([
        { name: 'Main', cards: [{ quantity: 4, name: 'Forest' }] },
        { name: 'Sideboard', cards: [{ quantity: 2, name: 'Naturalize' }] },
      ]),
    )
    expect(md).toContain('## Sideboard\n2 Naturalize')
  })

  it('ends with exactly one trailing newline', () => {
    const md = deckToMarkdown(deck([{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }]))
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
  })
})

type CardLineCase = { label: string; card: Card; expected: string }

describe('serializeCardLine', () => {
  const cases: CardLineCase[] = [
    {
      label: 'basic card with no metadata (and no &N suffix without a cardId)',
      card: { quantity: 1, name: 'Sol Ring' },
      expected: '1 Sol Ring',
    },
    {
      label: 'set and collector number render as an uppercased printing suffix',
      card: { quantity: 2, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157' },
      expected: '2 Lightning Bolt (2XM:157)',
    },
    {
      label: 'set without collector number is not serialized',
      card: { quantity: 1, name: 'Sol Ring', set: '2xm' },
      expected: '1 Sol Ring',
    },
    {
      label: 'foil finish is included',
      card: { quantity: 1, name: 'Mana Crypt', set: '2xm', collectorNumber: '1', finish: 'foil' },
      expected: '1 Mana Crypt (2XM:1) [foil]',
    },
    {
      label: 'etched finish is included',
      card: { quantity: 1, name: 'Ancient Tomb', finish: 'etched' },
      expected: '1 Ancient Tomb [etched]',
    },
    {
      label: 'non-NM condition is included',
      card: { quantity: 3, name: 'Island', set: 'sld', collectorNumber: '63', condition: 'LP' },
      expected: '3 Island (SLD:63) [LP]',
    },
    {
      label: 'note is wrapped in braces',
      card: { quantity: 2, name: 'Sol Ring', note: 'starts the engine', cardId: 1 },
      expected: '2 Sol Ring {starts the engine} &1',
    },
    {
      label: 'empty note is omitted',
      card: { quantity: 1, name: 'Sol Ring', note: '' },
      expected: '1 Sol Ring',
    },
    {
      label: 'cardId appends the &N suffix',
      card: { quantity: 1, name: 'Sol Ring', cardId: 5 },
      expected: '1 Sol Ring &5',
    },
    {
      label: 'a non-English language renders its token after finish and condition',
      card: {
        quantity: 2,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
        note: 'gift',
        cardId: 4,
      },
      expected: '2 Sol Ring (LTC:284) [foil] [LP] [ja] {gift} &4',
    },
    {
      label: 'an English language is never serialized — bare lines mean en',
      card: { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', language: 'en' },
      expected: '1 Sol Ring (LTC:284)',
    },
    {
      label: 'a language token alone sits between the printing and the note',
      card: { quantity: 1, name: 'Sol Ring', language: 'zhs', note: 'x' },
      expected: '1 Sol Ring [zhs] {x}',
    },
  ]

  for (const { label, card, expected } of cases) {
    it(label, () => {
      expect(serializeCardLine(card)).toBe(expected)
    })
  }

  it('uppercases the set code and appends finish, condition, note, and id', () => {
    expect(
      serializeCardLine({
        quantity: 1,
        name: 'Mana Crypt',
        set: '2xm',
        collectorNumber: '1',
        finish: 'foil',
        condition: 'LP',
        note: 'gift',
        cardId: 7,
      }),
    ).toBe('1 Mana Crypt (2XM:1) [foil] [LP] {gift} &7')
  })

  it('omits the default nonfoil finish and NM condition tokens', () => {
    expect(
      serializeCardLine({
        quantity: 1,
        name: 'Sol Ring',
        finish: 'nonfoil',
        condition: 'NM',
        cardId: 1,
      }),
    ).toBe('1 Sol Ring &1')
  })
})
