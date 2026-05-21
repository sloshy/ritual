import { describe, test, expect } from 'bun:test'
import { isWatchedSource, isGeneratedAsset, shouldRestartForSource } from '../../scripts/dev-watch'

describe('isWatchedSource', () => {
  test('true for hand-edited source extensions', () => {
    expect(isWatchedSource('site/app.tsx')).toBe(true)
    expect(isWatchedSource('commands/build-site.ts')).toBe(true)
    expect(isWatchedSource('site/styles.css')).toBe(true)
    expect(isWatchedSource('site/icons/mana.svg')).toBe(true)
  })

  test('false for unrelated extensions', () => {
    expect(isWatchedSource('site/app.compiled.js')).toBe(false)
    expect(isWatchedSource('README.md')).toBe(false)
    expect(isWatchedSource('site/data.json')).toBe(false)
  })
})

describe('isGeneratedAsset', () => {
  test('true for build-written compiled assets', () => {
    expect(isGeneratedAsset('site/styles.compiled.css')).toBe(true)
    expect(isGeneratedAsset('admin/site/styles.compiled.css')).toBe(true)
    expect(isGeneratedAsset('site/app.compiled.js')).toBe(true)
    expect(isGeneratedAsset('admin/site/app.compiled.js')).toBe(true)
  })

  test('true for anything under src/generated', () => {
    expect(isGeneratedAsset('generated/dep-licenses.ts')).toBe(true)
    expect(isGeneratedAsset('nested/generated/thing.ts')).toBe(true)
  })

  test('false for hand-edited sources', () => {
    expect(isGeneratedAsset('site/styles.css')).toBe(false)
    expect(isGeneratedAsset('site/app.tsx')).toBe(false)
    // A file merely named "generated" elsewhere is not under a generated dir.
    expect(isGeneratedAsset('site/generated-helpers.ts')).toBe(false)
  })
})

describe('shouldRestartForSource', () => {
  test('restarts on real source edits', () => {
    expect(shouldRestartForSource('site/app.tsx')).toBe(true)
    expect(shouldRestartForSource('site/styles.css')).toBe(true)
  })

  // Regression: `bun run build` (e.g. from `bun run precommit`) rewrites these
  // back into src/ and must not trigger a restart of an active `bun run dev`.
  test('does not restart on build-generated assets', () => {
    expect(shouldRestartForSource('site/styles.compiled.css')).toBe(false)
    expect(shouldRestartForSource('admin/site/styles.compiled.css')).toBe(false)
    expect(shouldRestartForSource('generated/dep-licenses.ts')).toBe(false)
  })
})
