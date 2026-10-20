import { describe, expect, test } from 'bun:test'
import path from 'node:path'

/**
 * The `errors.i18n.*` fragment is *seeded* by `src/i18n/runtime.ts`, not
 * registered by a surface — so the translation machinery can word its own
 * failures in a process that registered nothing. Every in-process test runs
 * after `test/preload.ts`, whose registrations would mask a missing seed (the
 * `en` barrel carries the fragment too), so this spawns a bare `bun -e` that
 * imports the runtime and renders straight from it.
 */

const REPO_ROOT = path.resolve(import.meta.dir, '../..')

const SCRIPT = `
const { registeredMessageCount, DEFAULT_LOCALE } = await import('./src/i18n/runtime.ts')
const { tIn } = await import('./src/i18n/t.ts')
process.stdout.write(JSON.stringify({
  frame: tIn(DEFAULT_LOCALE, 'errors.i18n.strict.frame', { reason: 'x', envVar: 'RITUAL_I18N_STRICT' }),
  unhandled: tIn(DEFAULT_LOCALE, 'errors.invariant.unhandled', { value: '"y"' }),
  unregistered: tIn(DEFAULT_LOCALE, 'cli.serve.pageNotFound'),
  count: registeredMessageCount(),
}))
`

/** What the spawned process reports. */
type SeedReport = { frame: string; unhandled: string; unregistered: string; count: number }

describe('the errors.i18n seed', () => {
  test('resolves in a process that registered no namespace', async () => {
    const child = Bun.spawn(['bun', '-e', SCRIPT], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      // Strict mode off: the unregistered key below must degrade, not throw.
      env: { ...process.env, RITUAL_I18N_STRICT: '0' },
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    const report = JSON.parse(stdout) as SeedReport
    expect(report.frame).toBe('i18n: x (RITUAL_I18N_STRICT=1)')
    expect(report.unhandled).toBe(
      'Internal error: no case handles the value "y". This is a bug in Ritual.',
    )
    // The control: a key from a namespace nobody registered really is missing
    // in this process, so the two above resolved through the seed alone.
    expect(report.unregistered).toBe('cli.serve.pageNotFound')
    expect(report.count).toBeGreaterThan(0)
  })
})
