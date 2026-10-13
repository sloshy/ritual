import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { GitCommandError, getFileAtCommit } from '../../src/changes/git-diff'
import { withSyntheticLocale } from '../helpers/sync-text'
import { withTempDir } from './helpers/cli'

/** The error a call threw, failing the test when it returned. */
function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected the git call to fail')
}

/**
 * A failed git command names the Ritual operation first, in the CLI's language,
 * with git's own words kept apart as the detail (`detect-changes` prints both).
 */
describe('git failures (Integration)', () => {
  test('a read at a missing commit names the file, the commit and the repository', async () => {
    await withTempDir(async (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      const error = thrownBy(() => getFileAtCommit('nope', 'decks/a.md', dir))
      expect(error).toBeInstanceOf(GitCommandError)
      expect((error as GitCommandError).message).toBe(`Failed to read decks/a.md at nope in ${dir}`)
      expect((error as GitCommandError).gitDetail).not.toBeNull()
    })
  })

  test('the operation follows the CLI’s language; git’s detail stays as git wrote it', async () => {
    await withTempDir(async (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      const english = thrownBy(() => getFileAtCommit('nope', 'decks/a.md', dir)) as GitCommandError
      const error = withSyntheticLocale(
        'xx',
        { 'cli.detectChanges.gitReadFailed': '{file} bei {commit} in {dir} unlesbar' },
        () => thrownBy(() => getFileAtCommit('nope', 'decks/a.md', dir)),
      ) as GitCommandError
      expect(error.message).toBe(`decks/a.md bei nope in ${dir} unlesbar`)
      expect(error.gitDetail).toBe(english.gitDetail)
    })
  })
})
