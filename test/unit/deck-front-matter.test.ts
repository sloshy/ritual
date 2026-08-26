import { describe, test, expect } from 'bun:test'
import { validateDeckFrontMatter } from '../../src/list/deck-file'
import { parseDeckText } from '../../src/importers/text-file'

/**
 * Deck front matter is arbitrary user-authored YAML that ships out over the API
 * (`MetadataResponse.frontMatter`, `DeckLoadResult.frontMatter`), so the parser
 * validates rather than asserts. A field whose value is not the type the field
 * promises is dropped — the same thing a deck save already does with an
 * unparseable `format` — while unknown keys round-trip untouched.
 */

describe('validateDeckFrontMatter', () => {
  test('keeps the named string fields when they are strings', () => {
    const parsed = validateDeckFrontMatter({
      name: 'Burn',
      description: 'Fast red',
      sourceId: '123',
      sourceUrl: 'https://archidekt.com/decks/123',
      created: '2026-01-01T00:00:00.000Z',
      lastSynced: '2026-02-01T00:00:00.000Z',
    })
    expect(parsed.name).toBe('Burn')
    expect(parsed.description).toBe('Fast red')
    expect(parsed.sourceId).toBe('123')
    expect(parsed.sourceUrl).toBe('https://archidekt.com/decks/123')
    expect(parsed.created).toBe('2026-01-01T00:00:00.000Z')
    expect(parsed.lastSynced).toBe('2026-02-01T00:00:00.000Z')
  })

  test('drops a non-string description rather than shipping it as one', () => {
    const parsed = validateDeckFrontMatter({ description: { nested: true }, name: 'Burn' })
    expect(Object.keys(parsed)).toEqual(['name'])
  })

  test('drops tags that are not an array of non-empty strings', () => {
    expect(validateDeckFrontMatter({ tags: 'aggro' })).not.toHaveProperty('tags')
    expect(validateDeckFrontMatter({ tags: ['aggro', 7] })).not.toHaveProperty('tags')
    expect(validateDeckFrontMatter({ tags: ['aggro', ''] })).not.toHaveProperty('tags')
    expect(validateDeckFrontMatter({ tags: ['aggro', 'red'] }).tags).toEqual(['aggro', 'red'])
  })

  test('normalizes format through the canonical parser and drops an unknown one', () => {
    expect(validateDeckFrontMatter({ format: 'Commander' }).format).toBe('commander')
    expect(validateDeckFrontMatter({ format: 'kitchen-table' })).not.toHaveProperty('format')
    expect(validateDeckFrontMatter({ format: 42 })).not.toHaveProperty('format')
  })

  test('keeps a deck-supported labels default and normalizes it', () => {
    expect(validateDeckFrontMatter({ labels: ['proxy'] }).labels).toEqual(['proxy'])
  })

  test('drops a labels value a deck cannot carry, whole rather than filtered', () => {
    // Half of `[sale, proxy]` is a different statement than the one written, so
    // the key is dropped rather than reduced to the supported half.
    expect(validateDeckFrontMatter({ labels: ['sale', 'proxy'] })).not.toHaveProperty('labels')
    expect(validateDeckFrontMatter({ labels: ['keep'] })).not.toHaveProperty('labels')
    expect(validateDeckFrontMatter({ labels: 'proxy' })).not.toHaveProperty('labels')
    expect(validateDeckFrontMatter({ labels: [] })).not.toHaveProperty('labels')
  })

  test('passes unknown keys through untouched', () => {
    const parsed = validateDeckFrontMatter({ colors: ['R'], budget: 50 })
    expect(parsed.colors).toEqual(['R'])
    expect(parsed.budget).toBe(50)
  })

  test('does not mutate the object it was handed (gray-matter memoizes .data)', () => {
    const raw: Record<string, unknown> = { description: 7, tags: 'aggro' }
    validateDeckFrontMatter(raw)
    expect(raw.description).toBe(7)
    expect(raw.tags).toBe('aggro')
  })
})

/**
 * `image:` is a key users are told to hand-edit, and a whole-deck save re-dumps
 * the block — so a value the grammar cannot read is dropped *and* warned about
 * through the same channel a dropped `labels:` uses. A silent delete would erase
 * the user's line on their next `add-card`.
 */
describe('validateDeckFrontMatter and the image key', () => {
  test('keeps a legal cover mapping, parsed', () => {
    expect(validateDeckFrontMatter({ image: { card: 12 } }).image).toEqual({ card: 12 })
    expect(validateDeckFrontMatter({ image: { file: 'alters/x.png' } }).image).toEqual({
      file: 'alters/x.png',
    })
  })

  test('drops a value the grammar cannot read, including every scalar form', () => {
    expect(validateDeckFrontMatter({ image: 'alters/x.png' })).not.toHaveProperty('image')
    expect(validateDeckFrontMatter({ image: 12 })).not.toHaveProperty('image')
    expect(validateDeckFrontMatter({ image: { card: 0 } })).not.toHaveProperty('image')
    // `image: &12` is a YAML anchor, so the parser sees null — the built-in rule.
    expect(validateDeckFrontMatter({ image: null })).not.toHaveProperty('image')
  })

  test('parseDeckText warns about the same value the drop would delete', () => {
    const deck = ['---', 'image: alters/x.png', '---', '', '## Main', '1 Sol Ring &1', ''].join(
      '\n',
    )
    const parsed = parseDeckText(deck, 'Burn')
    expect(parsed.warnings.some((warning) => warning.includes("'image' ignored"))).toBe(true)
  })

  test('parseDeckText is silent about a legal cover', () => {
    const deck = ['---', 'image:', '  card: 1', '---', '', '## Main', '1 Sol Ring &1', ''].join(
      '\n',
    )
    expect(parseDeckText(deck, 'Burn').warnings).toEqual([])
  })
})
