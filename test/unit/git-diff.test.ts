import { describe, test, expect } from 'bun:test'
import {
  parseNameStatus,
  classifyFile,
  changesPath,
  gitStderrSummary,
  GitCommandError,
} from '../../src/changes/git-diff'
import { describeGitFailure } from '../../src/commands/detect-changes'

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

  test('keeps a categories sidecar under every status — it has its own hash and events', () => {
    const raw = [
      'M\tdecks/my-deck.categories.json',
      'A\tcollections/Binder.categories.json',
      'D\twanted/Wish.categories.json',
    ].join('\n')
    expect(parseNameStatus(raw).map((change) => change.path)).toEqual([
      'decks/my-deck.categories.json',
      'collections/Binder.categories.json',
      'wanted/Wish.categories.json',
    ])
  })

  test('keeps a rename whose new path is a categories sidecar', () => {
    const raw = 'R090\tdecks/old.categories.json\tdecks/new.categories.json\n'
    expect(parseNameStatus(raw)[0]).toEqual({
      status: 'R',
      oldPath: 'decks/old.categories.json',
      path: 'decks/new.categories.json',
    })
  })

  test('still drops JSON outside the list directories and unrelated JSON inside them', () => {
    const raw = [
      'M\tnotes.categories.json',
      'M\tdecks/notes.json',
      'M\tdecks/my-deck.art.json',
    ].join('\n')
    expect(parseNameStatus(raw)).toEqual([])
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

describe('gitStderrSummary', () => {
  test('returns the first non-empty stderr line of a failed subprocess', () => {
    expect(gitStderrSummary({ stderr: "\nfatal: bad revision 'HEAD~9'\nhint: try again\n" })).toBe(
      "fatal: bad revision 'HEAD~9'",
    )
  })

  test('reads a Buffer stderr, as execFileSync produces without an encoding', () => {
    expect(gitStderrSummary({ stderr: Buffer.from('fatal: detected dubious ownership\n') })).toBe(
      'fatal: detected dubious ownership',
    )
  })

  test('is null when git said nothing — the signal a --quiet probe relies on', () => {
    expect(gitStderrSummary({ stderr: '   \n\n' })).toBeNull()
    expect(gitStderrSummary({ status: 1 })).toBeNull()
    expect(gitStderrSummary(new Error('boom'))).toBeNull()
    expect(gitStderrSummary(null)).toBeNull()
  })
})

describe('describeGitFailure', () => {
  test('reports the Ritual operation first and git detail on a second line', () => {
    const error = new GitCommandError('Failed to read decks/a.md at HEAD~1', 'fatal: bad object')
    expect(describeGitFailure(error, 'unused prefix')).toBe(
      'Failed to read decks/a.md at HEAD~1\n  git: fatal: bad object',
    )
  })

  test('omits the git line when git gave no detail', () => {
    expect(describeGitFailure(new GitCommandError('Failed to resolve HEAD~1', null), 'p')).toBe(
      'Failed to resolve HEAD~1',
    )
  })

  test('falls back to the prefix for a non-git error', () => {
    expect(describeGitFailure(new Error('EACCES'), 'Failed to detect changes')).toBe(
      'Failed to detect changes: EACCES',
    )
  })
})
