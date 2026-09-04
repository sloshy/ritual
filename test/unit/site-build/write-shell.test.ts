import { describe, expect, test } from 'bun:test'
import { buildSiteIndex, type SiteIndexParts } from '../../../src/site-build/write-shell'
import type { WantedListSummary } from '../../../src/list/site-data'
import { localeTag } from '../../../src/i18n/locale-tag'
import { getDefaultRitualConfig } from '../../../src/config/ritual-config'

const WANTED: WantedListSummary = {
  slug: 'wishlist',
  name: 'Wishlist',
  featuredCardImage: '',
  cardCount: 1,
  totalPrice: 0,
  totalPriceEur: 0,
  totalPriceTix: 0,
}

function parts(wantedLists: WantedListSummary[]): SiteIndexParts {
  return {
    decks: [],
    collections: [],
    wantedLists,
    useScryfallImgUrls: true,
    defaultCurrency: 'usd',
    availableCurrencies: ['usd'],
    uiLocale: localeTag('en'),
    availableLocales: [localeTag('en')],
  }
}

describe('buildSiteIndex', () => {
  test('omits the wantedLists key entirely when there are none', () => {
    const json = JSON.parse(JSON.stringify(buildSiteIndex(parts([]))))
    expect(json).not.toHaveProperty('wantedLists')
  })

  test('carries wantedLists when there is at least one', () => {
    const json = JSON.parse(JSON.stringify(buildSiteIndex(parts([WANTED]))))
    expect(json.wantedLists).toEqual([WANTED])
  })

  test('bakes the configured defaultCategories, so the site editors can suggest them', () => {
    const config = { ...getDefaultRitualConfig(), defaultCategories: ['Ramp', 'Board Wipes'] }
    expect(buildSiteIndex(parts([]), config).defaultCategories).toEqual(['Ramp', 'Board Wipes'])
  })

  test('an explicitly empty vocabulary bakes as [], not as the shipped default', () => {
    const config = { ...getDefaultRitualConfig(), defaultCategories: [] }
    expect(buildSiteIndex(parts([]), config).defaultCategories).toEqual([])
  })
})
