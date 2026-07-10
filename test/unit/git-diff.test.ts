import { describe, test, expect } from 'bun:test'
import { parseNameStatus, classifyFile, changesPath } from '../../src/git-diff'

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

  test('filters out non-list files', () => {
    const raw = [
      'M\tpackage.json',
      'M\tsrc/types.ts',
      'M\tdecks/my-deck.md',
      'M\tdecks/my-deck.changes.md',
      'M\tREADME.md',
    ].join('\n')

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

describe('classifyFile', () => {
  test('classifies deck files', () => {
    expect(classifyFile('decks/my-deck.md')).toBe('deck')
  })

  test('classifies collection files', () => {
    expect(classifyFile('collections/my-collection.md')).toBe('collection')
  })

  test('classifies wanted files', () => {
    expect(classifyFile('wanted/my-list.md')).toBe('wanted')
  })

  test('returns null for non-list files', () => {
    expect(classifyFile('README.md')).toBeNull()
    expect(classifyFile('src/index.ts')).toBeNull()
  })

  test('returns null for .changes.md files', () => {
    expect(classifyFile('decks/my-deck.changes.md')).toBeNull()
  })

  test('returns null for .primer.md files', () => {
    expect(classifyFile('decks/my-deck.primer.md')).toBeNull()
  })

  test('returns null for non-md files in list directories', () => {
    expect(classifyFile('decks/notes.txt')).toBeNull()
  })

  test('classifies files in subdirectories', () => {
    expect(classifyFile('decks/edh/voltron.md')).toBe('deck')
    expect(classifyFile('collections/sets/mh3.md')).toBe('collection')
  })
})

describe('changesPath', () => {
  test('converts a list path to its changes path', () => {
    expect(changesPath('decks/my-deck.md')).toBe('decks/my-deck.changes.md')
    expect(changesPath('wanted/sets/mh3.md')).toBe('wanted/sets/mh3.changes.md')
  })
})
