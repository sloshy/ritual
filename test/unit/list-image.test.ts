import { describe, test, expect } from 'bun:test'
import {
  isListImageCardRef,
  isListImageFileRef,
  isListImageRefError,
  isListImageUrlRef,
  isSameListImageRef,
  listImageMode,
  parseListImage,
  readListImage,
  reconcileListImageRef,
  serializeListImageRef,
  type ListImageRef,
} from '../../src/list/list-image'

/**
 * The `image:` grammar is the one value space every surface speaks — front
 * matter, the admin route body, the MCP tool, both editors — so the acceptance
 * set is pinned here rather than re-tested per surface. The mapping form is the
 * only spelling: a scalar `image: &12` is a YAML *anchor* that parses to `null`,
 * and a scalar path would be a second grammar nothing wants.
 */

/** The parsed reference, or a thrown failure naming the parse error. */
function unwrap(value: unknown): ListImageRef {
  const parsed = parseListImage(value)
  if (parsed === null) throw new Error('expected a reference, got the default')
  if (isListImageRefError(parsed)) throw new Error(`expected a reference, got: ${parsed.error}`)
  return parsed
}

/** The parse error's message, or a thrown failure naming what parsed instead. */
function errorOf(value: unknown): string {
  const parsed = parseListImage(value)
  if (parsed === null || !isListImageRefError(parsed)) {
    throw new Error(`expected an error, got: ${JSON.stringify(parsed)}`)
  }
  return parsed.error
}

describe('parseListImage', () => {
  test('an absent or null value is the built-in rule', () => {
    expect(parseListImage(undefined)).toBeNull()
    expect(parseListImage(null)).toBeNull()
  })

  test('accepts each of the three modes', () => {
    expect(unwrap({ card: 12 })).toEqual({ card: 12 })
    expect(unwrap({ file: 'alters/atraxa.png' })).toEqual({ file: 'alters/atraxa.png' })
    expect(unwrap({ url: 'https://example.com/a.jpg' })).toEqual({
      url: 'https://example.com/a.jpg',
    })
  })

  test('a card id must be a positive integer, never a coerced string', () => {
    expect(errorOf({ card: 0 })).toBe('"card" must be a positive card id')
    expect(errorOf({ card: 1.5 })).toBe('"card" must be a positive card id')
    expect(errorOf({ card: '12' })).toBe('"card" must be a positive card id')
    expect(errorOf({ card: -3 })).toBe('"card" must be a positive card id')
  })

  test('a file ref inherits the custom-art rules verbatim', () => {
    expect(errorOf({ file: '../x.png' })).toBe('"../x.png" escapes the art directory')
    expect(errorOf({ file: 'x.svg' })).toContain('is not an image file')
    expect(errorOf({ file: '/abs/x.png' })).toContain('must be relative to the art directory')
    expect(errorOf({ file: 'alters\\x.png' })).toContain('must use forward slashes')
  })

  test('a url ref must be an absolute http(s) URL', () => {
    expect(errorOf({ url: 'ftp://example.com/a.jpg' })).toContain('must be an http(s) URL')
    expect(errorOf({ url: 'not a url' })).toContain('is not a valid URL')
  })

  test('exactly one of card/file/url, and no unknown keys', () => {
    const exactlyOne = 'a list image must have exactly one of "card", "file" or "url"'
    expect(errorOf({ card: 1, file: 'x.png' })).toBe(exactlyOne)
    expect(errorOf({})).toBe(exactlyOne)
    expect(errorOf({ crd: 1 })).toBe('a list image has no such key: crd')
  })

  test('every scalar spelling is refused — there is no one-line form', () => {
    const shape = 'a list image must be a mapping with one of "card", "file" or "url"'
    expect(errorOf(12)).toBe(shape)
    expect(errorOf(true)).toBe(shape)
    expect(errorOf([])).toBe(shape)
    expect(errorOf('default')).toBe(shape)
    expect(errorOf('&12')).toBe(shape)
    expect(errorOf('alters/atraxa.png')).toBe(shape)
  })
})

describe('serializeListImageRef', () => {
  test('round-trips every mode back through the parser', () => {
    const refs: ListImageRef[] = [
      { card: 7 },
      { file: 'alters/atraxa.png' },
      { url: 'https://example.com/a.jpg' },
    ]
    for (const ref of refs) {
      expect(parseListImage(serializeListImageRef(ref))).toEqual(ref)
    }
  })

  test('emits only the key the reference owns', () => {
    expect(Object.keys(serializeListImageRef({ card: 7 }))).toEqual(['card'])
  })
})

describe('listImageMode and the narrowing helpers', () => {
  test('no reference is the default mode', () => {
    expect(listImageMode(undefined)).toBe('default')
    expect(listImageMode(null)).toBe('default')
  })

  test('each reference reports its own mode', () => {
    expect(listImageMode({ card: 1 })).toBe('card')
    expect(listImageMode({ file: 'a.png' })).toBe('file')
    expect(listImageMode({ url: 'https://e.com/a.png' })).toBe('url')
  })

  test('the narrowing helpers agree with the mode', () => {
    expect(isListImageCardRef({ card: 1 })).toBe(true)
    expect(isListImageFileRef({ card: 1 })).toBe(false)
    expect(isListImageFileRef({ file: 'a.png' })).toBe(true)
    expect(isListImageUrlRef({ url: 'https://e.com/a.png' })).toBe(true)
  })
})

describe('isSameListImageRef', () => {
  test('same mode, same value', () => {
    expect(isSameListImageRef({ card: 3 }, { card: 3 })).toBe(true)
    expect(isSameListImageRef({ card: 3 }, { card: 4 })).toBe(false)
    expect(isSameListImageRef({ file: 'a.png' }, { file: 'a.png' })).toBe(true)
    expect(isSameListImageRef({ file: 'a.png' }, { file: 'b.png' })).toBe(false)
    expect(isSameListImageRef({ url: 'https://e.com/a.png' }, { url: 'https://e.com/a.png' })).toBe(
      true,
    )
  })

  test('different modes never match', () => {
    expect(isSameListImageRef({ card: 3 }, { file: 'a.png' })).toBe(false)
    expect(isSameListImageRef({ file: 'a.png' }, { url: 'https://e.com/a.png' })).toBe(false)
  })
})

describe('readListImage', () => {
  test('an absent key reads as no cover and no advisory', () => {
    expect(readListImage({ name: 'Burn' })).toEqual({})
  })

  test('an explicit null reads as the built-in rule, not an advisory', () => {
    expect(readListImage({ image: null })).toEqual({})
  })

  test('a usable value is returned parsed', () => {
    expect(readListImage({ image: { card: 4 } })).toEqual({ image: { card: 4 } })
  })

  test('an unusable value degrades to an advisory rather than throwing', () => {
    const read = readListImage({ image: 'alters/x.png' })
    expect(read.image).toBeUndefined()
    expect(read.advisory).toContain('must be a mapping')
  })

  test('a delegated card-art refusal reaches the same advisory channel', () => {
    // The file and URL branches are `parseCardArtRef`'s rules, and its wording
    // has to survive the hop into `advisory` just as the local errors do.
    expect(readListImage({ image: { file: '../secrets.png' } }).advisory).toContain(
      'escapes the art directory',
    )
    expect(readListImage({ image: { file: 'notes.txt' } }).image).toBeUndefined()
    expect(readListImage({ image: { url: 'ftp://example.com/a.png' } }).advisory).toBeDefined()
  })
})

describe('reconcileListImageRef', () => {
  test('a removed card clears the cover', () => {
    expect(reconcileListImageRef({ card: 5 }, { removed: [5] })).toEqual({
      image: null,
      changed: true,
    })
  })

  test('a renumbered card follows its line', () => {
    expect(reconcileListImageRef({ card: 5 }, { renumbered: new Map([[5, 3]]) })).toEqual({
      image: { card: 3 },
      changed: true,
    })
  })

  test('churn on other ids leaves the cover alone', () => {
    expect(
      reconcileListImageRef({ card: 5 }, { removed: [2], renumbered: new Map([[9, 1]]) }),
    ).toEqual({ image: { card: 5 }, changed: false })
  })

  test('file and url covers reference nothing of the list and never change', () => {
    expect(reconcileListImageRef({ file: 'a.png' }, { removed: [1, 2, 3] })).toEqual({
      image: { file: 'a.png' },
      changed: false,
    })
    expect(
      reconcileListImageRef({ url: 'https://e.com/a.png' }, { renumbered: new Map([[1, 2]]) }),
    ).toEqual({ image: { url: 'https://e.com/a.png' }, changed: false })
  })

  test('no cover at all is never a change', () => {
    expect(reconcileListImageRef(undefined, { removed: [1] })).toEqual({
      image: null,
      changed: false,
    })
    expect(reconcileListImageRef(null, { removed: [1] })).toEqual({ image: null, changed: false })
  })

  test('a removal beats a renumber of the same id — the line is gone either way', () => {
    expect(
      reconcileListImageRef({ card: 5 }, { removed: [5], renumbered: new Map([[5, 8]]) }),
    ).toEqual({ image: null, changed: true })
  })

  test('an identity renumber is not a change, so nothing is written', () => {
    expect(reconcileListImageRef({ card: 5 }, { renumbered: new Map([[5, 5]]) })).toEqual({
      image: { card: 5 },
      changed: false,
    })
  })
})
