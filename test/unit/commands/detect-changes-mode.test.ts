import { describe, test, expect } from 'bun:test'
import { selectDetectChangesMode } from '../../../src/commands/detect-changes'

/**
 * The mode matrix is pure: which flag/argument combinations resolve to which
 * mode, and which are refused. The CLI wiring (exit code 2, stderr envelope) is
 * pinned once in the integration suite.
 */
describe('selectDetectChangesMode', () => {
  test('a bare commit selects git detection and carries the commit through', () => {
    const selection = selectDetectChangesMode('HEAD~1', {})
    expect(selection).toEqual({ ok: true, mode: 'detect', commit: 'HEAD~1' })
  })

  test('--hash-only and --verify each select their own mode', () => {
    expect(selectDetectChangesMode(undefined, { hashOnly: true })).toEqual({
      ok: true,
      mode: 'hash-only',
    })
    expect(selectDetectChangesMode(undefined, { verify: true })).toEqual({
      ok: true,
      mode: 'verify',
    })
  })

  test('--hash-only with --dry-run still selects hash-only (the stamp is previewable)', () => {
    expect(selectDetectChangesMode(undefined, { hashOnly: true, dryRun: true })).toEqual({
      ok: true,
      mode: 'hash-only',
    })
  })

  test('the two modes are mutually exclusive', () => {
    const selection = selectDetectChangesMode(undefined, { hashOnly: true, verify: true })
    expect(selection).toEqual({
      ok: false,
      message: '--hash-only and --verify cannot be combined.',
    })
  })

  test('--verify rejects --dry-run, since it never writes', () => {
    const selection = selectDetectChangesMode(undefined, { verify: true, dryRun: true })
    expect(selection.ok).toBe(false)
    expect(selection.ok === false && selection.message).toContain('--verify never writes')
  })

  test('a commit is refused alongside a no-git mode, naming the flag that ignores it', () => {
    for (const [options, flag] of [
      [{ hashOnly: true }, '--hash-only'],
      [{ verify: true }, '--verify'],
    ] as const) {
      const selection = selectDetectChangesMode('HEAD~1', options)
      expect(selection).toEqual({
        ok: false,
        message: `The <commit> argument is not used with ${flag}.`,
      })
    }
  })

  test('git detection without a commit points at the no-git modes', () => {
    const selection = selectDetectChangesMode(undefined, {})
    expect(selection.ok).toBe(false)
    expect(selection.ok === false && selection.message).toContain(
      'use --hash-only / --verify to work without git',
    )
  })
})
