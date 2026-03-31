import { describe, test, expect } from 'bun:test'
import { parseNameStatus } from '../../src/git-diff'

describe('parseNameStatus', () => {
  test('parses modified deck file', () => {
    const raw = 'M\tdecks/my-deck.md\n'
    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      status: 'M',
      oldPath: 'decks/my-deck.md',
      path: 'decks/my-deck.md',
    })
  })

  test('parses added collection file', () => {
    const raw = 'A\tcollections/Binder.md\n'
    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      status: 'A',
      oldPath: 'collections/Binder.md',
      path: 'collections/Binder.md',
    })
  })

  test('parses deleted wanted file', () => {
    const raw = 'D\twanted/Old List.md\n'
    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      status: 'D',
      oldPath: 'wanted/Old List.md',
      path: 'wanted/Old List.md',
    })
  })

  test('parses rename with similarity score', () => {
    const raw = 'R085\tdecks/old-name.md\tdecks/new-name.md\n'
    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      status: 'R',
      oldPath: 'decks/old-name.md',
      path: 'decks/new-name.md',
    })
  })

  test('parses rename across directories', () => {
    const raw = 'R100\tcollections/Old.md\tcollections/New.md\n'
    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('R')
    expect(result[0]!.oldPath).toBe('collections/Old.md')
    expect(result[0]!.path).toBe('collections/New.md')
  })

  test('filters out non-list files', () => {
    const raw = ['M\tpackage.json', 'M\tsrc/types.ts', 'M\tdecks/my-deck.md', 'M\tREADME.md'].join(
      '\n',
    )

    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe('decks/my-deck.md')
  })

  test('filters out .changes.md files', () => {
    const raw = ['M\tdecks/my-deck.md', 'M\tdecks/my-deck.changes.md'].join('\n')

    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe('decks/my-deck.md')
  })

  test('filters out .primer.md files', () => {
    const raw = ['M\tdecks/my-deck.md', 'M\tdecks/my-deck.primer.md'].join('\n')

    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe('decks/my-deck.md')
  })

  test('parses multiple files', () => {
    const raw = [
      'M\tdecks/deck-a.md',
      'A\tcollections/New Binder.md',
      'D\twanted/Old List.md',
      'R090\tdecks/renamed.md\tdecks/new-renamed.md',
    ].join('\n')

    const result = parseNameStatus(raw)
    expect(result).toHaveLength(4)
    expect(result[0]!.status).toBe('M')
    expect(result[1]!.status).toBe('A')
    expect(result[2]!.status).toBe('D')
    expect(result[3]!.status).toBe('R')
  })

  test('handles empty input', () => {
    const result = parseNameStatus('')
    expect(result).toHaveLength(0)
  })

  test('handles trailing newlines', () => {
    const raw = 'M\tdecks/my-deck.md\n\n\n'
    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
  })

  test('ignores unknown status codes', () => {
    const raw = 'T\tdecks/something.md\nC\tdecks/other.md\nM\tdecks/valid.md\n'
    const result = parseNameStatus(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('M')
  })
})
