import { describe, expect, test } from 'bun:test'
import { runCli } from './helpers/cli'
import { withWorkspace } from './helpers/workspace'

/**
 * Wiring pins for the merged `serve [--build]` command: build-only flags are
 * rejected without `--build`, and a failed build never starts the server.
 * (The card-ID hook interaction is pinned in ensure-ids-hook.test.ts, and the
 * actual serving path is exercised by the Playwright global setup.)
 */
describe('serve command (Integration)', () => {
  test('a build-only flag without --build is a usage error naming the flag', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['serve', '--refresh', 'never'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--refresh')
      expect(result.stderr).toContain('--build')
    })
  })

  test('multiple offending build-only flags are all named', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['serve', '--refresh', 'never', '--verbose'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--refresh, --verbose')
    })
  })

  test('a failed build under --build exits without starting the server', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['serve', '--build', '--theme', 'bogus'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stdout).toContain('Building site...')
      expect(result.stdout).not.toContain('Serving site')
    })
  })
})
