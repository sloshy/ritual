import { describe, expect, test } from 'bun:test'
import {
  normalizeRequestLanguages,
  readJsonObjectBody,
  type ApiErrorResponse,
} from '../../../src/admin/api/save-helpers'
import { createSetLanguageChange, type ChangeEvent } from '../../../src/changes/change-event'

/**
 * The shared JSON-body route prologue. Its two refusal messages are pinned here
 * rather than in each adopting handler's suite: they are the *shared* wording,
 * and a handler test asserting them would only re-pin what this owns.
 */

/** Build a POST request carrying `raw` verbatim as its body. */
function post(raw: string): Request {
  return new Request('http://localhost/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  })
}

/** A refusal, unpacked for assertion. */
type Refusal = { status: number; body: ApiErrorResponse }

/** The refusal body a non-ok outcome carries, failing the test if it succeeded. */
async function refuse(raw: string): Promise<Refusal> {
  const result = await readJsonObjectBody(post(raw))
  if (result.ok) throw new Error('expected a refusal, got a parsed body')
  return {
    status: result.response.status,
    body: (await result.response.json()) as ApiErrorResponse,
  }
}

describe('readJsonObjectBody', () => {
  test('parses a JSON object through', async () => {
    const result = await readJsonObjectBody(post('{"format":"csv","write":true}'))
    expect(result.ok && result.body).toEqual({ format: 'csv', write: true })
  })

  test('unparseable JSON is refused as a 400', async () => {
    const { status, body } = await refuse('{not json')
    expect(status).toBe(400)
    expect(body.message).toBe('Request body must be JSON.')
  })

  test.each([
    ['an array', '[1,2]'],
    ['a bare string', '"nope"'],
    ['null', 'null'],
  ])('%s parses but is not an object', async (_label, raw) => {
    const { status, body } = await refuse(raw)
    expect(status).toBe(400)
    expect(body.message).toBe('Request body must be a JSON object.')
  })
})

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
