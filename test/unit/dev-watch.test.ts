import { describe, test, expect } from 'bun:test'
import { shouldRestartForSource } from '../../scripts/dev-watch'

describe('shouldRestartForSource', () => {
  test('restarts on hand-edited source files', () => {
    const files = [
      'site/app.tsx',
      'commands/build-site.ts',
      'site/styles.css',
      'site/icons/mana.svg',
      // A file merely named "generated" elsewhere is not under a generated dir.
      'site/generated-helpers.ts',
    ]
    expect(files.filter((f) => shouldRestartForSource(f))).toEqual(files)
  })

  // Regression: `bun run build` (e.g. from `bun run precommit`) rewrites these
  // back into src/ and must not trigger a restart of an active `bun run dev`.
  test('does not restart on build-generated assets or unrelated extensions', () => {
    const files = [
      'README.md',
      'site/data.json',
      'site/styles.compiled.css',
      'admin/site/styles.compiled.css',
      'site/app.compiled.js',
      'admin/site/app.compiled.js',
      'generated/dep-licenses.ts',
      'nested/generated/thing.ts',
    ]
    expect(files.filter((f) => shouldRestartForSource(f))).toEqual([])
  })
})
