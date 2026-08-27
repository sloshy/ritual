import { describe, expect, test } from 'bun:test'
import { renamePrompt } from '../../../src/cli/import-prompts'
import type { SaveConflict } from '../../../src/importers/save-list'

/** The [R]ename follow-up names what is being renamed: a deck's file, or a list of the given kind. */
describe('renamePrompt', () => {
  test.each<[string, SaveConflict, string]>([
    [
      'a deck asks for a filename',
      { file: 'A.md', reason: 'id', listType: 'deck' },
      'new filename',
    ],
    [
      'a collection asks for a collection name',
      { file: 'A.md', reason: 'name', listType: 'collection' },
      'collection name',
    ],
    [
      'a wanted list asks for a wanted list name',
      { file: 'A.md', reason: 'name', listType: 'wanted' },
      'wanted list name',
    ],
  ])('%s', (_label, conflict, expected) => {
    expect(renamePrompt(conflict)).toContain(expected)
  })
})
