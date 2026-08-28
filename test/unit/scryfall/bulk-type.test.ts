import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  configuredCardBulkType,
  isCardBulkType,
  type CardBulkType,
} from '../../../src/scryfall/bulk-manifest'
import {
  BULK_TYPE_BY_KIND,
  CARD_BULK_TYPE_BY_KIND,
  CARD_FEED_KINDS,
  CARD_KIND_BY_BULK_TYPE,
  FEED_KINDS,
  TAG_FEED_KINDS,
} from '../../../src/cache/feed'
import { refreshRitualConfig } from '../../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'

let ws: BoundWorkspace
let configPath: string

beforeEach(async () => {
  ws = await bindWorkspace({ dirs: [], config: false })
  configPath = path.join(ws.dir, 'ritual.config.json')
})

afterEach(async () => {
  await ws.dispose()
})

describe('configuredCardBulkType', () => {
  test('defaultLanguage en (the default) selects default_cards', async () => {
    await refreshRitualConfig()
    expect(configuredCardBulkType()).toBe('default_cards')
  })

  test('an explicit en config still selects default_cards', async () => {
    await fs.writeFile(configPath, JSON.stringify({ defaultLanguage: 'en' }))
    await refreshRitualConfig()
    expect(configuredCardBulkType()).toBe('default_cards')
  })

  test.each(['ja', 'de', 'zhs'])(
    'a non-en defaultLanguage (%s) selects all_cards',
    async (language) => {
      await fs.writeFile(configPath, JSON.stringify({ defaultLanguage: language }))
      await refreshRitualConfig()
      expect(configuredCardBulkType()).toBe('all_cards')
    },
  )
})

describe('isCardBulkType', () => {
  test('accepts both card bulks and rejects other bulk types', () => {
    expect(isCardBulkType('default_cards')).toBe(true)
    expect(isCardBulkType('all_cards')).toBe(true)
    expect(isCardBulkType('oracle_cards')).toBe(false)
    expect(isCardBulkType('rulings')).toBe(false)
  })
})

describe('feed kind vocabulary', () => {
  test('FEED_KINDS covers both card kinds plus the tag kinds', () => {
    expect([...FEED_KINDS]).toEqual(['default-cards', 'all-cards', 'oracle-tags', 'art-tags'])
    expect([...CARD_FEED_KINDS]).toEqual(['default-cards', 'all-cards'])
    expect([...TAG_FEED_KINDS]).toEqual(['oracle-tags', 'art-tags'])
  })

  test('each feed kind maps to its Scryfall bulk type', () => {
    expect(BULK_TYPE_BY_KIND['default-cards']).toBe('default_cards')
    expect(BULK_TYPE_BY_KIND['all-cards']).toBe('all_cards')
    expect(BULK_TYPE_BY_KIND['oracle-tags']).toBe('oracle_tags')
    expect(BULK_TYPE_BY_KIND['art-tags']).toBe('art_tags')
  })

  test('the card-kind and bulk-type maps are inverses of each other', () => {
    for (const kind of CARD_FEED_KINDS) {
      expect(CARD_KIND_BY_BULK_TYPE[CARD_BULK_TYPE_BY_KIND[kind]]).toBe(kind)
    }
    for (const bulkType of Object.keys(CARD_KIND_BY_BULK_TYPE) as CardBulkType[]) {
      expect(CARD_BULK_TYPE_BY_KIND[CARD_KIND_BY_BULK_TYPE[bulkType]]).toBe(bulkType)
    }
  })
})
