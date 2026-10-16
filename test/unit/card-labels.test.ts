import { describe, expect, test } from 'bun:test'
import { keyedError, keyedMessage } from '../helpers/api-message'
import {
  arrivalLabels,
  carriedEffectiveLabels,
  carriedLabels,
  cardLabelChoicesFor,
  cardLabelDefaultChoicesFor,
  cardLabelName,
  CARD_LABELS,
  checkLabelsForListType,
  currentLabelChoice,
  effectiveLabels,
  EXCLUSIVE_CARD_LABELS,
  formatCardLabels,
  formatLabelOverride,
  isCardLabel,
  isPriceless,
  isProxy,
  labelOverrideConflict,
  minimalOverride,
  negateLabel,
  overrideBaseLabels,
  overrideForChoice,
  pricelessReason,
  labelFiltersFor,
  LIST_TYPE_LABELS,
  normalizeCardLabels,
  normalizedOverride,
  parseLabelOverrideData,
  parseLabelOverrideToken,
  parseCardLabelsValue,
  readListDefaultLabels,
  signedLabelName,
  SIGNED_CARD_LABELS,
  supportsAnyLabels,
  unsupportedLabelsFor,
  unsupportedLabelsMessage,
  type CardLabel,
  type LabelOverride,
  type SignedCardLabel,
} from '../../src/card/card-labels'
import type { ListType } from '../../src/list/list-type'

/** Every legal (positive) label set a list of `type` may hold or default to. */
function legalSets(type: ListType): CardLabel[][] {
  const supported = LIST_TYPE_LABELS[type] as readonly CardLabel[]
  return subsets(supported).filter((set) => labelOverrideConflict(set) === undefined)
}

/**
 * Every legal override a line of `type` may carry, in canonical order — void
 * negatives (`[keep,no-sale]`) included, which is what makes the normalization
 * property meaningful.
 */
function legalOverrides(type: ListType): LabelOverride[] {
  const supported = LIST_TYPE_LABELS[type] as readonly CardLabel[]
  const signed = SIGNED_CARD_LABELS.filter((label) =>
    supported.some((base) => label === base || label === negateLabel(base)),
  )
  return subsets(signed).filter((set) => set.length > 0 && labelOverrideConflict(set) === undefined)
}

function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => [...acc, ...acc.map((s) => [...s, item])], [[]])
}

/** The display form of a set, so a failing row names its case. */
const show = (labels: readonly string[] | undefined): string =>
  labels === undefined ? 'none' : `[${labels.join(',')}]`

describe('isCardLabel', () => {
  test('accepts exactly the pinned vocabulary and rejects everything else', () => {
    // Pin the vocabulary itself: file tokens and changelog lines persist these
    // strings, so widening or renaming them must be a deliberate act.
    expect([...CARD_LABELS]).toEqual(['sale', 'trade', 'keep', 'proxy'])
    expect(isCardLabel('sale')).toBe(true)
    expect(isCardLabel('SALE')).toBe(false)
    expect(isCardLabel('sell')).toBe(false)
    expect(isCardLabel('')).toBe(false)
  })
})

describe('normalizeCardLabels', () => {
  test('dedupes and orders canonically (sale before trade)', () => {
    expect(normalizeCardLabels(['trade', 'sale', 'trade'])).toEqual(['sale', 'trade'])
  })

  test('leaves a single label untouched', () => {
    expect(normalizeCardLabels(['keep'])).toEqual(['keep'])
  })
})

describe('signed vocabulary', () => {
  test('pins the signed tokens and their canonical order', () => {
    // Card lines and change events persist these strings.
    expect([...SIGNED_CARD_LABELS]).toEqual([
      'sale',
      'trade',
      'keep',
      'proxy',
      'no-sale',
      'no-trade',
      'no-keep',
      'no-proxy',
    ])
  })
})

describe('parseLabelOverrideToken', () => {
  test.each<[string, LabelOverride]>([
    ['sale', ['sale']],
    ['trade,sale', ['sale', 'trade']],
    ['sale,sale', ['sale']],
    ['SALE,Trade', ['sale', 'trade']],
    ['PROXY', ['proxy']],
    ['no-proxy', ['no-proxy']],
    // positives first, then negatives, each in vocabulary order
    ['no-sale,trade', ['trade', 'no-sale']],
    ['no-trade, no-sale', ['no-sale', 'no-trade']],
    // a void negative (one the line's own exclusive positive displaces) is dropped
    ['keep,no-sale', ['keep']],
    ['sale,no-keep', ['sale']],
  ])('%s parses to %p', (raw, labels) => {
    expect(parseLabelOverrideToken(raw)).toEqual({ ok: true, labels })
  })

  test('refuses an exclusive label combined with another positive', () => {
    const result = parseLabelOverrideToken('sale,keep')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("'keep' cannot be combined")
    expect(parseLabelOverrideToken('keep,proxy').ok).toBe(false)
    expect(parseLabelOverrideToken('proxy,trade').ok).toBe(false)
  })

  test('refuses a label both set and negated', () => {
    const result = parseLabelOverrideToken('proxy,no-proxy')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("'proxy' cannot be both set and negated")
  })

  test('negatives combine freely with each other', () => {
    expect(parseLabelOverrideToken('no-keep,no-proxy')).toEqual({
      ok: true,
      labels: ['no-keep', 'no-proxy'],
    })
  })

  test('refuses unknown members, an empty body and dangling commas', () => {
    const result = parseLabelOverrideToken('sale,sell')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("'sell'")
    expect(parseLabelOverrideToken('').ok).toBe(false)
    expect(parseLabelOverrideToken('sale,').ok).toBe(false)
    expect(parseLabelOverrideToken('not-sale').ok).toBe(false)
  })
})

describe('parseLabelOverrideData', () => {
  test('parses signed data case-insensitively and normalizes', () => {
    expect(parseLabelOverrideData(['NO-SALE', 'trade'], 'labels')).toEqual({
      ok: true,
      labels: ['trade', 'no-sale'],
    })
    expect(parseLabelOverrideData([], 'labels')).toEqual({ ok: true, labels: [] })
  })

  test('refuses in English plus a key, naming the field', () => {
    expect(keyedError(parseLabelOverrideData('sale', 'labels'))).toBe(
      'labels must be an array of labels (sale, trade, keep, proxy, no-sale, no-trade, no-keep, no-proxy).',
    )
    expect(keyedError(parseLabelOverrideData([7], '"labels"'))).toBe(
      '"labels" must be one of: sale, trade, keep, proxy, no-sale, no-trade, no-keep, no-proxy.',
    )
    expect(keyedError(parseLabelOverrideData(['Sael'], 'labels'))).toBe(
      "Invalid labels 'Sael'. Use one of: sale, trade, keep, proxy, no-sale, no-trade, no-keep, no-proxy.",
    )
    expect(keyedError(parseLabelOverrideData(['sale', 'no-sale'], 'labels'))).toBe(
      "'sale' cannot be both set and negated on one card.",
    )
    expect(keyedError(parseLabelOverrideData(['keep', 'trade'], 'labels'))).toBe(
      "'keep' cannot be combined with other labels.",
    )
  })
})

describe('parseCardLabelsValue', () => {
  test('parses an array case-insensitively and normalizes', () => {
    expect(parseCardLabelsValue(['Trade', 'SALE'], 'labels')).toEqual({
      ok: true,
      labels: ['sale', 'trade'],
    })
  })

  test('an empty array is ok (callers decide what empty means)', () => {
    expect(parseCardLabelsValue([], 'labels')).toEqual({ ok: true, labels: [] })
  })

  test('refuses non-arrays', () => {
    expect(parseCardLabelsValue('sale', 'labels').ok).toBe(false)
    expect(parseCardLabelsValue(null, 'labels').ok).toBe(false)
  })

  test('refuses non-string elements', () => {
    expect(parseCardLabelsValue([1], 'labels').ok).toBe(false)
  })

  test('refuses keep combined with the others', () => {
    expect(parseCardLabelsValue(['keep', 'trade'], 'labels').ok).toBe(false)
  })

  test('refuses proxy combined with the others', () => {
    expect(parseCardLabelsValue(['proxy', 'sale'], 'labels').ok).toBe(false)
    expect(parseCardLabelsValue(['proxy', 'keep'], 'labels').ok).toBe(false)
  })

  test('refuses a negation: a list default is positive only', () => {
    expect(parseCardLabelsValue(['no-sale'], 'labels').ok).toBe(false)
  })

  test('words each refusal in English plus a key', () => {
    expect(keyedError(parseCardLabelsValue('sale', 'labels'))).toBe(
      'labels must be an array of labels (sale, trade, keep, proxy).',
    )
    expect(keyedError(parseCardLabelsValue([1], 'labels'))).toBe(
      'labels must be one of: sale, trade, keep, proxy.',
    )
    expect(keyedError(parseCardLabelsValue(['no-sale'], 'labels'))).toBe(
      "Invalid labels 'no-sale'. Use one of: sale, trade, keep, proxy.",
    )
    expect(keyedError(parseCardLabelsValue(['proxy', 'sale'], 'labels'))).toBe(
      "'proxy' cannot be combined with other labels.",
    )
  })
})

describe('list-type label support', () => {
  test('pins which labels each list type accepts', () => {
    // Deck lines and deck front matter persist these, so widening a type's
    // vocabulary must be deliberate.
    expect([...EXCLUSIVE_CARD_LABELS]).toEqual(['keep', 'proxy'])
    expect([...LIST_TYPE_LABELS.deck]).toEqual(['proxy'])
    expect([...LIST_TYPE_LABELS.collection]).toEqual([...CARD_LABELS])
    expect([...LIST_TYPE_LABELS.wanted]).toEqual([])
  })

  test('supportsAnyLabels is false only for wanted lists', () => {
    expect(supportsAnyLabels('deck')).toBe(true)
    expect(supportsAnyLabels('collection')).toBe(true)
    expect(supportsAnyLabels('wanted')).toBe(false)
  })

  test('unsupportedLabelsFor names the offenders in canonical order, negations as written', () => {
    expect(unsupportedLabelsFor('deck', ['trade', 'proxy', 'sale'])).toEqual(['sale', 'trade'])
    expect(unsupportedLabelsFor('deck', ['proxy', 'no-proxy'])).toEqual([])
    expect(unsupportedLabelsFor('deck', ['no-sale', 'no-proxy'])).toEqual(['no-sale'])
    expect(unsupportedLabelsFor('collection', ['proxy', 'keep', 'no-trade'])).toEqual([])
    expect(unsupportedLabelsFor('wanted', ['no-proxy'])).toEqual(['no-proxy'])
  })
})

describe('checkLabelsForListType', () => {
  // The one decision behind five guards — the CLI flags, the one-shot apply
  // path, the admin save bodies, the bundle importer, and the MCP schemas —
  // which had drifted into disagreeing about the empty set.
  test('a legal set passes', () => {
    expect(checkLabelsForListType('deck', ['proxy'])).toEqual({ ok: true })
    expect(checkLabelsForListType('collection', ['sale', 'trade'])).toEqual({ ok: true })
  })

  test('an illegal set is refused, naming only the offenders', () => {
    expect(checkLabelsForListType('deck', ['sale', 'proxy'])).toEqual({
      ok: false,
      unsupported: ['sale'],
    })
    expect(checkLabelsForListType('deck', ['no-sale'])).toEqual({
      ok: false,
      unsupported: ['no-sale'],
    })
    expect(checkLabelsForListType('deck', ['no-proxy'])).toEqual({ ok: true })
  })

  test('an empty set is a clear: legal wherever labels exist, refused on a wanted list', () => {
    expect(checkLabelsForListType('deck', [])).toEqual({ ok: true })
    expect(checkLabelsForListType('collection', [])).toEqual({ ok: true })
    expect(checkLabelsForListType('wanted', [])).toEqual({ ok: false, unsupported: [] })
  })

  test('the refusal wording names the offenders and the type’s vocabulary', () => {
    expect(keyedMessage(unsupportedLabelsMessage('deck', ['sale', 'trade']))).toBe(
      'labels [sale, trade] are not supported on a deck; supported: proxy.',
    )
    // Nothing to name on a type that carries none at all.
    expect(keyedMessage(unsupportedLabelsMessage('wanted', []))).toBe(
      'labels do not apply to a wanted list.',
    )
  })
})

describe('isProxy', () => {
  test('reads effective labels, and is false for an absent or unlabeled set', () => {
    expect(isProxy(['proxy'])).toBe(true)
    expect(isProxy(['sale', 'trade'])).toBe(false)
    expect(isProxy([])).toBe(false)
    expect(isProxy(undefined)).toBe(false)
  })
})

describe('pricelessReason', () => {
  test('custom art wins over the proxy label when both apply', () => {
    expect(pricelessReason(['proxy'], true)).toBe('custom-art')
    expect(pricelessReason(['proxy'], false)).toBe('proxy')
    expect(pricelessReason(undefined, true)).toBe('custom-art')
  })

  test('a card with neither prices normally', () => {
    expect(pricelessReason(['sale', 'trade'], false)).toBeUndefined()
    expect(pricelessReason(undefined, false)).toBeUndefined()
    expect(isPriceless(undefined, false)).toBe(false)
    expect(isPriceless(['keep'], true)).toBe(true)
  })
})

describe('normalizedOverride', () => {
  test('an empty or absent set is no override at all', () => {
    expect(normalizedOverride([])).toBeUndefined()
    expect(normalizedOverride(undefined)).toBeUndefined()
  })

  test('orders positives, then negatives, and drops void negatives', () => {
    expect(normalizedOverride(['trade', 'sale'])).toEqual(['sale', 'trade'])
    expect(normalizedOverride(['no-sale', 'trade'])).toEqual(['trade', 'no-sale'])
    expect(normalizedOverride(['keep', 'no-sale', 'no-proxy'])).toEqual(['keep'])
    expect(normalizedOverride(['no-keep', 'no-sale'])).toEqual(['no-sale', 'no-keep'])
  })

  test('never changes what an override means, under any default', () => {
    for (const type of ['deck', 'collection'] as const) {
      for (const override of legalOverrides(type)) {
        for (const listDefault of legalSets(type)) {
          expect(
            effectiveLabels(normalizedOverride(override), listDefault),
            `${show(override)} under ${show(listDefault)}`,
          ).toEqual(effectiveLabels(override, listDefault))
        }
      }
    }
  })
})

describe('readListDefaultLabels', () => {
  test('accepts a legal non-empty default', () => {
    expect(readListDefaultLabels('deck', ['proxy'])).toEqual({ labels: ['proxy'] })
    expect(readListDefaultLabels('collection', ['trade', 'sale'])).toEqual({
      labels: ['sale', 'trade'],
    })
  })

  test('an empty list says "no default" without complaint', () => {
    expect(readListDefaultLabels('deck', [])).toEqual({})
  })

  test('an unreadable or unsupported value warns that a rewrite drops the key', () => {
    const unsupported = readListDefaultLabels('deck', ['sale'])
    expect(unsupported.labels).toBeUndefined()
    expect(unsupported.warning && keyedMessage(unsupported.warning)).toBe(
      "Front matter 'labels' ignored: labels [sale] are not supported on a deck; supported: proxy. A rewrite would drop the key.",
    )

    const malformed = readListDefaultLabels('deck', 'proxy')
    expect(malformed.labels).toBeUndefined()
    expect(malformed.warning && keyedMessage(malformed.warning)).toBe(
      "Front matter 'labels' ignored: labels must be an array of labels (sale, trade, keep, proxy). A rewrite would drop the key.",
    )
  })
})

describe('labelFiltersFor', () => {
  test('offers each type’s labels plus the unlabeled chip, in canonical order', () => {
    expect(labelFiltersFor('deck')).toEqual(['proxy', 'none'])
    expect(labelFiltersFor('collection')).toEqual(['sale', 'trade', 'keep', 'proxy', 'none'])
  })

  test('a type that carries no labels offers no chips at all', () => {
    // Empty is what hides the filter row — and what makes every `labels=` URL
    // value dropped on a wanted list.
    expect(labelFiltersFor('wanted')).toEqual([])
  })
})

describe('cardLabelChoicesFor', () => {
  const rows = (type: ListType, listDefault?: CardLabel[]) =>
    cardLabelChoicesFor(type, listDefault).map((choice) =>
      choice.labels === 'default' ? 'default' : [...choice.labels],
    )

  test('a deck offers proxy, "Not a proxy" under a proxy default, and the clear row', () => {
    expect(rows('deck')).toEqual([['proxy'], 'default'])
    expect(rows('deck', ['proxy'])).toEqual([['proxy'], [], 'default'])
    expect(cardLabelChoicesFor('deck', ['proxy'])[1]!.label).toBe('domain.label.notProxy')
  })

  test('a collection offers the whole vocabulary, plus "No labels" under a default', () => {
    expect(rows('collection')).toEqual([
      ['sale'],
      ['trade'],
      ['sale', 'trade'],
      ['keep'],
      ['proxy'],
      'default',
    ])
    expect(rows('collection', ['sale'])).toEqual([
      ['sale'],
      ['trade'],
      ['sale', 'trade'],
      ['keep'],
      ['proxy'],
      [],
      'default',
    ])
    expect(cardLabelChoicesFor('collection', ['sale'])[5]!.label).toBe('domain.label.noLabels')
  })

  test('a wanted list offers nothing but the clear row', () => {
    expect(rows('wanted', ['sale'])).toEqual(['default'])
  })
})

describe('overrideForChoice', () => {
  test('writes the minimal override for the picked state, or the clear', () => {
    expect(overrideForChoice('default', ['sale'])).toEqual([])
    expect(overrideForChoice(['sale'], ['sale'])).toEqual([])
    expect(overrideForChoice(['sale', 'trade'], ['sale'])).toEqual(['trade'])
    expect(overrideForChoice(['trade'], ['sale'])).toEqual(['trade', 'no-sale'])
    expect(overrideForChoice([], ['proxy'])).toEqual(['no-proxy'])
    expect(overrideForChoice(['keep'], ['sale', 'trade'])).toEqual(['keep'])
  })
})

describe('currentLabelChoice', () => {
  const choices = cardLabelChoicesFor('collection', ['sale', 'trade'])

  test('marks the clear row for a card with no override', () => {
    expect(currentLabelChoice(choices, undefined, ['sale', 'trade'])?.labels).toBe('default')
  })

  test('a redundant override still marks the row of its effective labels', () => {
    expect(currentLabelChoice(choices, ['sale'], ['sale', 'trade'])?.labels).toEqual([
      'sale',
      'trade',
    ])
  })

  test('marks nothing when no row holds the effective state', () => {
    const noDefault = cardLabelChoicesFor('collection', undefined)
    expect(currentLabelChoice(noDefault, ['no-sale'], undefined)).toBeUndefined()
  })

  test('marks the row equal to the card’s effective labels', () => {
    expect(currentLabelChoice(choices, ['no-trade'], ['sale', 'trade'])?.labels).toEqual(['sale'])
    expect(currentLabelChoice(choices, ['no-sale', 'no-trade'], ['sale', 'trade'])?.labels).toEqual(
      [],
    )
  })
})

describe('cardLabelDefaultChoicesFor', () => {
  test('leads with the clear row and drops the "use list default" row', () => {
    const deck = cardLabelDefaultChoicesFor('deck')
    expect(deck.map((choice) => [...choice.labels])).toEqual([[], ['proxy']])
    expect(deck[0]!.label).toBe('domain.label.noDefault')
  })
})

describe('formatCardLabels / formatLabelOverride', () => {
  test('joins in canonical order regardless of input order', () => {
    expect(formatCardLabels(['trade', 'sale'])).toBe('sale,trade')
    expect(formatCardLabels(['keep'])).toBe('keep')
    expect(formatLabelOverride(['no-sale', 'trade'])).toBe('trade,no-sale')
  })
})

describe('effectiveLabels', () => {
  // The line adjusts its list's default: its positives are added, its
  // negatives take inherited labels away, and an added label displaces any
  // inherited label it cannot stand beside.
  test.each<[LabelOverride | undefined, CardLabel[] | undefined, CardLabel[]]>([
    [undefined, undefined, []],
    [undefined, ['sale'], ['sale']],
    [undefined, ['sale', 'trade'], ['sale', 'trade']],
    [['trade'], undefined, ['trade']],
    [['trade'], ['sale'], ['sale', 'trade']],
    [['sale'], ['sale'], ['sale']],
    [['trade', 'no-sale'], ['sale'], ['trade']],
    [['no-sale'], ['sale', 'trade'], ['trade']],
    [['no-sale', 'no-trade'], ['sale', 'trade'], []],
    [['no-sale'], undefined, []],
    [['keep'], ['sale', 'trade'], ['keep']],
    [['proxy'], ['sale'], ['proxy']],
    [['sale'], ['keep'], ['sale']],
    [['sale', 'trade'], ['proxy'], ['sale', 'trade']],
    [['no-keep'], ['keep'], []],
    [['proxy'], undefined, ['proxy']],
    [['proxy'], ['proxy'], ['proxy']],
    [['no-proxy'], ['proxy'], []],
    [['no-proxy'], undefined, []],
  ])('%p under %p is %p', (override, listDefault, expected) => {
    expect(effectiveLabels(override, listDefault)).toEqual(expected)
  })

  test('every legal override under every legal default resolves to a legal set by the rule', () => {
    for (const type of ['deck', 'collection'] as const) {
      for (const override of legalOverrides(type)) {
        for (const listDefault of legalSets(type)) {
          const where = `${show(override)} under ${show(listDefault)}`
          const effective = effectiveLabels(override, listDefault)
          const added = override.filter((l): l is CardLabel => isCardLabel(l))
          const removed = override.filter((l) => l.startsWith('no-')).map((l) => l.slice(3))
          expect(labelOverrideConflict(effective), where).toBeUndefined()
          // every positive lands; no negated label survives
          for (const label of added) expect(effective, where).toContain(label)
          for (const label of removed) expect(effective as string[], where).not.toContain(label)
          // nothing appears that neither the line nor the default gave
          for (const label of effective) {
            expect([...added, ...listDefault], where).toContain(label)
          }
          // an inherited label survives exactly when it is not negated and the
          // line's positives can stand beside it
          for (const label of listDefault) {
            const survives =
              !removed.includes(label) &&
              labelOverrideConflict(normalizeCardLabels([...added, label])) === undefined
            expect(effective.includes(label), `${where}: ${label}`).toBe(survives)
          }
        }
      }
    }
  })
})

describe('minimalOverride', () => {
  test.each<[CardLabel[], CardLabel[] | undefined, LabelOverride | undefined]>([
    [['sale'], ['sale'], undefined],
    [[], undefined, undefined],
    [['sale', 'trade'], ['sale'], ['trade']],
    [['trade'], ['sale'], ['trade', 'no-sale']],
    [['sale'], ['sale', 'trade'], ['no-trade']],
    [[], ['sale', 'trade'], ['no-sale', 'no-trade']],
    [['keep'], ['sale'], ['keep']],
    [['sale'], ['keep'], ['sale']],
    [['sale'], undefined, ['sale']],
    [[], ['proxy'], ['no-proxy']],
    [['proxy'], undefined, ['proxy']],
  ])('%p under %p is written %p', (target, listDefault, expected) => {
    expect(minimalOverride(target, listDefault)).toEqual(expected)
  })

  test('round-trips every legal target under every legal default, and nothing shorter does', () => {
    for (const type of ['deck', 'collection'] as const) {
      const overrides = legalOverrides(type)
      for (const target of legalSets(type)) {
        for (const listDefault of legalSets(type)) {
          const where = `${show(target)} under ${show(listDefault)}`
          const written = minimalOverride(target, listDefault)
          expect(effectiveLabels(written, listDefault), where).toEqual(target)
          const shortest = Math.min(
            ...[[], ...overrides]
              .filter(
                (o) =>
                  formatCardLabels(effectiveLabels(o, listDefault)) === formatCardLabels(target),
              )
              .map((o) => o.length),
          )
          expect(written?.length ?? 0, where).toBe(shortest)
        }
      }
    }
  })
})

describe('carriedLabels', () => {
  test.each<[LabelOverride | undefined, CardLabel[] | undefined, LabelOverride | undefined]>([
    // an unlabelled card in a list with no default states nothing
    [undefined, undefined, undefined],
    // the default is stated: present labels positive
    [undefined, ['sale', 'trade'], ['sale', 'trade']],
    // a stated label the copy lacks is carried negated
    [['no-sale'], ['sale'], ['no-sale']],
    [['no-sale'], undefined, ['no-sale']],
    [['trade', 'no-sale'], ['sale'], ['trade', 'no-sale']],
    // displaced inherited labels are void beside an exclusive positive
    [['keep'], ['sale', 'trade'], ['keep']],
    [['no-proxy'], ['proxy'], ['no-proxy']],
    // a negation of a label the default does not hold is still a stated absence
    [['no-trade'], ['sale'], ['sale', 'no-trade']],
  ])('%p under %p carries %p', (override, listDefault, expected) => {
    expect(carriedLabels(override, listDefault)).toEqual(expected)
  })

  test('its positives are always the effective labels in the source', () => {
    for (const type of ['deck', 'collection'] as const) {
      for (const override of legalOverrides(type)) {
        for (const listDefault of legalSets(type)) {
          expect(
            carriedEffectiveLabels(carriedLabels(override, listDefault)),
            `${show(override)} under ${show(listDefault)}`,
          ).toEqual(effectiveLabels(override, listDefault))
        }
      }
    }
  })
})

describe('arrivalLabels', () => {
  // The owner's pinned examples: proxy is a physical fact, preserved wherever
  // both types carry it; an intent label keeps its state where the source had
  // an opinion on it, and otherwise takes the destination's default.
  const SALE_TRADE: CardLabel[] = ['sale', 'trade']
  test.each<
    [
      string,
      ListType,
      LabelOverride | undefined,
      CardLabel[] | undefined,
      ListType,
      CardLabel[] | undefined,
      LabelOverride | undefined,
    ]
  >([
    [
      'an unlabelled card from a no-default collection into a sale,trade binder',
      'collection',
      undefined,
      undefined,
      'collection',
      SALE_TRADE,
      undefined,
    ],
    [
      'a [no-sale] card from a sale binder into another sale binder',
      'collection',
      ['no-sale'],
      ['sale'],
      'collection',
      ['sale'],
      ['no-sale'],
    ],
    [
      'a card from a sale,trade binder into a no-default collection',
      'collection',
      undefined,
      SALE_TRADE,
      'collection',
      undefined,
      ['sale', 'trade'],
    ],
    [
      'a real card from a plain deck into a proxy-default collection',
      'deck',
      undefined,
      undefined,
      'collection',
      ['proxy'],
      ['no-proxy'],
    ],
    [
      'a [keep] card into a sale,trade binder',
      'collection',
      ['keep'],
      undefined,
      'collection',
      SALE_TRADE,
      ['keep'],
    ],
    [
      'a deck [proxy] card into a sale binder',
      'deck',
      ['proxy'],
      undefined,
      'collection',
      ['sale'],
      ['proxy'],
    ],
    [
      'a real card from a plain deck into a sale,trade binder',
      'deck',
      undefined,
      undefined,
      'collection',
      SALE_TRADE,
      undefined,
    ],
    [
      'a [sale] collection card into a proxy-default deck',
      'collection',
      ['sale'],
      undefined,
      'deck',
      ['proxy'],
      ['no-proxy'],
    ],
    [
      'a proxy from a proxy-default deck into a plain deck',
      'deck',
      undefined,
      ['proxy'],
      'deck',
      undefined,
      ['proxy'],
    ],
    [
      'a [trade] card from a sale binder into a keep-default collection',
      'collection',
      ['trade'],
      ['sale'],
      'collection',
      ['keep'],
      ['sale', 'trade'],
    ],
    [
      'anything into a wanted list',
      'collection',
      ['proxy'],
      undefined,
      'wanted',
      undefined,
      undefined,
    ],
  ])('%s', (_, sourceType, override, sourceDefault, destType, destDefault, expected) => {
    const carried = carriedLabels(override, sourceDefault)
    expect(arrivalLabels(destType, carried, destDefault, sourceType)).toEqual(expected)
  })

  test('a wanted-list source states nothing, so the copy takes the destination default whole', () => {
    expect(arrivalLabels('collection', undefined, ['proxy'], 'wanted')).toBeUndefined()
    expect(arrivalLabels('collection', undefined, ['proxy'], undefined)).toBeUndefined()
  })

  test('an older payload of positives alone states exactly those labels', () => {
    // carried ['sale'] from a collection: sale stated present, trade unstated
    expect(arrivalLabels('collection', ['sale'], SALE_TRADE, 'collection')).toBeUndefined()
    expect(arrivalLabels('collection', ['sale'], ['trade'], 'collection')).toEqual(['sale'])
  })

  test('lands the carried state wherever the destination type can express it', () => {
    for (const sourceType of ['deck', 'collection'] as const) {
      for (const override of [undefined, ...legalOverrides(sourceType)]) {
        for (const sourceDefault of legalSets(sourceType)) {
          const carried = carriedLabels(override, sourceDefault)
          const sourceEffective = effectiveLabels(override, sourceDefault)
          for (const destType of ['deck', 'collection'] as const) {
            for (const destDefault of legalSets(destType)) {
              const where = `${show(override)} under ${show(sourceDefault)} → ${destType} ${show(destDefault)}`
              const landed = effectiveLabels(
                arrivalLabels(destType, carried, destDefault, sourceType),
                destDefault,
              )
              // proxy is a physical fact: preserved wherever both types carry it
              expect(landed.includes('proxy'), where).toBe(sourceEffective.includes('proxy'))
              const accepted = LIST_TYPE_LABELS[destType] as readonly CardLabel[]
              const kept = sourceEffective.filter((label) => accepted.includes(label))
              // every carried positive the destination accepts lands
              for (const label of kept) expect(landed, where).toContain(label)
              // an intent label keeps the source's stated absence, and an
              // unstated one takes the destination's default where the kept
              // labels can stand beside it
              const mentioned = [...sourceDefault, ...overrideBaseLabels(override ?? [])]
              for (const label of accepted.filter((l) => l !== 'proxy')) {
                if (mentioned.includes(label)) {
                  if (!sourceEffective.includes(label)) {
                    expect(landed as string[], `${where}: ${label}`).not.toContain(label)
                  }
                } else if (
                  labelOverrideConflict(normalizeCardLabels([...kept, label])) === undefined
                ) {
                  expect(landed.includes(label), `${where}: ${label}`).toBe(
                    destDefault.includes(label),
                  )
                }
              }
            }
          }
        }
      }
    }
  })
})

describe('cardLabelName / signedLabelName', () => {
  test('spells the agreed wording', () => {
    expect(cardLabelName('sale')).toBe('For sale')
    expect(cardLabelName('trade')).toBe('For trade')
    expect(cardLabelName('keep')).toBe('To keep')
    expect(cardLabelName('proxy')).toBe('Proxy')
    const negated: SignedCardLabel[] = ['no-sale', 'no-trade', 'no-keep', 'no-proxy']
    expect(negated.map(signedLabelName)).toEqual([
      'Not for sale',
      'Not for trade',
      'Not to keep',
      'Not a proxy',
    ])
    expect(signedLabelName('trade')).toBe('For trade')
  })
})
