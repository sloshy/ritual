import { describe, expect, test } from 'bun:test'
import {
  applySetFilter,
  finishPrice,
  getCheapestPrinting,
  resolveAutoOptions,
  type AutoOptionsContext,
} from '../../../src/editor/card-search/add-resolution'
import type { TranslateFn } from '../../../src/i18n/t'
import { makeScryfallCard } from '../../test-utils'

const lea = makeScryfallCard({
  set: 'lea',
  collector_number: '161',
  finishes: ['nonfoil'],
  prices: { usd: '3.00' },
})
const m21 = makeScryfallCard({
  set: 'm21',
  collector_number: '199',
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '0.25', usd_foil: '1.00' },
})
const unpriced = makeScryfallCard({ set: 'plst', collector_number: '1', prices: {} })
/** A printing whose set code arrives uppercase, as a raw Scryfall object might. */
const m21Upper = makeScryfallCard({ set: 'M21', collector_number: '199', prices: {} })
const unpricedToo = makeScryfallCard({ set: 'plst', collector_number: '2', prices: {} })

describe('applySetFilter', () => {
  test('narrows to the default sets', () => {
    expect(applySetFilter([lea, m21], ['m21'])).toEqual({ printings: [m21], fellBack: false })
  })

  test('a printing’s set code matches the lowercase filter whatever its case', () => {
    expect(applySetFilter([lea, m21Upper], ['m21'])).toEqual({
      printings: [m21Upper],
      fellBack: false,
    })
  })

  test('the filter sets themselves are expected lowercase: an uppercase one matches nothing', () => {
    expect(applySetFilter([lea, m21], ['M21'])).toEqual({ printings: [lea, m21], fellBack: true })
  })

  test('falls back to every printing when no printing matches, and says so', () => {
    expect(applySetFilter([lea, m21], ['mkm'])).toEqual({ printings: [lea, m21], fellBack: true })
  })

  test('no default sets means no filter and no fallback', () => {
    expect(applySetFilter([lea, m21], [])).toEqual({ printings: [lea, m21], fellBack: false })
  })
})

describe('getCheapestPrinting', () => {
  test('picks the lowest USD price, sorting an unpriced printing last', () => {
    expect(getCheapestPrinting([unpriced, lea, m21])).toBe(m21)
    expect(getCheapestPrinting([unpriced])).toBe(unpriced)
    expect(getCheapestPrinting([])).toBeUndefined()
  })

  test('with nothing priced, the first printing stands in', () => {
    expect(getCheapestPrinting([unpriced, unpricedToo])).toBe(unpriced)
  })
})

describe('finishPrice', () => {
  const tKey: TranslateFn = (key, ..._args) => key

  test('quotes the picked finish in the picker currency', () => {
    expect(finishPrice(tKey, m21, 'foil')).toBe('$1.00')
    expect(finishPrice(tKey, m21, 'nonfoil')).toBe('$0.25')
  })

  test('an unpriced finish shows the not-available label', () => {
    expect(finishPrice(tKey, unpriced, 'nonfoil')).toBe('site.printingPrice.na')
  })
})

describe('resolveAutoOptions', () => {
  const deck: AutoOptionsContext = {
    defaultFinish: undefined,
    defaultCondition: undefined,
    usesCondition: true,
    requirePrinting: false,
  }

  test('a nonfoil-only printing on a deck skips the step with the NM default', () => {
    expect(resolveAutoOptions(lea, deck)).toEqual({
      printing: lea,
      finish: 'nonfoil',
      condition: 'NM',
    })
  })

  test('a printing offering foil needs the finish step unless the default finish applies', () => {
    expect(resolveAutoOptions(m21, deck)).toBeNull()
    expect(resolveAutoOptions(m21, { ...deck, defaultFinish: 'foil' })).toEqual({
      printing: m21,
      finish: 'foil',
      condition: 'NM',
    })
  })

  test('a default finish the printing does not offer does not apply', () => {
    expect(resolveAutoOptions(lea, { ...deck, defaultFinish: 'foil' })).toMatchObject({
      finish: 'nonfoil',
    })
  })

  test('a collection needs an explicit condition, so only a default condition skips', () => {
    const collection: AutoOptionsContext = { ...deck, requirePrinting: true }
    expect(resolveAutoOptions(lea, collection)).toBeNull()
    expect(resolveAutoOptions(lea, { ...collection, defaultCondition: 'LP' })).toEqual({
      printing: lea,
      finish: 'nonfoil',
      condition: 'LP',
    })
  })

  test('a list that tracks no condition commits without one', () => {
    expect(
      resolveAutoOptions(lea, { ...deck, usesCondition: false, requirePrinting: true }),
    ).toEqual({ printing: lea, finish: 'nonfoil', condition: undefined })
  })
})
