import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { isPathWithinDir } from '../../src/path-validation'

describe('isPathWithinDir', () => {
  const baseDir = '/home/user/decks'

  test('allows a file directly within the directory', () => {
    expect(isPathWithinDir(path.join(baseDir, 'my-deck.md'), baseDir)).toBe(true)
  })

  test('allows a file in a subdirectory', () => {
    expect(isPathWithinDir(path.join(baseDir, 'sub', 'my-deck.md'), baseDir)).toBe(true)
  })

  test('rejects path traversal with ../', () => {
    expect(isPathWithinDir(path.join(baseDir, '..', 'etc', 'passwd'), baseDir)).toBe(false)
  })

  test('rejects deep path traversal', () => {
    expect(isPathWithinDir(path.join(baseDir, '..', '..', 'etc', 'passwd'), baseDir)).toBe(false)
  })

  test('rejects path that resolves to the base directory itself', () => {
    expect(isPathWithinDir(baseDir, baseDir)).toBe(false)
  })

  test('rejects path that is a sibling with prefix overlap', () => {
    // e.g., /home/user/decks-evil should not be allowed by /home/user/decks
    expect(isPathWithinDir('/home/user/decks-evil/file.md', baseDir)).toBe(false)
  })
})
