import { describe, expect, test } from 'bun:test'
import {
  parseDeckMetadataBody,
  type DeckMetadataPatch,
  type ParsedDeckMetadataBody,
} from '../../../src/admin/api/metadata'
import { invalidDeckFormatMessage } from '../../../src/deck-format'

/**
 * `PUT /api/metadata/:type/:slug`'s body validator. It returns a message rather
 * than throwing, and rejects every key it does not write, so a typo can never
 * look like a successful no-op write.
 *
 * A cleared field is encoded as `null`, not as a present-but-`undefined` key:
 * `toEqual({ format: undefined })` is satisfied by `{}` under bun's structural
 * equality, so the old encoding made every clear assertion a tautology.
 */

/** The parsed patch, failing the test if validation rejected the body instead. */
function patchOf(body: Record<string, unknown>): DeckMetadataPatch {
  const parsed = parseDeckMetadataBody(body)
  if (typeof parsed === 'string') throw new Error(`expected a patch, got: ${parsed}`)
  return parsed.patch
}

describe('parseDeckMetadataBody', () => {
  test('an unknown field names the fields that are accepted', () => {
    expect(parseDeckMetadataBody({ colour: 'blue' })).toBe(
      "Unknown metadata field 'colour'. Accepted fields: description, tags, format, sourceId, sourceUrl.",
    )
  })

  test('name is refused with a pointer at the rename route, which moves the file too', () => {
    const message = parseDeckMetadataBody({ name: 'New Name' })
    expect(message).toContain('POST /api/deck/:slug/rename')
  })

  test.each(['created', 'lastSynced'])('%s is stamped by Ritual, not editable', (key) => {
    expect(parseDeckMetadataBody({ [key]: '2026-01-01' })).toContain('cannot be edited')
  })

  test('contentHash is parsed as the concurrency token, not as a metadata field', () => {
    expect(parseDeckMetadataBody({ contentHash: 'abc', description: 'Hi' })).toEqual({
      patch: { description: 'Hi' },
      contentHash: 'abc',
    })
  })

  test('a non-string contentHash is refused rather than silently skipping the check', () => {
    expect(parseDeckMetadataBody({ contentHash: 42, description: 'Hi' })).toBe(
      'contentHash must be a string.',
    )
  })

  test('a body without a contentHash omits the key entirely', () => {
    const parsed = parseDeckMetadataBody({ description: 'Hi' }) as ParsedDeckMetadataBody
    expect('contentHash' in parsed).toBeFalse()
  })

  test('description is trimmed', () => {
    expect(patchOf({ description: '  A deck.  ' }).description).toBe('A deck.')
  })

  test.each([
    ['null', null],
    ['an empty string', '   '],
  ])('a description of %s clears the field', (_label, value) => {
    expect(patchOf({ description: value }).description).toBeNull()
  })

  test('tags are trimmed and deduped, keeping first-seen order', () => {
    expect(patchOf({ tags: [' aggro ', 'budget', 'aggro'] }).tags).toEqual(['aggro', 'budget'])
  })

  test('tags must be an array', () => {
    expect(parseDeckMetadataBody({ tags: 'aggro' })).toBe(
      'tags must be an array of strings or null.',
    )
  })

  test('a blank tag is refused rather than silently dropped', () => {
    expect(parseDeckMetadataBody({ tags: ['aggro', '  '] })).toBe(
      'tags must be an array of non-empty strings.',
    )
  })

  test('null tags clear the field', () => {
    expect(patchOf({ tags: null }).tags).toBeNull()
  })

  test('a format is canonicalized through the shared parser', () => {
    expect(patchOf({ format: 'EDH' }).format).toBe('commander')
  })

  test('an unparseable format is refused in the shared wording', () => {
    expect(parseDeckMetadataBody({ format: 'kitchen-table' })).toBe(
      invalidDeckFormatMessage('kitchen-table'),
    )
  })

  test('a null format clears it, so the deck falls back to section inference', () => {
    expect(patchOf({ format: null }).format).toBeNull()
  })

  test.each([
    ['not a URL at all', 'archidekt.com/decks/1'],
    ['a non-http scheme', 'ftp://archidekt.com/decks/1'],
    ['a non-string', 42],
  ])('a sourceUrl that is %s is refused', (_label, value) => {
    expect(parseDeckMetadataBody({ sourceUrl: value })).toBe('sourceUrl must be an http(s) URL.')
  })

  test('an https sourceUrl is accepted', () => {
    expect(patchOf({ sourceUrl: 'https://archidekt.com/decks/1' }).sourceUrl).toBe(
      'https://archidekt.com/decks/1',
    )
  })

  test('an empty sourceId is refused; null clears it', () => {
    expect(parseDeckMetadataBody({ sourceId: '  ' })).toBe(
      'sourceId must be a non-empty string or null.',
    )
    expect(patchOf({ sourceId: null }).sourceId).toBeNull()
  })

  test('fields not mentioned in the body are left out of the patch entirely', () => {
    expect(Object.keys(patchOf({ format: 'modern' }))).toEqual(['format'])
  })
})
