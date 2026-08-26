import { describe, test, expect } from 'bun:test'
import type { ScryfallCard } from '../../src/types'
import { makePrintingIn as printing } from '../test-utils'
import {
  buildPrintingKeys,
  indexPrintingCard,
  seedNameRepresentative,
} from '../../src/editor/card-data-utils'

/**
 * The editors' dual keying of printing card maps under an `all_cards` cache:
 * English objects own the plain `set:cn` slot, foreign objects sit at
 * `set:cn@lang`, and a printing that exists in no other language falls back to
 * the plain slot so its art and price still resolve.
 */

const STA_EN = printing('sta', '42', 'en')
const STA_JA = printing('sta', '42', 'ja')
const WAR_JA_ONLY = printing('war', '76★', 'ja')

describe('indexPrintingCard / buildPrintingKeys', () => {
  test('en owns the plain key; foreign objects key under set:cn@lang', () => {
    const keys = buildPrintingKeys([STA_EN, STA_JA])
    expect(keys['sta:42']).toBe(STA_EN)
    expect(keys['sta:42@ja']).toBe(STA_JA)
  })

  test('en reclaims the plain slot regardless of arrival order', () => {
    const keys = buildPrintingKeys([STA_JA, STA_EN])
    expect(keys['sta:42']).toBe(STA_EN)
    expect(keys['sta:42@ja']).toBe(STA_JA)
  })

  test('a printing that exists only in a foreign language falls back to the plain slot', () => {
    const keys = buildPrintingKeys([WAR_JA_ONLY])
    expect(keys['war:76★']).toBe(WAR_JA_ONLY)
    expect(keys['war:76★@ja']).toBe(WAR_JA_ONLY)
  })

  test('indexPrintingCard never overwrites an existing plain slot with a foreign object', () => {
    const map: Record<string, ScryfallCard | null> = {}
    indexPrintingCard(map, STA_EN)
    indexPrintingCard(map, STA_JA)
    expect(map['sta:42']).toBe(STA_EN)
  })
})

describe('seedNameRepresentative', () => {
  test('fills the by-name slot when the name holds no card yet', () => {
    const map: Record<string, ScryfallCard | null> = {}
    seedNameRepresentative(map, 'Lightning Bolt', STA_EN)
    expect(map['Lightning Bolt']).toBe(STA_EN)
  })

  test('a recorded null is an empty slot, unlike a printing key', () => {
    const map: Record<string, ScryfallCard | null> = { 'Lightning Bolt': null }
    seedNameRepresentative(map, 'Lightning Bolt', STA_EN)
    expect(map['Lightning Bolt']).toBe(STA_EN)
  })

  test('leaves a held representative alone so name-only copies keep their printing', () => {
    const map: Record<string, ScryfallCard | null> = { 'Lightning Bolt': STA_EN }
    seedNameRepresentative(map, 'Lightning Bolt', printing('m10', '146'))
    expect(map['Lightning Bolt']).toBe(STA_EN)
  })

  test('an English object reclaims the slot from a foreign-language one', () => {
    const map: Record<string, ScryfallCard | null> = { 'Lightning Bolt': STA_JA }
    seedNameRepresentative(map, 'Lightning Bolt', STA_EN)
    expect(map['Lightning Bolt']).toBe(STA_EN)
  })

  test('a foreign-language object never displaces an English representative', () => {
    const map: Record<string, ScryfallCard | null> = { 'Lightning Bolt': STA_EN }
    seedNameRepresentative(map, 'Lightning Bolt', WAR_JA_ONLY)
    expect(map['Lightning Bolt']).toBe(STA_EN)
  })
})
