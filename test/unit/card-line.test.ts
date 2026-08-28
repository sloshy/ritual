import { describe, test, expect } from 'bun:test'
import { formatCollectionLine, type CollectionLineFields } from '../../src/card/card-line'
import { parseCollectionFile } from '../../src/list/collection-file'

type FormatCase = {
  name: string
  fields: CollectionLineFields
  expected: string
}

const SOL_RING: CollectionLineFields = {
  cardName: 'Sol Ring',
  set: 'lea',
  collectorNumber: '232',
  finish: 'foil',
}

describe('formatCollectionLine', () => {
  const cases: FormatCase[] = [
    {
      name: 'formats a basic nonfoil entry without condition',
      fields: { cardName: 'Farewell', set: 'neo', collectorNumber: '123', finish: 'nonfoil' },
      expected: '- Farewell (NEO:123)\n',
    },
    {
      name: 'includes [foil] tag for foil finish',
      fields: SOL_RING,
      expected: '- Sol Ring (LEA:232) [foil]\n',
    },
    {
      name: 'includes [etched] tag for etched finish',
      fields: { cardName: 'Sol Ring', set: 'cmr', collectorNumber: '1', finish: 'etched' },
      expected: '- Sol Ring (CMR:1) [etched]\n',
    },
    {
      name: 'includes condition when provided',
      fields: {
        cardName: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '206',
        finish: 'nonfoil',
        condition: 'LP',
      },
      expected: '- Lightning Bolt (LEA:206) [LP]\n',
    },
    {
      name: 'includes both finish and condition',
      fields: { ...SOL_RING, condition: 'LP' },
      expected: '- Sol Ring (LEA:232) [foil] [LP]\n',
    },
    {
      name: 'omits the default NM condition',
      fields: { ...SOL_RING, condition: 'NM' },
      expected: '- Sol Ring (LEA:232) [foil]\n',
    },
    {
      name: 'includes optional note',
      fields: { ...SOL_RING, condition: 'LP', note: 'signed' },
      expected: '- Sol Ring (LEA:232) [foil] [LP] {signed}\n',
    },
    {
      name: 'includes card ID suffix',
      fields: { ...SOL_RING, condition: 'LP', cardId: 5 },
      expected: '- Sol Ring (LEA:232) [foil] [LP] &5\n',
    },
    {
      name: 'includes both note and card ID',
      fields: { ...SOL_RING, condition: 'LP', note: 'signed', cardId: 42 },
      expected: '- Sol Ring (LEA:232) [foil] [LP] {signed} &42\n',
    },
    {
      name: 'card ID without note',
      fields: {
        cardName: 'Farewell',
        set: 'neo',
        collectorNumber: '123',
        finish: 'nonfoil',
        cardId: 1,
      },
      expected: '- Farewell (NEO:123) &1\n',
    },
    {
      name: 'writes the language token after finish and condition, before labels',
      fields: {
        cardName: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
        labels: ['keep'],
        note: 'gift',
        cardId: 12,
      },
      expected: '- Sol Ring (LTC:284) [foil] [LP] [ja] [keep] {gift} &12\n',
    },
    {
      name: 'never writes en — bare lines mean English',
      fields: {
        cardName: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        finish: 'nonfoil',
        language: 'en',
      },
      expected: '- Sol Ring (LTC:284)\n',
    },
  ]

  for (const { name, fields, expected } of cases) {
    test(name, () => {
      expect(formatCollectionLine(fields)).toBe(expected)
    })
  }

  test('round-trips a [ja] line through the collection parser', () => {
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '284',
      finish: 'nonfoil',
      language: 'ja',
      cardId: 3,
    })
    expect(line).toBe('- Sol Ring (LTC:284) [ja] &3\n')
    const { entries, warnings } = parseCollectionFile(line)
    expect(warnings).toHaveLength(0)
    expect(entries[0]!.language).toBe('ja')
    expect(entries[0]!.cardId).toBe(3)
    // And the parsed entry re-serializes to the identical line.
    expect(
      formatCollectionLine({
        cardName: entries[0]!.name,
        set: entries[0]!.set,
        collectorNumber: entries[0]!.collectorNumber,
        finish: entries[0]!.finish ?? 'nonfoil',
        condition: entries[0]!.condition,
        language: entries[0]!.language,
        labels: entries[0]!.labels,
        note: entries[0]!.note,
        cardId: entries[0]!.cardId,
      }),
    ).toBe(line)
  })
})
