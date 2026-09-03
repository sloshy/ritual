import { describe, expect, test } from 'bun:test'
import {
  normalizeRequestCategories,
  normalizeRequestLanguages,
  normalizeRequestTags,
} from '../../../src/admin/api/save-helpers'
import { createSetLanguageChange, type ChangeEvent } from '../../../src/changes/change-event'
import { invalidCardTagMessage } from '../../../src/card/card-tags'
import { invalidCardCategoryMessage } from '../../../src/card/card-categories'
import type { ApiErrorResponse } from '../../../src/api/http'

/** A raw wire change: the request body is cast unvalidated, which is the point. */
function wireChange(fields: Record<string, unknown>): ChangeEvent {
  return { id: 'x', timestamp: 0, cardName: 'Sol Ring', ...fields } as unknown as ChangeEvent
}

/** A list-level change as the wire carries it — no card, by construction. */
function wireListChange(fields: Record<string, unknown>): ChangeEvent {
  return { id: 'x', timestamp: 0, ...fields } as unknown as ChangeEvent
}

/** The 400 body of a refusal, failing the test on a pass-through. */
async function refusalMessage(response: Response | null): Promise<string> {
  if (response === null) throw new Error('expected a 400 refusal, got null')
  expect(response.status).toBe(400)
  return ((await response.json()) as ApiErrorResponse).message
}

/**
 * The one language-validation boundary all three save routes share. The full
 * matrix (normalization, refusals, the entry-side en fold) lives here; each
 * save-route integration test keeps exactly one 400 case proving the route
 * wires this validator in front of its write.
 */
describe('normalizeRequestLanguages', () => {
  /** A request entry as the unvalidated wire carries it. */
  type WireEntry = { language?: unknown }

  test('an uppercase change code normalizes to the canonical lowercase form', () => {
    const change = wireChange({ action: 'set-language', cardId: 1, language: 'JA' })
    expect(normalizeRequestLanguages([change], [])).toBeNull()
    expect((change as { language?: string }).language).toBe('ja')
  })

  test('an unknown change code is refused, naming the offender', async () => {
    const change = wireChange({ action: 'set-language', cardId: 1, language: 'xx' })
    const message = await refusalMessage(normalizeRequestLanguages([change], []))
    expect(message).toContain('"xx"')
    expect(message).toContain('set-language change for "Sol Ring"')
  })

  test('a set-language change without a language is refused', async () => {
    const change = wireChange({ action: 'set-language', cardId: 1 })
    const message = await refusalMessage(normalizeRequestLanguages([change], []))
    expect(message).toContain('requires a "language"')
  })

  test('the optional-language actions accept absence but not an unknown code', async () => {
    const bare = wireChange({ action: 'add' })
    expect(normalizeRequestLanguages([bare], [])).toBeNull()

    const bad = wireChange({ action: 'add', language: 'klingon' })
    const message = await refusalMessage(normalizeRequestLanguages([bad], []))
    expect(message).toContain('"klingon"')
    expect(message).toContain('add change for "Sol Ring"')
  })

  test('a valid change passes through untouched', () => {
    const change = createSetLanguageChange('Sol Ring', { language: 'ja', cardId: 1 })
    expect(normalizeRequestLanguages([change], [])).toBeNull()
    expect(change.language).toBe('ja')
  })

  test('entry languages normalize with en folded back to absent', () => {
    // `en` folds to undefined (a bare line means English); other codes keep
    // their canonical lowercase spelling on the entry.
    const entries: WireEntry[] = [{ language: 'EN' }, { language: 'JA' }, {}]
    expect(normalizeRequestLanguages([], entries)).toBeNull()
    expect(entries[0]!.language).toBeUndefined()
    expect(entries[1]!.language).toBe('ja')
    expect(entries[2]!.language).toBeUndefined()
  })

  test('an unknown entry language is refused', async () => {
    const message = await refusalMessage(normalizeRequestLanguages([], [{ language: 'xx' }]))
    expect(message).toContain('"xx"')
    expect(message).toContain('a card entry')
  })
})

/**
 * The tag-validation boundary the three save routes share. The grammar itself
 * is pinned on `src/card/card-tags.ts`; what belongs here is what the boundary
 * does with the wire: canonicalize a typed tag, refuse a malformed or missing
 * one, and fold an empty set to "none" on both the changes and the entries the
 * deck and wanted routes re-serialize.
 */
describe('normalizeRequestTags', () => {
  /** A request entry as the unvalidated wire carries it. */
  type WireEntry = { tags?: unknown }

  test('a typed add-tag tag is canonicalized in place: sigil stripped, whitespace folded', () => {
    const change = wireChange({ action: 'add-tag', cardId: 1, tag: '# Card  Draw ' })
    expect(normalizeRequestTags([change], [])).toBeNull()
    expect((change as { tag?: string }).tag).toBe('Card Draw')
  })

  test('a malformed tag on a tag event is refused with the parser’s message', async () => {
    const change = wireChange({ action: 'remove-tag', cardId: 1, tag: 'a,b' })
    const message = await refusalMessage(normalizeRequestTags([change], []))
    expect(message).toBe(invalidCardTagMessage('a,b'))
  })

  test('a tag event without a string tag is refused, never coerced', async () => {
    // `String(undefined)` is a perfectly tag-shaped "undefined": the boundary
    // must refuse the missing field rather than write `#undefined`.
    for (const tag of [undefined, null, ['ramp']]) {
      const change = wireChange({ action: 'add-tag', cardId: 1, tag })
      const message = await refusalMessage(normalizeRequestTags([change], []))
      expect(message).toContain('requires a string "tag"')
    }
  })

  test('the tags an add carries are canonicalized, with an empty set folded to absent', () => {
    const tagged = wireChange({ action: 'add', tags: ['staple', '#Ramp', 'Ramp '] })
    const cleared = wireChange({ action: 'add', tags: [] })
    const bare = wireChange({ action: 'add' })
    expect(normalizeRequestTags([tagged, cleared, bare], [])).toBeNull()
    expect((tagged as { tags?: string[] }).tags).toEqual(['Ramp', 'staple'])
    expect((cleared as { tags?: string[] }).tags).toBeUndefined()
    expect((bare as { tags?: string[] }).tags).toBeUndefined()
  })

  test('a move’s tags are canonicalized and a malformed one refused, like an add’s', async () => {
    const moved = wireChange({ action: 'move-to', cardId: 1, tags: ['#Ramp ', 'Ramp'] })
    expect(normalizeRequestTags([moved], [])).toBeNull()
    expect((moved as { tags?: string[] }).tags).toEqual(['Ramp'])
    const bad = wireChange({ action: 'move-from', cardId: 1, tags: ['a,b'] })
    expect(await refusalMessage(normalizeRequestTags([bad], []))).toBe(invalidCardTagMessage('a,b'))
  })

  test('a malformed tags array on an add is refused', async () => {
    const change = wireChange({ action: 'add', tags: ['ramp', 'a&b'] })
    const message = await refusalMessage(normalizeRequestTags([change], []))
    expect(message).toBe(invalidCardTagMessage('a&b'))
    const notArray = wireChange({ action: 'add', tags: 'ramp' })
    expect(await refusalMessage(normalizeRequestTags([notArray], []))).toContain('tags must be')
  })

  test('entry tags are canonicalized the same way, and a malformed one is refused', async () => {
    const entries: WireEntry[] = [{ tags: ['#B', 'a'] }, { tags: [] }, {}]
    expect(normalizeRequestTags([], entries)).toBeNull()
    expect(entries[0]!.tags).toEqual(['a', 'B'])
    expect(entries[1]!.tags).toBeUndefined()
    expect(entries[2]!.tags).toBeUndefined()

    const message = await refusalMessage(normalizeRequestTags([], [{ tags: ['a,b'] }]))
    expect(message).toBe(invalidCardTagMessage('a,b'))
  })
})

/**
 * The category-validation boundary the three save routes share. The vocabulary
 * rules are pinned on `src/card/card-categories.ts`; what belongs here is what
 * the boundary does with the wire — canonicalize, refuse a malformed value, and
 * keep an empty list, which is a meaningful clear rather than "no categories".
 */
describe('normalizeRequestCategories', () => {
  test('a set-categories list is canonicalized in place, keeping its order', () => {
    const change = wireChange({ action: 'set-categories', categories: [' Ramp ', 'ramp', 'Draw'] })
    expect(normalizeRequestCategories([change])).toBeNull()
    expect((change as { categories?: string[] }).categories).toEqual(['Ramp', 'Draw'])
  })

  test('an empty categories array is accepted as a clear', () => {
    const change = wireChange({ action: 'set-categories', categories: [] })
    expect(normalizeRequestCategories([change])).toBeNull()
    expect((change as { categories?: string[] }).categories).toEqual([])
  })

  test('a set-category-order list is canonicalized too', () => {
    const change = wireListChange({ action: 'set-category-order', order: ['Ramp', ' ramp '] })
    expect(normalizeRequestCategories([change])).toBeNull()
    expect((change as { order?: string[] }).order).toEqual(['Ramp'])
  })

  test('a rename-category’s two names are canonicalized', () => {
    const change = wireListChange({
      action: 'rename-category',
      category: ' Draw ',
      newCategory: 'Card  Draw',
    })
    expect(normalizeRequestCategories([change])).toBeNull()
    expect((change as { category?: string }).category).toBe('Draw')
    expect((change as { newCategory?: string }).newCategory).toBe('Card Draw')
  })

  test('a non-array categories or order is refused', async () => {
    for (const change of [
      wireChange({ action: 'set-categories', categories: 'Ramp' }),
      wireListChange({ action: 'set-category-order', order: 'Ramp' }),
    ]) {
      expect(await refusalMessage(normalizeRequestCategories([change]))).toContain(
        'must be an array of categories',
      )
    }
  })

  test('a non-string rename name is refused, never coerced', async () => {
    for (const fields of [
      { action: 'rename-category', newCategory: 'B' },
      { action: 'rename-category', category: 'A', newCategory: 7 },
    ]) {
      const message = await refusalMessage(normalizeRequestCategories([wireListChange(fields)]))
      expect(message).toContain('requires a string')
    }
  })

  test('a malformed category name is refused with the parser’s message', async () => {
    const change = wireChange({ action: 'set-categories', categories: ['a,b'] })
    expect(await refusalMessage(normalizeRequestCategories([change]))).toBe(
      invalidCardCategoryMessage('a,b'),
    )
  })

  test('a smuggled cardId is refused on every category action', async () => {
    // The body is cast unvalidated and `cardId` is a persisted key, so a foreign
    // list's `&N` would otherwise land in this list's changelog prose.
    for (const change of [
      wireChange({ action: 'set-categories', cardId: 12, categories: ['Ramp'] }),
      wireListChange({ action: 'set-category-order', cardId: 12, order: ['Ramp'] }),
      wireListChange({
        action: 'rename-category',
        cardId: 12,
        category: 'Draw',
        newCategory: 'Card Draw',
      }),
    ]) {
      expect(await refusalMessage(normalizeRequestCategories([change]))).toContain(
        'must not carry a "cardId"',
      )
    }
  })

  test('a cardName is refused on the two list-level actions', async () => {
    for (const change of [
      wireChange({ action: 'set-category-order', order: ['Ramp'] }),
      wireChange({ action: 'rename-category', category: 'Draw', newCategory: 'Card Draw' }),
    ]) {
      expect(await refusalMessage(normalizeRequestCategories([change]))).toContain(
        'must not carry a "cardName"',
      )
    }
  })
})
