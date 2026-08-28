import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { withWorkspace } from '../helpers/workspace'

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

  test('--api builds the missing site itself, accepting --refresh as the cache policy', async () => {
    await withWorkspace(async (dir) => {
      // The empty workspace fails the build for lack of lists, which is proof
      // enough that --api reached a build instead of refusing over the dist.
      const result = await runCli(['serve', '--api', '--refresh', 'never'], dir)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).not.toContain('only appl')
      expect(result.stdout).toContain('Building site...')
      expect(result.stderr).toContain('Nothing to build')
    })
  })

  test('a dist directory with no index.html is refused instead of serving 404s', async () => {
    await withWorkspace(async (dir) => {
      // A build interrupted in place used to leave exactly this: a directory
      // with assets and no entry point, which `serve` happily served as 404s.
      await fs.mkdir(path.join(dir, 'dist', 'images'), { recursive: true })

      const result = await runCli(['serve'], dir)

      expect(result.exitCode).toBe(1)
      // Without --api the build *is* the content, so serve refuses rather than
      // building one itself.
      expect(result.stdout).not.toContain('Building site...')
      expect(result.stderr).toContain('No built site found')
      expect(result.stderr).toContain('ritual build-site')
      expect(result.stderr).toContain('--build')
      expect(result.stdout).not.toContain('Serving site')
    })
  })

  test('--out-dir is exempt from the build-only guard and resolved for serving', async () => {
    await withWorkspace(async (dir) => {
      // A serving server would block, so the assertion is on what `serve` does
      // *before* binding: it accepts the flag (rather than demanding --build)
      // and then fails on the resolved directory's missing index.html.
      const missing = await runCli(['serve', '--out-dir', 'nope'], dir)

      expect(missing.exitCode).toBe(1)
      // The build-only rejection would name the flag and tell you to add --build.
      expect(missing.stderr).not.toContain('only appl')
      expect(missing.stderr).toContain(path.join(dir, 'nope'))
      expect(missing.stderr).toContain('--out-dir nope')
    })
  })

  test('--sell-mode is exempt from the build-only guard under --api', async () => {
    await withWorkspace(async (dir) => {
      // The live server reads sell mode per request, so the session override the
      // flag sets has a reader without --build. The empty workspace then fails
      // the build --api runs itself, which is proof the flag was accepted.
      const result = await runCli(['serve', '--api', '--sell-mode', '--refresh', 'never'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).not.toContain('only appl')
      expect(result.stderr).toContain('Nothing to build')
    })
  })

  test('--sell-mode without --build or --api is a usage error', async () => {
    await withWorkspace(async (dir) => {
      // A plain `serve` hands out pre-built files: nothing in that process ever
      // consults sell mode, so the flag would be a silent no-op.
      const result = await runCli(['serve', '--sell-mode'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--sell-mode')
      expect(result.stderr).toContain('--build')
    })
  })

  test('other build-only flags are still rejected with --api but without --build', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['serve', '--api', '--verbose'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--verbose')
      expect(result.stderr).toContain('--build')
    })
  })
})
