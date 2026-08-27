import { describe, expect, test } from 'bun:test'
import { normalizeRequestLanguages } from '../../../src/admin/api/save-helpers'
import { createSetLanguageChange, type ChangeEvent } from '../../../src/changes/change-event'
import type { ApiErrorResponse } from '../../../src/api/http'

/**
 * The one language-validation boundary all three save routes share. The full
 * matrix (normalization, refusals, the entry-side en fold) lives here; each
 * save-route integration test keeps exactly one 400 case proving the route
 * wires this validator in front of its write.
 */
describe('normalizeRequestLanguages', () => {
  /** A request entry as the unvalidated wire carries it. */
  type WireEntry = { language?: unknown }

  /** A raw wire change: the request body is cast unvalidated, which is the point. */
  function wireChange(fields: Record<string, unknown>): ChangeEvent {
    return { id: 'x', timestamp: 0, cardName: 'Sol Ring', ...fields } as unknown as ChangeEvent
  }

  /** The 400 body of a refusal, failing the test on a pass-through. */
  async function refusalMessage(response: Response | null): Promise<string> {
    if (response === null) throw new Error('expected a 400 refusal, got null')
    expect(response.status).toBe(400)
    return ((await response.json()) as ApiErrorResponse).message
  }

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
