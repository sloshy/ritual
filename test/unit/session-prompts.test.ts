import { describe, test, expect } from 'bun:test'
import {
  finishChoices,
  finishRows,
  printingChoices,
  suggestPrintings,
} from '../../src/commands/session/prompts'
import { formatCollectionLine } from '../../src/card/card-line'
import { isFinish, isCondition } from '../../src/card/finish-condition'
import type { Finish, Condition } from '../../src/card/finish-condition'
import type { ScryfallCard } from '../../src/scryfall/types'
import { parseCollectionFile } from '../../src/list/collection-file'
import { makeScryfallCard } from '../test-utils'

// Minimal card data for testing formatCollectionLine
function makeCard(set: string, collectorNumber: string) {
  return { set, collectorNumber }
}

describe('formatCollectionLine', () => {
  test('formats a basic nonfoil entry without condition', () => {
    const card = makeCard('neo', '123')
    const line = formatCollectionLine({
      cardName: 'Farewell',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'nonfoil',
    })
    expect(line).toBe('- Farewell (NEO:123)\n')
  })

  test('includes [foil] tag for foil finish', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'foil',
    })
    expect(line).toBe('- Sol Ring (LEA:232) [foil]\n')
  })

  test('includes [etched] tag for etched finish', () => {
    const card = makeCard('cmr', '1')
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'etched',
    })
    expect(line).toBe('- Sol Ring (CMR:1) [etched]\n')
  })

  test('includes condition when provided', () => {
    const card = makeCard('lea', '206')
    const line = formatCollectionLine({
      cardName: 'Lightning Bolt',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'nonfoil',
      condition: 'LP',
    })
    expect(line).toBe('- Lightning Bolt (LEA:206) [LP]\n')
  })

  test('includes both finish and condition', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'foil',
      condition: 'LP',
    })
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [LP]\n')
  })

  test('omits the default NM condition', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'foil',
      condition: 'NM',
    })
    expect(line).toBe('- Sol Ring (LEA:232) [foil]\n')
  })

  test('includes optional note', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'foil',
      condition: 'LP',
      note: 'signed',
    })
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [LP] {signed}\n')
  })

  test('includes card ID suffix', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'foil',
      condition: 'LP',
      cardId: 5,
    })
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [LP] &5\n')
  })

  test('includes both note and card ID', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'foil',
      condition: 'LP',
      note: 'signed',
      cardId: 42,
    })
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [LP] {signed} &42\n')
  })

  test('card ID without note', () => {
    const card = makeCard('neo', '123')
    const line = formatCollectionLine({
      cardName: 'Farewell',
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: 'nonfoil',
      cardId: 1,
    })
    expect(line).toBe('- Farewell (NEO:123) &1\n')
  })
})

describe('isFinish', () => {
  test('accepts valid finishes', () => {
    const validFinishes: Finish[] = ['nonfoil', 'foil', 'etched']
    for (const f of validFinishes) {
      expect(isFinish(f)).toBe(true)
    }
  })

  test('rejects invalid strings', () => {
    expect(isFinish('glossy')).toBe(false)
    expect(isFinish('')).toBe(false)
    expect(isFinish('Foil')).toBe(false)
    expect(isFinish('NONFOIL')).toBe(false)
  })
})

describe('isCondition', () => {
  test('accepts valid conditions', () => {
    const validConditions: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DMG']
    for (const c of validConditions) {
      expect(isCondition(c)).toBe(true)
    }
  })

  test('rejects invalid strings', () => {
    expect(isCondition('nm')).toBe(false)
    expect(isCondition('')).toBe(false)
    expect(isCondition('MINT')).toBe(false)
    expect(isCondition('Near Mint')).toBe(false)
  })
})

describe('printingChoices', () => {
  test('gives each finish its own aligned column, right of the nonfoil price', () => {
    const nonfoil = makeScryfallCard({
      set: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
      rarity: 'common',
      finishes: ['nonfoil', 'foil'],
      prices: { usd: '3.00', usd_foil: '25.00' },
    })
    const etchedOnly = makeScryfallCard({
      set: 'cmr',
      set_name: 'Commander Legends',
      collector_number: '472',
      rarity: 'mythic',
      finishes: ['etched'],
      prices: { usd_etched: '14.99' },
    })
    expect(printingChoices([nonfoil, etchedOnly], 'usd')).toEqual([
      {
        title: 'Limited Edition Alpha (LEA) #161 [common]  $3.00  $25.00 foil',
        value: nonfoil,
      },
      {
        title: 'Commander Legends (CMR) #472 [mythic]                          $14.99 etched',
        value: etchedOnly,
      },
    ])
  })

  test('keeps a single column when no printing has a foil or etched variant', () => {
    const card = makeScryfallCard({
      set: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
      rarity: 'common',
      finishes: ['nonfoil'],
      prices: { usd: '3.00' },
    })
    expect(printingChoices([card], 'usd').map((c) => c.title)).toEqual([
      'Limited Edition Alpha (LEA) #161 [common]  $3.00',
    ])
  })

  test('prices in the given currency, showing N/A where it has none', () => {
    const card = makeScryfallCard({
      set: 'neo',
      set_name: 'Kamigawa',
      collector_number: '1',
      rarity: 'rare',
      prices: { usd: '3.00' },
    })
    expect(printingChoices([card], 'eur').map((c) => c.title)).toEqual([
      'Kamigawa (NEO) #1 [rare]  N/A',
    ])
  })
})

describe('suggestPrintings', () => {
  const cheap = makeScryfallCard({
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '12',
    rarity: 'common',
    finishes: ['nonfoil'],
    prices: { usd: '3.00' },
  })
  const pricey = makeScryfallCard({
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '472',
    rarity: 'mythic',
    finishes: ['nonfoil', 'foil'],
    prices: { usd: '12.99', usd_foil: '40.00' },
  })
  const choices = printingChoices([cheap, pricey], 'usd')
  const collectorNumbers = (matches: readonly { value?: unknown }[]): string[] =>
    matches.map((m) => (m.value as ScryfallCard).collector_number)

  test('lists set-code prefix matches first, then identity matches', () => {
    // 'c' prefixes CMR's set code, and also appears in LEA's 'common' rarity —
    // the set-code match is listed first.
    expect(collectorNumbers(suggestPrintings('c', choices))).toEqual(['472', '12'])
    expect(collectorNumbers(suggestPrintings('alpha common', choices))).toEqual(['12'])
  })

  test('never matches the price columns, so a number searches collector numbers', () => {
    // '12' must not pull in the printing that merely costs $12.99.
    expect(collectorNumbers(suggestPrintings('12', choices))).toEqual(['12'])
  })

  test('never matches a finish tag in the price columns', () => {
    expect(suggestPrintings('foil', choices)).toEqual([])
  })

  test('returns every choice for empty input', () => {
    expect(suggestPrintings('', choices)).toEqual(choices)
  })
})

describe('finishChoices', () => {
  const card = makeScryfallCard({ prices: { usd: '1.00', usd_foil: '4.50' } })

  test('prices each finish and leaves a finishless row bare, keeping each row value', () => {
    expect(
      finishChoices<string>(
        [
          { label: 'No preference (any finish)', value: '__NONE__' },
          ...finishRows(['nonfoil', 'foil']),
        ],
        card,
        'usd',
      ),
    ).toEqual([
      { title: 'No preference (any finish)', value: '__NONE__' },
      { title: 'Nonfoil  $1.00', value: 'nonfoil' },
      { title: 'Foil     $4.50', value: 'foil' },
    ])
  })

  test('omits the price column entirely when the printing is unknown', () => {
    expect(
      finishChoices([{ label: 'Foil', finish: 'foil', value: 'foil' }], undefined, 'usd').map(
        (c) => c.title,
      ),
    ).toEqual(['Foil'])
  })
})

describe('formatCollectionLine — language token', () => {
  test('writes the token after finish and condition, before labels', () => {
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '284',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
      labels: ['keep'],
      note: 'gift',
      cardId: 12,
    })
    expect(line).toBe('- Sol Ring (LTC:284) [foil] [LP] [ja] [keep] {gift} &12\n')
  })

  test('never writes en — bare lines mean English', () => {
    const line = formatCollectionLine({
      cardName: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '284',
      finish: 'nonfoil',
      language: 'en',
    })
    expect(line).toBe('- Sol Ring (LTC:284)\n')
  })

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

describe('language-aware printing resolution helpers', () => {
  const solEn = makeScryfallCard({
    id: 'sol-c21-en',
    name: 'Sol Ring',
    set: 'c21',
    set_name: 'Commander 2021',
    collector_number: '240',
    prices: { usd: '2.00' },
  })
  const solJa = makeScryfallCard({
    id: 'sol-c21-ja',
    name: 'Sol Ring',
    set: 'c21',
    set_name: 'Commander 2021',
    collector_number: '240',
    lang: 'ja',
  })
  const solLea = makeScryfallCard({
    id: 'sol-lea-en',
    name: 'Sol Ring',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '270',
    prices: { usd: '900.00' },
  })
  const jaOnly = makeScryfallCard({
    id: 'sol-sta-ja',
    name: 'Sol Ring',
    set: 'sta',
    set_name: 'Mystical Archive JP',
    collector_number: '999',
    lang: 'ja',
    prices: { usd: '50.00' },
  })

  describe('printingChoices — language dedupe and badge', () => {
    test('one row per printing, badging printings not available in the default language', () => {
      const titles = printingChoices([solJa, solEn, solLea, jaOnly], 'usd', 'en').map(
        (c) => c.title,
      )
      expect(titles).toHaveLength(3)
      expect(titles[0]).toContain('Commander 2021 (C21) #240 [common]')
      expect(titles[0]).not.toContain('only')
      expect(titles[1]).not.toContain('only')
      expect(titles[2]).toContain('Mystical Archive JP (STA) #999 [common] (ja only)')
    })

    test('under a non-en default, en-only printings get the badge instead', () => {
      const titles = printingChoices([solJa, solEn, solLea], 'usd', 'ja').map((c) => c.title)
      expect(titles[0]).not.toContain('only')
      expect(titles[1]).toContain('(en only)')
    })
  })
})
