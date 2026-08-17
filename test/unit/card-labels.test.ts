import { describe, expect, test } from 'bun:test'
import {
  cardLabelChoicesFor,
  cardLabelDefaultChoicesFor,
  cardLabelName,
  CARD_LABELS,
  checkLabelsForListType,
  effectiveLabels,
  EXCLUSIVE_CARD_LABELS,
  formatCardLabels,
  isCardLabel,
  isPriceless,
  isProxy,
  pricelessReason,
  labelFiltersFor,
  LIST_TYPE_LABELS,
  normalizeCardLabels,
  normalizedOverride,
  parseCardLabelsToken,
  parseCardLabelsValue,
  readListDefaultLabels,
  supportedLabelsFor,
  supportsAnyLabels,
  unsupportedLabelsFor,
  unsupportedLabelsMessage,
} from '../../src/card-labels'

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

describe('parseCardLabelsToken', () => {
  test('parses a single label', () => {
    expect(parseCardLabelsToken('sale')).toEqual({ ok: true, labels: ['sale'] })
  })

  test('parses a pair and normalizes the order', () => {
    expect(parseCardLabelsToken('trade,sale')).toEqual({ ok: true, labels: ['sale', 'trade'] })
  })

  test('dedupes repeated labels', () => {
    expect(parseCardLabelsToken('sale,sale')).toEqual({ ok: true, labels: ['sale'] })
  })

  test('is case-insensitive like every enum surface', () => {
    expect(parseCardLabelsToken('SALE,Trade')).toEqual({ ok: true, labels: ['sale', 'trade'] })
  })

  test('refuses keep combined with sale or trade', () => {
    const result = parseCardLabelsToken('sale,keep')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("'keep' cannot be combined")
  })

  test('refuses proxy combined with anything, keep included', () => {
    const withTrade = parseCardLabelsToken('proxy,trade')
    expect(withTrade.ok).toBe(false)
    if (!withTrade.ok) expect(withTrade.message).toContain("'proxy' cannot be combined")
    expect(parseCardLabelsToken('keep,proxy').ok).toBe(false)
  })

  test('parses proxy on its own', () => {
    expect(parseCardLabelsToken('PROXY')).toEqual({ ok: true, labels: ['proxy'] })
  })

  test('refuses unknown members', () => {
    const result = parseCardLabelsToken('sale,sell')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("'sell'")
  })

  test('refuses an empty body and dangling commas', () => {
    expect(parseCardLabelsToken('').ok).toBe(false)
    expect(parseCardLabelsToken('sale,').ok).toBe(false)
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

  test('unsupportedLabelsFor names the offenders in canonical order', () => {
    expect(unsupportedLabelsFor('deck', ['trade', 'proxy', 'sale'])).toEqual(['sale', 'trade'])
    expect(unsupportedLabelsFor('deck', ['proxy'])).toEqual([])
    expect(unsupportedLabelsFor('collection', ['proxy', 'keep'])).toEqual([])
    expect(unsupportedLabelsFor('wanted', ['proxy'])).toEqual(['proxy'])
  })

  test('supportedLabelsFor keeps what the destination can express', () => {
    expect(supportedLabelsFor('deck', ['trade', 'proxy', 'sale'])).toEqual(['proxy'])
    expect(supportedLabelsFor('collection', ['trade', 'sale'])).toEqual(['sale', 'trade'])
    expect(supportedLabelsFor('wanted', ['proxy'])).toEqual([])
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
  })

  test('an empty set is a clear: legal wherever labels exist, refused on a wanted list', () => {
    expect(checkLabelsForListType('deck', [])).toEqual({ ok: true })
    expect(checkLabelsForListType('collection', [])).toEqual({ ok: true })
    expect(checkLabelsForListType('wanted', [])).toEqual({ ok: false, unsupported: [] })
  })

  test('the refusal wording names the offenders and the type’s vocabulary', () => {
    expect(unsupportedLabelsMessage('deck', ['sale', 'trade'])).toBe(
      'labels [sale, trade] are not supported on a deck; supported: proxy.',
    )
    // Nothing to name on a type that carries none at all.
    expect(unsupportedLabelsMessage('wanted', [])).toBe('labels do not apply to a wanted.')
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

  test('a present set is canonically ordered', () => {
    expect(normalizedOverride(['trade', 'sale'])).toEqual(['sale', 'trade'])
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
    expect(unsupported.warning).toContain('labels [sale] are not supported on a deck')
    expect(unsupported.warning).toContain('A rewrite would drop the key.')

    const malformed = readListDefaultLabels('deck', 'proxy')
    expect(malformed.labels).toBeUndefined()
    expect(malformed.warning).toContain("Front matter 'labels' ignored")
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
  test('a deck offers only proxy and the clear row', () => {
    expect(cardLabelChoicesFor('deck').map((choice) => [...choice.labels])).toEqual([['proxy'], []])
  })

  test('a collection offers the whole vocabulary', () => {
    expect(cardLabelChoicesFor('collection').map((choice) => [...choice.labels])).toEqual([
      ['sale'],
      ['trade'],
      ['sale', 'trade'],
      ['keep'],
      ['proxy'],
      [],
    ])
  })

  test('a wanted list offers nothing but the clear row', () => {
    expect(cardLabelChoicesFor('wanted').map((choice) => [...choice.labels])).toEqual([[]])
  })
})

describe('cardLabelDefaultChoicesFor', () => {
  test('leads with the clear row and drops the "use list default" row', () => {
    const deck = cardLabelDefaultChoicesFor('deck')
    expect(deck.map((choice) => [...choice.labels])).toEqual([[], ['proxy']])
    expect(deck[0]!.label).toBe('domain.label.noDefault')
  })
})

describe('formatCardLabels', () => {
  test('joins in canonical order regardless of input order', () => {
    expect(formatCardLabels(['trade', 'sale'])).toBe('sale,trade')
    expect(formatCardLabels(['keep'])).toBe('keep')
  })
})

describe('effectiveLabels', () => {
  test('a present override replaces the list default entirely', () => {
    expect(effectiveLabels(['keep'], ['sale', 'trade'])).toEqual(['keep'])
  })

  test('falls back to the list default when there is no override', () => {
    expect(effectiveLabels(undefined, ['sale'])).toEqual(['sale'])
  })

  test('empty when neither is present', () => {
    expect(effectiveLabels(undefined, undefined)).toEqual([])
  })
})

describe('cardLabelName', () => {
  test('spells the agreed wording', () => {
    expect(cardLabelName('sale')).toBe('For sale')
    expect(cardLabelName('trade')).toBe('For trade')
    expect(cardLabelName('keep')).toBe('To keep')
    expect(cardLabelName('proxy')).toBe('Proxy')
  })
})
