import { describe, test, expect } from 'bun:test'
import {
  type ListViewDefaults,
  type ListViewState,
  hasListViewParams,
  parseListViewParams,
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

  test('filter sub-options are written only when their parent filter is active', () => {
    const filters = createDefaultCardFilters()
    filters.colorMode = 'inclusive'
    filters.setCodeMode = 'exclude'
    filters.cardTypeLogic = 'and'
    filters.cardTypeMode = 'exclude'
    filters.manaValueOp = '>='
    // No colors / sets / types / manaValue set, so the sub-options stay out of the URL.
    expect(encode(defaultState({ filters })).toString()).toBe('')

    filters.colors = ['R']
    filters.setCodes = ['mkm']
    filters.cardTypes = ['dragon']
    filters.manaValue = 5
    const params = encode(defaultState({ filters }))
    expect(params.get('colorMode')).toBe('inclusive')
    expect(params.get('setMode')).toBe('exclude')
    expect(params.get('typeLogic')).toBe('and')
    expect(params.get('typeMode')).toBe('exclude')
    expect(params.get('mvOp')).toBe('>=')
  })

  test('sub-options at their default stay out of the URL even when the parent is active', () => {
    const filters = createDefaultCardFilters()
    filters.colors = ['R'] // colorMode left at default 'exclusive'
    filters.setCodes = ['mkm'] // setCodeMode left at default 'include'
    filters.cardTypes = ['dragon'] // logic 'or' / mode 'include' left at default
    filters.manaValue = 5 // manaValueOp left at default '='
    const params = encode(defaultState({ filters }))
    expect(params.has('colorMode')).toBe(false)
    expect(params.has('setMode')).toBe(false)
    expect(params.has('typeLogic')).toBe(false)
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

  test('oracle and art tag selections and their non-default sub-options are written', () => {
    const filters = createDefaultCardFilters()
    filters.oracleTags = ['ramp', 'mana-rock']
    filters.oracleTagLogic = 'and'
    filters.oracleTagMode = 'exclude'
    filters.artTags = ['dragon']
    // artTagLogic / artTagMode left at default, so they stay out of the URL.
    const params = encode(defaultState({ filters }))
    expect(params.get('otags')).toBe('ramp,mana-rock')
    expect(params.get('otagLogic')).toBe('and')
    expect(params.get('otagMode')).toBe('exclude')
    expect(params.get('atags')).toBe('dragon')
    expect(params.has('atagLogic')).toBe(false)
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
  test('round-trips a fully populated state', () => {
    const filters = createDefaultCardFilters()
    filters.hideLands = true
    filters.hideUnpriced = true
    filters.hideExtras = true
    filters.name = 'bolt'
    filters.colors = ['U', 'R']
    filters.colorMode = 'inclusive'
    filters.setCodes = ['mkm', 'lea']
    filters.setCodeMode = 'exclude'
    filters.cardTypes = ['instant', 'goblin']
    filters.cardTypeLogic = 'and'
    filters.cardTypeMode = 'exclude'
    filters.oracleTags = ['ramp', 'mana-rock']
    filters.oracleTagLogic = 'and'
    filters.oracleTagMode = 'exclude'
    filters.artTags = ['dragon']
    // artTagLogic / artTagMode left at default to verify they stay absent from the round-trip.
    filters.manaValue = 4
    filters.manaValueOp = '<='
    filters.price = 5.25
    filters.priceOp = '>='
    filters.copies = 2
    filters.copiesOp = '>='
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
      colorMode: 'inclusive',
      setCodes: ['mkm', 'lea'],
      setCodeMode: 'exclude',
      cardTypes: ['instant', 'goblin'],
      cardTypeLogic: 'and',
      cardTypeMode: 'exclude',
      oracleTags: ['ramp', 'mana-rock'],
      oracleTagLogic: 'and',
      oracleTagMode: 'exclude',
      artTags: ['dragon'],
      manaValue: 4,
      manaValueOp: '<=',
      price: 5.25,
      priceOp: '>=',
      copies: 2,
      copiesOp: '>=',
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

  test('oracle and art tag params parse with their logic/mode sub-options', () => {
    const parsed = parseListViewParams(
      new URLSearchParams('otags=Ramp,Mana-Rock&otagLogic=and&otagMode=exclude&atags=dragon'),
    )
    expect(parsed.filters?.oracleTags).toEqual(['ramp', 'mana-rock'])
    expect(parsed.filters?.oracleTagLogic).toBe('and')
    expect(parsed.filters?.oracleTagMode).toBe('exclude')
    expect(parsed.filters?.artTags).toEqual(['dragon'])
    // Sub-options absent from the URL keep their defaults (omitted from overrides).
    expect(parsed.filters?.artTagLogic).toBeUndefined()
    expect(parsed.filters?.artTagMode).toBeUndefined()
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
