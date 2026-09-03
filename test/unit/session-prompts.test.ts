import { describe, test, expect } from 'bun:test'
import prompts from 'prompts'
import {
  finishChoices,
  finishRows,
  printingChoices,
  promptTagsEdit,
  suggestPrintings,
} from '../../src/commands/session/prompts'
import type { ScryfallCard } from '../../src/scryfall/types'
import { makeScryfallCard, stubTty } from '../test-utils'

describe('promptTagsEdit', () => {
  // The prompt goes through `ask`, which refuses to open without a terminal.
  stubTty({ stdin: true })

  test('re-asks after a refused input instead of dropping it', async () => {
    prompts.inject(['R&D', 'Card Draw'])
    expect(await promptTagsEdit(undefined)).toEqual(['Card Draw'])
  })

  test('empty input on a tagged line clears it', async () => {
    prompts.inject([''])
    expect(await promptTagsEdit(['ramp'])).toEqual([])
  })

  test('an unchanged set is null, whatever its order', async () => {
    prompts.inject(['staple, ramp'])
    expect(await promptTagsEdit(['ramp', 'staple'])).toBeNull()
  })

  test('empty input on an untagged line is null, not an edit', async () => {
    prompts.inject([''])
    expect(await promptTagsEdit(undefined)).toBeNull()
  })

  test('a cancelled prompt is null', async () => {
    prompts.inject([new Error('cancelled')])
    expect(await promptTagsEdit(['ramp'])).toBeNull()
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
