import { describe, it, expect } from 'bun:test'
import type { ChangeEvent } from '../../src/change-event'
import {
  buildChangeFile,
  serializeChangeFile,
  parseChangeFile,
  type ChangeFile,
} from '../../src/editor/change-file'

const sampleChanges: ChangeEvent[] = [
  { id: 'a1', timestamp: 1000, action: 'add', cardName: 'Sol Ring', cardId: 5 },
  { id: 'r1', timestamp: 1001, action: 'remove', cardName: 'Llanowar Elves', cardId: 9 },
]

const build = (): ChangeFile =>
  buildChangeFile({
    kind: 'deck',
    slug: 'my-deck',
    name: 'My Deck',
    changes: sampleChanges,
    baseContentHash: 'hash123',
    exportedAt: '2026-06-04T00:00:00.000Z',
  })

describe('change-file round trip', () => {
  it('serializes and parses back to an equivalent file', () => {
    const parsed = parseChangeFile(serializeChangeFile(build()))
    expect(typeof parsed).not.toBe('string')
    expect(parsed).toEqual(build())
  })

  it('preserves the change list verbatim', () => {
    const parsed = parseChangeFile(serializeChangeFile(build()))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.changes).toEqual(sampleChanges)
  })

  it('omits baseContentHash when not provided', () => {
    const file = buildChangeFile({
      kind: 'wanted',
      slug: 's',
      name: 'n',
      changes: [],
      exportedAt: '2026-06-04T00:00:00.000Z',
    })
    expect(file.baseContentHash).toBeUndefined()
  })
})

describe('parseChangeFile validation', () => {
  it('rejects non-JSON', () => {
    expect(parseChangeFile('not json{')).toContain('JSON')
  })

  it('rejects a non-object payload', () => {
    expect(parseChangeFile('42')).toContain('object')
  })

  it('rejects a missing format marker', () => {
    expect(parseChangeFile(JSON.stringify({ version: 1, changes: [] }))).toContain(
      'ritual change file',
    )
  })

  it('rejects an unsupported version', () => {
    const text = JSON.stringify({ ...build(), version: 2 })
    expect(parseChangeFile(text)).toContain('version')
  })

  it('rejects an invalid kind', () => {
    const text = JSON.stringify({ ...build(), kind: 'sideboard' })
    expect(parseChangeFile(text)).toContain('kind')
  })

  it('rejects a non-array changes field', () => {
    const text = JSON.stringify({ ...build(), changes: 'nope' })
    expect(parseChangeFile(text)).toContain('changes')
  })

  it('rejects a change with an unknown action', () => {
    const text = JSON.stringify({ ...build(), changes: [{ action: 'teleport' }] })
    const result = parseChangeFile(text)
    expect(result).toContain('unknown action')
  })

  it('accepts a valid file with section-structural changes', () => {
    const text = JSON.stringify({
      ...build(),
      changes: [{ id: 's1', timestamp: 1, action: 'add-section', section: 'Lands' }],
    })
    expect(typeof parseChangeFile(text)).not.toBe('string')
  })
})
