import { describe, test, expect } from 'bun:test'
import {
  type ListViewDefaults,
  type ListViewState,
  hasListViewParams,
  parseListViewParams,
  withLabelsParam,
  writeListViewParams,
} from '../../src/site/list-view-url'
import { type CardFilters, createDefaultCardFilters } from '../../src/site/card-filters'

const DEFAULTS: ListViewDefaults = { groupBy: 'type', sortBy: 'name' }

function defaultState(overrides?: Partial<ListViewState>): ListViewState {
  return {
    viewMode: 'binder',
    cardSize: 'large',
    groupBy: 'type',
    sortLayers: [{ sortBy: 'name', reverse: false }],
    reverseGroups: false,
    priceGroupStrategy: 'archidekt',
    sellMode: false,
    buyer: 'cardkingdom',
    filters: createDefaultCardFilters(),
    ...overrides,
  }
}

function encode(state: ListViewState, defaults: ListViewDefaults = DEFAULTS): URLSearchParams {
  const params = new URLSearchParams()
  writeListViewParams(params, state, defaults)
  return params
}

/** One row per numeric filter (mana value, price, copies); they share identical gating. */
type NumericFilterCase = {
  key: 'manaValue' | 'price' | 'copies'
  opKey: 'manaValueOp' | 'priceOp' | 'copiesOp'
  param: string
  opParam: string
  /** Representative non-zero value (also used as the URL token). */
  value: number
}

const NUMERIC_FILTERS: NumericFilterCase[] = [
  { key: 'manaValue', opKey: 'manaValueOp', param: 'mv', opParam: 'mvOp', value: 3 },
  { key: 'price', opKey: 'priceOp', param: 'price', opParam: 'priceOp', value: 5.25 },
  { key: 'copies', opKey: 'copiesOp', param: 'copies', opParam: 'copiesOp', value: 2 },
]

describe('writeListViewParams', () => {
  test('a fully default state writes no parameters', () => {
    expect(encode(defaultState()).toString()).toBe('')
  })

  test('only non-default toolbar values are written', () => {
    const params = encode(
      defaultState({
        viewMode: 'list',
        cardSize: 'small',
        groupBy: 'cmc',
        sortLayers: [{ sortBy: 'price', reverse: true }],
        reverseGroups: true,
        priceGroupStrategy: 'ten',
      }),
    )
    expect(params.get('view')).toBe('list')
    expect(params.get('size')).toBe('small')
    expect(params.get('group')).toBe('cmc')
    // A single reversed layer encodes as the field with a leading '-'.
    expect(params.get('sort')).toBe('-price')
    expect(params.get('revSections')).toBe('1')
    expect(params.get('bracket')).toBe('ten')
  })

  test('a reversed layer on the default field is still written (direction deviates)', () => {
    // DEFAULTS.sortBy is 'name'; a single non-reversed 'name' layer is omitted, but
    // reversing it deviates from the default and must survive as '-name'.
    const params = encode(defaultState({ sortLayers: [{ sortBy: 'name', reverse: true }] }))
    expect(params.get('sort')).toBe('-name')
  })

  test('multiple sort layers encode as a comma-separated list', () => {
    const params = encode(
      defaultState({
        sortLayers: [
          { sortBy: 'name', reverse: false },
          { sortBy: 'price', reverse: true },
          { sortBy: 'cmc', reverse: false },
        ],
      }),
    )
    expect(params.get('sort')).toBe('name,-price,cmc')
  })

  test('group and sort matching the page defaults are omitted', () => {
    const params = encode(defaultState({ groupBy: 'type' }), {
      groupBy: 'type',
      sortBy: 'name',
    })
    expect(params.has('group')).toBe(false)
    expect(params.has('sort')).toBe(false)
  })

  test('a value equal to a non-default page default is omitted', () => {
    // Page default group is 'section'; selecting 'section' should not appear.
    const params = encode(defaultState({ groupBy: 'section' }), {
      groupBy: 'section',
      sortBy: 'file-order',
    })
    expect(params.has('group')).toBe(false)
  })

  test('active filters are written; colors join in canonical order', () => {
    const filters = createDefaultCardFilters()
    filters.hideLands = true
    filters.name = ' bolt '
    filters.colors = ['W', 'U', 'B']
    filters.setCodes = ['mkm', 'lea']
    filters.cardTypes = ['instant', 'goblin']
    filters.manaValue = 3
    const params = encode(defaultState({ filters }))
    expect(params.get('noLands')).toBe('1')
    expect(params.get('name')).toBe('bolt')
    expect(params.get('colors')).toBe('WUB')
    expect(params.get('sets')).toBe('mkm,lea')
    expect(params.get('types')).toBe('instant,goblin')
    expect(params.get('mv')).toBe('3')
  })

  test("colorless is written into the colors param as a leading 'C' and round-trips", () => {
    const filters = createDefaultCardFilters()
    filters.colorless = true
    // Colorless alone still activates the color filter, with no WUBRG letters.
    expect(encode(defaultState({ filters })).get('colors')).toBe('C')

    filters.colors = ['W', 'U']
    const params = encode(defaultState({ filters }))
    expect(params.get('colors')).toBe('CWU')

    const parsed = parseListViewParams(params)
    expect(parsed.filters?.colorless).toBe(true)
    expect(parsed.filters?.colors).toEqual(['W', 'U'])
  })

  // The colors param and its colorMode sub-option share one "is the color filter
  // active" check, so a colorless-only selection must still carry a non-default mode.
  test('a colorless-only selection still writes a non-default colorMode', () => {
    const filters = createDefaultCardFilters()
    filters.colorless = true
    filters.colorMode = 'exclude'
    const params = encode(defaultState({ filters }))
    expect(params.get('colors')).toBe('C')
    expect(params.get('colorMode')).toBe('exclude')
  })

  test('filter sub-options are written only when their parent filter is active', () => {
    const filters = createDefaultCardFilters()
    filters.colorMode = 'exact'
    filters.setCodeMode = 'exclude'
    filters.cardTypeMode = 'exclude'
    filters.manaValueOp = '>='
    // No colors / sets / types / manaValue set, so the sub-options stay out of the URL.
    expect(encode(defaultState({ filters })).toString()).toBe('')

    filters.colors = ['R']
    filters.setCodes = ['mkm']
    filters.cardTypes = ['dragon']
    filters.manaValue = 5
    const params = encode(defaultState({ filters }))
    expect(params.get('colorMode')).toBe('exact')
    expect(params.get('setMode')).toBe('exclude')
    expect(params.get('typeMode')).toBe('exclude')
    expect(params.get('mvOp')).toBe('>=')
  })

  test('sub-options at their default stay out of the URL even when the parent is active', () => {
    const filters = createDefaultCardFilters()
    filters.colors = ['R'] // colorMode left at default 'subset'
    filters.setCodes = ['mkm'] // setCodeMode left at default 'include'
    filters.cardTypes = ['dragon'] // cardTypeMode left at default 'exact'
    filters.manaValue = 5 // manaValueOp left at default '='
    const params = encode(defaultState({ filters }))
    expect(params.has('colorMode')).toBe(false)
    expect(params.has('setMode')).toBe(false)
    expect(params.has('typeMode')).toBe(false)
    expect(params.has('mvOp')).toBe(false)
  })

  // Mana value, price, and copies share the same write gating: the value is
  // written whenever set (including 0 — a meaningful filter, not "unset"), and
  // the operator only alongside a value and only when non-default.
  for (const { key, opKey, param, opParam, value } of NUMERIC_FILTERS) {
    test(`an active ${param} filter and its non-default operator are written`, () => {
      const filters = createDefaultCardFilters()
      filters[key] = value
      filters[opKey] = '>='
      const params = encode(defaultState({ filters }))
      expect(params.get(param)).toBe(String(value))
      expect(params.get(opParam)).toBe('>=')
    })

    test(`${opParam} at its default stays out of the URL, and a ${param} of 0 is written`, () => {
      const filters = createDefaultCardFilters()
      filters[key] = 0 // operator left at default '='
      const params = encode(defaultState({ filters }))
      expect(params.get(param)).toBe('0')
      expect(params.has(opParam)).toBe(false)
    })

    test(`${opParam} alone (no ${param}) stays out of the URL`, () => {
      const filters = createDefaultCardFilters()
      filters[opKey] = '>='
      expect(encode(defaultState({ filters })).has(opParam)).toBe(false)
    })
  }

  // The copies match mode is gated like the comparators above — it only means
  // something alongside a copies value.
  test('a non-default copiesMode is written only alongside a copies value', () => {
    const filters = createDefaultCardFilters()
    filters.copiesMode = 'exact'
    expect(encode(defaultState({ filters })).has('copiesMode')).toBe(false)
    filters.copies = 2
    expect(encode(defaultState({ filters })).get('copiesMode')).toBe('exact')
  })

  test('oracle and art tag selections and their non-default sub-options are written', () => {
    const filters = createDefaultCardFilters()
    filters.oracleTags = ['ramp', 'mana-rock']
    filters.oracleTagMode = 'exclude'
    filters.artTags = ['dragon']
    // artTagMode left at default, so it stays out of the URL.
    const params = encode(defaultState({ filters }))
    expect(params.get('otags')).toBe('ramp,mana-rock')
    expect(params.get('otagMode')).toBe('exclude')
    expect(params.get('atags')).toBe('dragon')
    expect(params.has('atagMode')).toBe(false)
  })

  test('writing onto existing params clears keys that returned to default', () => {
    const params = new URLSearchParams('group=cmc&noLands=1&lists=deck:a')
    writeListViewParams(params, defaultState(), DEFAULTS)
    expect(params.has('group')).toBe(false)
    expect(params.has('noLands')).toBe(false)
    // Foreign keys (e.g. the combined view's list selection) are preserved.
    expect(params.get('lists')).toBe('deck:a')
  })
})

describe('parseListViewParams', () => {
  test('copiesMode is only applied alongside a copies value, and must be a known mode', () => {
    expect(parseListViewParams(new URLSearchParams('copiesMode=exact')).filters).toBeUndefined()
    expect(parseListViewParams(new URLSearchParams('copies=2&copiesMode=banana')).filters).toEqual({
      copies: 2,
    })
  })
  test('round-trips a fully populated state', () => {
    const filters = createDefaultCardFilters()
    filters.hideLands = true
    filters.hideUnpriced = true
    filters.hideExtras = true
    filters.name = 'bolt'
    filters.colors = ['U', 'R']
    filters.colorMode = 'exact'
    filters.setCodes = ['mkm', 'lea']
    filters.setCodeMode = 'exclude'
    filters.cardTypes = ['instant', 'goblin']
    filters.cardTypeMode = 'exclude'
    filters.oracleTags = ['ramp', 'mana-rock']
    filters.oracleTagMode = 'exclude'
    filters.artTags = ['dragon']
    // artTagMode left at default to verify it stays absent from the round-trip.
    filters.manaValue = 4
    filters.manaValueOp = '<='
    filters.price = 5.25
    filters.priceOp = '>='
    filters.copies = 2
    filters.copiesOp = '>='
    filters.copiesMode = 'number'
    const state = defaultState({
      viewMode: 'overlap',
      cardSize: 'medium',
      groupBy: 'price',
      sortLayers: [{ sortBy: 'edhrec', reverse: true }],
      reverseGroups: true,
      priceGroupStrategy: 'five',
      filters,
    })

    const parsed = parseListViewParams(encode(state))
    expect(parsed.viewMode).toBe('overlap')
    expect(parsed.cardSize).toBe('medium')
    expect(parsed.groupBy).toBe('price')
    expect(parsed.sortLayers).toEqual([{ sortBy: 'edhrec', reverse: true }])
    expect(parsed.reverseGroups).toBe(true)
    expect(parsed.priceGroupStrategy).toBe('five')
    expect(parsed.filters).toEqual({
      hideLands: true,
      hideUnpriced: true,
      hideExtras: true,
      name: 'bolt',
      colors: ['U', 'R'],
      colorMode: 'exact',
      setCodes: ['mkm', 'lea'],
      setCodeMode: 'exclude',
      cardTypes: ['instant', 'goblin'],
      cardTypeMode: 'exclude',
      oracleTags: ['ramp', 'mana-rock'],
      oracleTagMode: 'exclude',
      artTags: ['dragon'],
      manaValue: 4,
      manaValueOp: '<=',
      price: 5.25,
      priceOp: '>=',
      copies: 2,
      copiesOp: '>=',
      copiesMode: 'number',
    })
  })

  test('empty params parse to no overrides', () => {
    const parsed = parseListViewParams(new URLSearchParams(''))
    expect(parsed).toEqual({})
  })

  test('invalid enum values are ignored', () => {
    const params = new URLSearchParams(
      'view=banana&group=spaghetti&sort=chaos&bracket=infinite&colorMode=maybe',
    )
    expect(parseListViewParams(params)).toEqual({})
  })

  test('a multi-layer sort round-trips, dropping unknown and duplicate fields', () => {
    // `chaos` is not a sort field and the second `name` is a duplicate — both dropped.
    const parsed = parseListViewParams(new URLSearchParams('sort=name,-price,chaos,name'))
    expect(parsed.sortLayers).toEqual([
      { sortBy: 'name', reverse: false },
      { sortBy: 'price', reverse: true },
    ])
  })

  test('a sort param with no recognized fields yields no sort override', () => {
    expect(
      parseListViewParams(new URLSearchParams('sort=chaos,-nonsense')).sortLayers,
    ).toBeUndefined()
  })

  test('colors are normalized to canonical WUBRG order and deduped', () => {
    const parsed = parseListViewParams(new URLSearchParams('colors=grw'))
    expect(parsed.filters?.colors).toEqual(['W', 'R', 'G'])
  })

  test('non-color letters in the colors param are dropped', () => {
    const parsed = parseListViewParams(new URLSearchParams('colors=xWqU'))
    expect(parsed.filters?.colors).toEqual(['W', 'U'])
    expect(parsed.filters?.colorless).toBeUndefined()
  })

  test("colorless rides in the colors param as 'C', alone or alongside colors", () => {
    const alone = parseListViewParams(new URLSearchParams('colors=C'))
    expect(alone.filters?.colorless).toBe(true)
    expect(alone.filters?.colors).toBeUndefined()

    const mixed = parseListViewParams(new URLSearchParams('colors=CG'))
    expect(mixed.filters?.colorless).toBe(true)
    expect(mixed.filters?.colors).toEqual(['G'])
  })

  // Mana value and copies share one integer parser (parseIntegerParam), so its
  // rejection and zero handling are pinned once via mv rather than re-run per filter.
  test('a non-integer mana value is ignored', () => {
    expect(parseListViewParams(new URLSearchParams('mv=abc')).filters).toBeUndefined()
    expect(parseListViewParams(new URLSearchParams('mv=2.5')).filters).toBeUndefined()
  })

  test('a mana value of 0 parses to 0, not undefined', () => {
    expect(parseListViewParams(new URLSearchParams('mv=0')).filters).toEqual({ manaValue: 0 })
  })

  test('a price with up to two decimals parses; more decimals or junk are ignored', () => {
    expect(parseListViewParams(new URLSearchParams('price=5.25')).filters).toEqual({ price: 5.25 })
    expect(parseListViewParams(new URLSearchParams('price=0')).filters).toEqual({ price: 0 })
    expect(parseListViewParams(new URLSearchParams('price=1.234')).filters).toBeUndefined()
    expect(parseListViewParams(new URLSearchParams('price=abc')).filters).toBeUndefined()
  })

  // Each numeric filter applies its operator only when the value itself parsed.
  for (const { key, opKey, param, opParam, value } of NUMERIC_FILTERS) {
    test(`${opParam} is only applied alongside a valid ${param} value`, () => {
      expect(parseListViewParams(new URLSearchParams(`${opParam}=>=`)).filters).toBeUndefined()
      const result = parseListViewParams(new URLSearchParams(`${param}=${value}&${opParam}=>=`))
      const expected: Partial<CardFilters> = {}
      expected[key] = value
      expected[opKey] = '>='
      expect(result.filters).toEqual(expected)
    })
  }

  test('set and type tokens are lowercased and blanks dropped', () => {
    const parsed = parseListViewParams(new URLSearchParams('sets=MKM,,LEA&types=Instant, ,Goblin'))
    expect(parsed.filters?.setCodes).toEqual(['mkm', 'lea'])
    expect(parsed.filters?.cardTypes).toEqual(['instant', 'goblin'])
  })

  test('setMode parses to the selected mode; invalid values are ignored', () => {
    const parsed = parseListViewParams(new URLSearchParams('sets=mkm&setMode=exclude'))
    expect(parsed.filters?.setCodeMode).toBe('exclude')

    const invalid = parseListViewParams(new URLSearchParams('sets=mkm&setMode=banana'))
    expect(invalid.filters?.setCodeMode).toBeUndefined()
  })

  test('oracle and art tag params parse with their mode sub-option', () => {
    const parsed = parseListViewParams(
      new URLSearchParams('otags=Ramp,Mana-Rock&otagMode=exclude&atags=dragon'),
    )
    expect(parsed.filters?.oracleTags).toEqual(['ramp', 'mana-rock'])
    expect(parsed.filters?.oracleTagMode).toBe('exclude')
    expect(parsed.filters?.artTags).toEqual(['dragon'])
    // Sub-options absent from the URL keep their defaults (omitted from overrides).
    expect(parsed.filters?.artTagMode).toBeUndefined()
  })

  test("'subset' is accepted for colors only, since no other filter has that mode", () => {
    const colors = parseListViewParams(new URLSearchParams('colors=R&colorMode=subset'))
    expect(colors.filters?.colorMode).toBe('subset')

    const types = parseListViewParams(new URLSearchParams('types=goblin&typeMode=subset'))
    expect(types.filters?.cardTypeMode).toBeUndefined()
  })

  test("the shared match mode accepts 'exact' and rejects the removed logic values", () => {
    const parsed = parseListViewParams(new URLSearchParams('types=goblin&typeMode=exact'))
    expect(parsed.filters?.cardTypeMode).toBe('exact')

    // 'and'/'or' were the old any/all logic values and are no longer valid modes.
    const stale = parseListViewParams(new URLSearchParams('types=goblin&typeMode=and'))
    expect(stale.filters?.cardTypeMode).toBeUndefined()
  })
})

describe('hasListViewParams', () => {
  test('detects any recognized list-view key', () => {
    expect(hasListViewParams(new URLSearchParams('group=cmc'))).toBe(true)
    expect(hasListViewParams(new URLSearchParams('noLands=1'))).toBe(true)
  })

  test('ignores foreign keys', () => {
    expect(hasListViewParams(new URLSearchParams('lists=deck:a&all=1'))).toBe(false)
    expect(hasListViewParams(new URLSearchParams(''))).toBe(false)
  })
})

describe('labels param', () => {
  test('written as canonical CSV only when active', () => {
    const state = defaultState()
    state.filters.labels = ['sale', 'trade']
    expect(encode(state).get('labels')).toBe('sale,trade')
    state.filters.labels = []
    expect(encode(state).has('labels')).toBe(false)
  })

  test('non-canonical store order is normalized on write', () => {
    const state = defaultState()
    state.filters.labels = ['trade', 'sale']
    expect(encode(state).get('labels')).toBe('sale,trade')
  })

  test('parses back through parseListViewParams', () => {
    const params = new URLSearchParams('labels=keep')
    expect(parseListViewParams(params).filters?.labels).toEqual(['keep'])
    expect(parseListViewParams(new URLSearchParams('labels=none')).filters?.labels).toEqual([
      'none',
    ])
  })

  test('an illegal combination is ignored whole', () => {
    const params = new URLSearchParams('labels=keep,sale')
    expect(parseListViewParams(params).filters?.labels).toBeUndefined()
  })
})

describe('withLabelsParam', () => {
  test('appends the normalized filter, picking the right joiner', () => {
    expect(withLabelsParam('#/combined?all=collection', ['trade', 'sale'])).toBe(
      '#/combined?all=collection&labels=sale,trade',
    )
    expect(withLabelsParam('#/collection/binder', ['keep'])).toBe('#/collection/binder?labels=keep')
  })

  test('leaves the href alone for an empty or illegal selection', () => {
    expect(withLabelsParam('#/combined?all=collection', [])).toBe('#/combined?all=collection')
    expect(withLabelsParam('#/combined?all=collection', ['keep', 'sale'])).toBe(
      '#/combined?all=collection',
    )
  })
})

describe('sell mode parameters', () => {
  test('writes sell and buyer only while sell mode is on', () => {
    expect(encode(defaultState()).has('sell')).toBe(false)
    expect(encode(defaultState()).has('buyer')).toBe(false)

    const params = encode(defaultState({ sellMode: true }))
    expect(params.get('sell')).toBe('1')
    // The buyer only means something alongside sell mode, so it rides with it.
    expect(params.get('buyer')).toBe('cardkingdom')
  })

  test('round-trips the buylist filter in canonical order', () => {
    const params = encode(
      defaultState({
        sellMode: true,
        filters: { ...createDefaultCardFilters(), onBuylist: ['off', 'on'] },
      }),
    )
    expect(params.get('buylist')).toBe('on,off')
    expect(parseListViewParams(params).filters?.onBuylist).toEqual(['on', 'off'])
  })

  test('omits the buylist filter when sell mode is off, since its chips are hidden', () => {
    // Writing it would bake a filter into a shared link that the recipient's
    // toolbar offers no way to see or clear.
    const params = encode(
      defaultState({ filters: { ...createDefaultCardFilters(), onBuylist: ['on'] } }),
    )
    expect(params.has('buylist')).toBe(false)
  })

  test('parses the sell-mode toggle and buyer back', () => {
    const parsed = parseListViewParams(new URLSearchParams('sell=1&buyer=cardkingdom'))
    expect(parsed).toMatchObject({ sellMode: true, buyer: 'cardkingdom' })
  })

  test('ignores an unknown buyer rather than adopting it', () => {
    expect(parseListViewParams(new URLSearchParams('buyer=tcgplayer')).buyer).toBeUndefined()
  })

  test('round-trips the buylist price filter, gated on sell mode', () => {
    const filters = {
      ...createDefaultCardFilters(),
      buylistPrice: 2.5,
      buylistPriceOp: '>=' as const,
    }
    const params = encode(defaultState({ sellMode: true, filters }))
    expect(params.get('buyPrice')).toBe('2.5')
    expect(params.get('buyPriceOp')).toBe('>=')
    expect(parseListViewParams(params).filters).toMatchObject({
      buylistPrice: 2.5,
      buylistPriceOp: '>=',
    })

    // Hidden control, so it must not ride along in a link.
    expect(encode(defaultState({ filters })).has('buyPrice')).toBe(false)
  })

  test('omits the default comparator, like the retail price filter', () => {
    const params = encode(
      defaultState({
        sellMode: true,
        filters: { ...createDefaultCardFilters(), buylistPrice: 1 },
      }),
    )
    expect(params.get('buyPrice')).toBe('1')
    expect(params.has('buyPriceOp')).toBe(false)
  })

  test('a comparator with no threshold neither writes nor applies', () => {
    const params = encode(
      defaultState({
        sellMode: true,
        filters: { ...createDefaultCardFilters(), buylistPriceOp: '>=' },
      }),
    )
    expect(params.has('buyPriceOp')).toBe(false)
    // Parse side: a lone comparator must not become an active filter.
    expect(parseListViewParams(new URLSearchParams('buyPriceOp=>=')).filters).toBeUndefined()
  })

  test('accepts the buylist group-by and sort-by values', () => {
    const parsed = parseListViewParams(
      new URLSearchParams('group=buylist-price&sort=-buylist-price,buylist-spread'),
    )
    expect(parsed.groupBy).toBe('buylist-price')
    expect(parsed.sortLayers).toEqual([
      { sortBy: 'buylist-price', reverse: true },
      { sortBy: 'buylist-spread', reverse: false },
    ])
  })

  test('hasListViewParams recognizes the sell-mode keys', () => {
    expect(hasListViewParams(new URLSearchParams('sell=1'))).toBe(true)
    expect(hasListViewParams(new URLSearchParams('buylist=on'))).toBe(true)
  })
})
