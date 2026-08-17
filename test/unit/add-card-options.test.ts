import { describe, expect, test } from 'bun:test'
import {
  hasAddCardOptions,
  readAddCardArt,
  type AddCardOptionsConfig,
} from '../../src/editor/components/AddCardOptions'

/**
 * The add dialog's per-card options row, minus its markup: what the typed art
 * text means, and which lists have anything to show at all.
 *
 * The reference grammar itself is `card-art.ts`'s (unit-tested there); what is
 * pinned here is that the dialog reads a blank field as "no art" rather than as
 * a refusal, and reports the parser's own sentence when it is neither.
 */

const config = (over: Partial<AddCardOptionsConfig> = {}): AddCardOptionsConfig => ({
  listType: 'collection',
  enableArt: false,
  ...over,
})

describe('readAddCardArt', () => {
  test('an empty field is no art, not an error', () => {
    expect(readAddCardArt('')).toEqual({ state: 'empty' })
    expect(readAddCardArt('   ')).toEqual({ state: 'empty' })
  })

  test('a path inside the art directory reads as a file reference', () => {
    expect(readAddCardArt('proxies/sol-ring.png')).toEqual({
      state: 'valid',
      art: { file: 'proxies/sol-ring.png' },
    })
  })

  test('an http address reads as a url reference', () => {
    expect(readAddCardArt('https://example.com/bolt.jpg')).toEqual({
      state: 'valid',
      art: { url: 'https://example.com/bolt.jpg' },
    })
  })

  test('an unusable reference carries the parser’s reason', () => {
    const parsed = readAddCardArt('../secrets/passwd.png')
    expect(parsed.state).toBe('invalid')
    if (parsed.state !== 'invalid') throw new Error('expected a refusal')
    expect(parsed.reason.length).toBeGreaterThan(0)
  })
})

describe('hasAddCardOptions', () => {
  test('a collection has labels to offer even without art', () => {
    expect(hasAddCardOptions(config())).toBe(true)
  })

  test('a deck has its proxy label', () => {
    expect(hasAddCardOptions(config({ listType: 'deck' }))).toBe(true)
  })

  test('a wanted list has neither, so the row is nothing at all', () => {
    expect(hasAddCardOptions(config({ listType: 'wanted' }))).toBe(false)
  })

  test('a wanted list on a host that can write art still offers it', () => {
    expect(hasAddCardOptions(config({ listType: 'wanted', enableArt: true }))).toBe(true)
  })
})
