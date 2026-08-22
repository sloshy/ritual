import { describe, expect, test } from 'bun:test'
import { applyFinishFilter, collectSwapCandidates } from '../../../src/editor/swap-printings'
import {
  BINDER,
  CUBE,
  WANTS,
  bolt,
  boltFoilOnly,
  boltLea,
  boltM10,
  boltSta,
  makeCandidate,
  makeSource,
  makeTarget,
  priceOf,
  printinglessCandidate,
} from './fixtures'

describe('collectSwapCandidates', () => {
  test('groups copies by printing, finish, language and condition, expanding deck quantities', () => {
    const binder = makeSource(BINDER, [
      { name: 'Lightning Bolt', set: 'LEA', collectorNumber: '161', quantity: 1, cardId: 1 },
      // An explicit nonfoil and a bare line are the same copies.
      {
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        finish: 'nonfoil',
        quantity: 1,
        cardId: 2,
      },
      // An explicit NM and a bare line are the same condition.
      {
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        condition: 'NM',
        quantity: 1,
        cardId: 3,
      },
      {
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        condition: 'LP',
        quantity: 1,
        cardId: 4,
      },
      {
        name: 'Lightning Bolt',
        set: 'sta',
        collectorNumber: '42',
        finish: 'foil',
        quantity: 1,
        cardId: 5,
      },
      {
        name: 'Lightning Bolt',
        set: 'sta',
        collectorNumber: '42',
        language: 'ja',
        quantity: 1,
        cardId: 6,
      },
      { name: 'Shock', set: 'lea', collectorNumber: '1', quantity: 1, cardId: 7 },
    ])
    const cube = makeSource(CUBE, [
      {
        name: 'Lightning Bolt',
        set: 'sta',
        collectorNumber: '42',
        quantity: 3,
        cardId: 9,
        section: 'Red',
      },
    ])

    const candidates = collectSwapCandidates(makeTarget(), [binder, cube], priceOf)

    expect(candidates.map((c) => c.key)).toEqual([
      'collection:binder|lea:161|nonfoil|en|NM',
      'collection:binder|lea:161|nonfoil|en|LP',
      'collection:binder|sta:42|foil|en|NM',
      'collection:binder|sta:42|nonfoil|ja|NM',
      'deck:cube|sta:42|nonfoil|en|NM',
    ])
    const [leaNm, leaLp, staFoil, staJa, cubeSta] = candidates
    expect(leaNm!.copies).toEqual([{ cardId: 1 }, { cardId: 2 }, { cardId: 3 }])
    expect(leaNm!.available).toBe(3)
    expect(leaNm!.set).toBe('lea')
    expect(leaNm!.card).toBe(boltLea)
    expect(leaNm!.price).toBe(400)
    expect(leaLp!.condition).toBe('LP')
    expect(staFoil!.finish).toBe('foil')
    expect(staFoil!.price).toBe(25)
    expect(staJa!.language).toBe('ja')
    // The Japanese copy is priced as Japanese (the fixture doubles non-English).
    expect(staJa!.price).toBe(20)
    expect(cubeSta!.copies).toEqual([
      { cardId: 9, section: 'Red' },
      { cardId: 9, section: 'Red' },
      { cardId: 9, section: 'Red' },
    ])
    expect(cubeSta!.available).toBe(3)
  })

  test('the same printing in two source lists stays two candidates, in source order', () => {
    const entry = {
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      quantity: 1,
      cardId: 1,
    }
    const candidates = collectSwapCandidates(
      makeTarget(),
      [makeSource(CUBE, [entry]), makeSource(BINDER, [entry])],
      priceOf,
    )
    expect(candidates.map((c) => [c.source, c.available])).toEqual([
      [CUBE, 1],
      [BINDER, 1],
    ])
  })

  test('orders a list by set, then collector number naturally, then finish', () => {
    const binder = makeSource(
      BINDER,
      [
        { name: 'Lightning Bolt', set: 'sta', collectorNumber: '10', quantity: 1, cardId: 1 },
        {
          name: 'Lightning Bolt',
          set: 'sta',
          collectorNumber: '2',
          finish: 'foil',
          quantity: 1,
          cardId: 2,
        },
        { name: 'Lightning Bolt', set: 'sta', collectorNumber: '2', quantity: 1, cardId: 3 },
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', quantity: 1, cardId: 4 },
      ],
      [boltLea, bolt('sta', '2', 1, 3), bolt('sta', '10', 1)],
    )
    expect(collectSwapCandidates(makeTarget(), [binder], priceOf).map((c) => c.key)).toEqual([
      'collection:binder|lea:161|nonfoil|en|NM',
      'collection:binder|sta:2|foil|en|NM',
      'collection:binder|sta:2|nonfoil|en|NM',
      'collection:binder|sta:10|nonfoil|en|NM',
    ])
  })

  test('matches by front-face name and resolves a foil-only printing at its foil price', () => {
    const binder = makeSource(BINDER, [
      {
        name: 'Lightning Bolt // Lightning Bolt',
        set: 'plst',
        collectorNumber: 'm10-146',
        quantity: 1,
        cardId: 1,
      },
    ])
    const [candidate, ...rest] = collectSwapCandidates(makeTarget(), [binder], priceOf)
    expect(rest).toHaveLength(0)
    expect(candidate!.card).toBe(boltFoilOnly)
    expect(candidate!.finish).toBe('foil')
    expect(candidate!.price).toBe(7)
    // The key folds the collector number's case; the record keeps the line's spelling.
    expect(candidate!.key).toBe('collection:binder|plst:m10-146|foil|en|NM')
    expect(candidate!.collectorNumber).toBe('m10-146')
  })

  test('a pinned entry spelled by front face resolves through the target name printings', () => {
    const binder = makeSource(BINDER, [
      {
        name: 'Lightning Bolt // Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        quantity: 1,
        cardId: 1,
      },
    ])
    binder.cards = {}
    const [candidate] = collectSwapCandidates(makeTarget(), [binder], priceOf)
    expect(candidate!.card).toBe(boltLea)
  })

  test('resolves a non-English copy to its language object when cached', () => {
    const boltStaJa = bolt('sta', '42', 8, null, { lang: 'ja' })
    const binder = makeSource(
      BINDER,
      [
        {
          name: 'Lightning Bolt',
          set: 'sta',
          collectorNumber: '42',
          language: 'ja',
          quantity: 1,
          cardId: 1,
        },
      ],
      [boltSta, boltStaJa],
    )
    const [candidate] = collectSwapCandidates(makeTarget(), [binder], priceOf)
    expect(candidate!.card).toBe(boltStaJa)
    expect(candidate!.price).toBe(16)
  })

  test('an uncached printing is a candidate with no card and no price, not the by-name representative', () => {
    const binder = makeSource(
      BINDER,
      [{ name: 'Lightning Bolt', set: 'xyz', collectorNumber: '9', quantity: 1, cardId: 1 }],
      [boltLea],
    )
    binder.cards['Lightning Bolt'] = boltLea
    const [candidate] = collectSwapCandidates(makeTarget(), [binder], priceOf)
    expect(candidate!.card).toBeNull()
    expect(candidate!.price).toBeNull()
    expect(candidate!.set).toBe('xyz')
  })

  test('drops copies identical to the target printing, finish and language', () => {
    const binder = makeSource(BINDER, [
      { name: 'Lightning Bolt', set: 'M10', collectorNumber: '146', quantity: 1, cardId: 1 },
      {
        name: 'Lightning Bolt',
        set: 'm10',
        collectorNumber: '146',
        condition: 'HP',
        quantity: 1,
        cardId: 2,
      },
      {
        name: 'Lightning Bolt',
        set: 'm10',
        collectorNumber: '146',
        finish: 'foil',
        quantity: 1,
        cardId: 3,
      },
      {
        name: 'Lightning Bolt',
        set: 'm10',
        collectorNumber: '146',
        language: 'de',
        quantity: 1,
        cardId: 4,
      },
    ])
    const keys = collectSwapCandidates(makeTarget(), [binder], priceOf).map((c) => c.key)
    expect(keys).toEqual([
      'collection:binder|m10:146|foil|en|NM',
      'collection:binder|m10:146|nonfoil|de|NM',
    ])
  })

  test('a bare copy of a foil-only target printing resolves to foil and is dropped as current', () => {
    const target = makeTarget({ set: 'plst', collectorNumber: 'M10-146', card: boltFoilOnly })
    const binder = makeSource(BINDER, [
      { name: 'Lightning Bolt', set: 'plst', collectorNumber: 'm10-146', quantity: 1, cardId: 1 },
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', quantity: 1, cardId: 2 },
    ])
    expect(collectSwapCandidates(target, [binder], priceOf).map((c) => c.key)).toEqual([
      'collection:binder|lea:161|nonfoil|en|NM',
    ])
  })

  test('name-only entries collapse into one printingless candidate per source list, ordered last', () => {
    const wants = makeSource(WANTS, [
      { name: 'Lightning Bolt', quantity: 2, cardId: 1 },
      { name: 'Lightning Bolt', quantity: 1, cardId: 2 },
    ])
    const cube = makeSource(CUBE, [
      { name: 'Lightning Bolt', quantity: 1, cardId: 5, section: 'Red' },
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', quantity: 1, cardId: 6 },
    ])
    const candidates = collectSwapCandidates(makeTarget(), [wants, cube], priceOf)
    expect(candidates.map((c) => [c.key, c.kind, c.available])).toEqual([
      ['wanted:wants|printingless|lightning bolt', 'printingless', 3],
      ['deck:cube|lea:161|nonfoil|en|NM', 'printing', 1],
      ['deck:cube|printingless|lightning bolt', 'printingless', 1],
    ])
    expect(candidates[0]!.copies).toEqual([{ cardId: 1 }, { cardId: 1 }, { cardId: 2 }])
    expect(candidates[0]!.price).toBeNull()
    expect(candidates[0]!.finish).toBeUndefined()
    expect(candidates[2]!.copies).toEqual([{ cardId: 5, section: 'Red' }])
  })

  test('entries with no copies contribute nothing, not an empty candidate', () => {
    const cube = makeSource(CUBE, [
      { name: 'Lightning Bolt', quantity: 0, cardId: 1 },
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', quantity: 0, cardId: 2 },
    ])
    expect(collectSwapCandidates(makeTarget(), [cube], priceOf)).toEqual([])
  })
})

describe('applyFinishFilter', () => {
  const nonfoil = makeCandidate(BINDER, boltLea, 1, 400, 'nonfoil')
  const foil = makeCandidate(BINDER, boltSta, 1, 25, 'foil')
  const etched = makeCandidate(BINDER, boltM10, 1, 30, 'etched')
  const printingless = printinglessCandidate(WANTS, 1)
  const all = [nonfoil, foil, etched, printingless]

  test('any keeps everything including printingless, as a fresh array', () => {
    const filtered = applyFinishFilter(all, 'any')
    expect(filtered).toEqual(all)
    expect(filtered).not.toBe(all)
  })

  test('foil keeps foil and etched copies only', () => {
    expect(applyFinishFilter(all, 'foil')).toEqual([foil, etched])
  })

  test('nonfoil keeps plain copies only', () => {
    expect(applyFinishFilter(all, 'nonfoil')).toEqual([nonfoil])
  })
})
