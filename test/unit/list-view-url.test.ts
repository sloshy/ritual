import { describe, test, expect } from 'bun:test'
import {
  type ListViewDefaults,
  type ListViewState,
  hasListViewParams,
  parseListViewParams,
  writeListViewParams,
} from '../../src/site/list-view-url'
import { createDefaultCardFilters } from '../../src/site/card-filters'

const DEFAULTS: ListViewDefaults = { groupBy: 'type', sortBy: 'name' }

function defaultState(overrides?: Partial<ListViewState>): ListViewState {
  return {
    viewMode: 'binder',
    cardSize: 'large',
    groupBy: 'type',
    sortBy: 'name',
    reverse: false,
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
        sortBy: 'price',
        reverse: true,
        reverseGroups: true,
        priceGroupStrategy: 'ten',
      }),
    )
    expect(params.get('view')).toBe('list')
    expect(params.get('size')).toBe('small')
    expect(params.get('group')).toBe('cmc')
    expect(params.get('sort')).toBe('price')
    expect(params.get('rev')).toBe('1')
    expect(params.get('revSections')).toBe('1')
    expect(params.get('bracket')).toBe('ten')
  })

  test('group and sort matching the page defaults are omitted', () => {
    const params = encode(defaultState({ groupBy: 'type', sortBy: 'name' }), {
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
    filters.cardTypeLogic = 'and'
    filters.cardTypeMode = 'exclude'
    filters.manaValueOp = '>='
    // No colors / types / manaValue set, so the sub-options stay out of the URL.
    expect(encode(defaultState({ filters })).toString()).toBe('')

    filters.colors = ['R']
    filters.cardTypes = ['dragon']
    filters.manaValue = 5
    const params = encode(defaultState({ filters }))
    expect(params.get('colorMode')).toBe('inclusive')
    expect(params.get('typeLogic')).toBe('and')
    expect(params.get('typeMode')).toBe('exclude')
    expect(params.get('mvOp')).toBe('>=')
  })

  test('sub-options at their default stay out of the URL even when the parent is active', () => {
    const filters = createDefaultCardFilters()
    filters.colors = ['R'] // colorMode left at default 'exclusive'
    filters.cardTypes = ['dragon'] // logic 'or' / mode 'include' left at default
    filters.manaValue = 5 // manaValueOp left at default '='
    const params = encode(defaultState({ filters }))
    expect(params.has('colorMode')).toBe(false)
    expect(params.has('typeLogic')).toBe(false)
    expect(params.has('typeMode')).toBe(false)
    expect(params.has('mvOp')).toBe(false)
  })

  test('a mana value of 0 is written (it is a meaningful filter, not "unset")', () => {
    const filters = createDefaultCardFilters()
    filters.manaValue = 0
    expect(encode(defaultState({ filters })).get('mv')).toBe('0')
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
    filters.cardTypes = ['instant', 'goblin']
    filters.cardTypeLogic = 'and'
    filters.cardTypeMode = 'exclude'
    filters.manaValue = 4
    filters.manaValueOp = '<='
    const state = defaultState({
      viewMode: 'overlap',
      cardSize: 'medium',
      groupBy: 'price',
      sortBy: 'edhrec',
      reverse: true,
      reverseGroups: true,
      priceGroupStrategy: 'five',
      filters,
    })

    const parsed = parseListViewParams(encode(state))
    expect(parsed.viewMode).toBe('overlap')
    expect(parsed.cardSize).toBe('medium')
    expect(parsed.groupBy).toBe('price')
    expect(parsed.sortBy).toBe('edhrec')
    expect(parsed.reverse).toBe(true)
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
      cardTypes: ['instant', 'goblin'],
      cardTypeLogic: 'and',
      cardTypeMode: 'exclude',
      manaValue: 4,
      manaValueOp: '<=',
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

  test('colors are normalized to canonical WUBRG order and deduped', () => {
    const parsed = parseListViewParams(new URLSearchParams('colors=grw'))
    expect(parsed.filters?.colors).toEqual(['W', 'R', 'G'])
  })

  test('non-color letters in the colors param are dropped', () => {
    const parsed = parseListViewParams(new URLSearchParams('colors=xWqU'))
    expect(parsed.filters?.colors).toEqual(['W', 'U'])
  })

  test('a non-integer mana value is ignored', () => {
    expect(parseListViewParams(new URLSearchParams('mv=abc')).filters).toBeUndefined()
    expect(parseListViewParams(new URLSearchParams('mv=2.5')).filters).toBeUndefined()
  })

  test('mvOp is only applied alongside a valid mana value', () => {
    expect(parseListViewParams(new URLSearchParams('mvOp=>=')).filters).toBeUndefined()
    const parsed = parseListViewParams(new URLSearchParams('mv=3&mvOp=>='))
    expect(parsed.filters).toEqual({ manaValue: 3, manaValueOp: '>=' })
  })

  test('a mana value of 0 parses to 0, not undefined', () => {
    expect(parseListViewParams(new URLSearchParams('mv=0')).filters).toEqual({ manaValue: 0 })
  })

  test('set and type tokens are lowercased and blanks dropped', () => {
    const parsed = parseListViewParams(new URLSearchParams('sets=MKM,,LEA&types=Instant, ,Goblin'))
    expect(parsed.filters?.setCodes).toEqual(['mkm', 'lea'])
    expect(parsed.filters?.cardTypes).toEqual(['instant', 'goblin'])
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
