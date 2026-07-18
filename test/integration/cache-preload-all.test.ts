import { describe, expect, test } from 'bun:test'
import { runCli, withTempDir } from './helpers/cli'

/**
 * `ritual cache preload-all` flag validation. Only the offline-safe usage path
 * is pinned at the CLI layer: a real preload downloads the full Scryfall bulk
 * (or needs a live feed), so the engine's source resolution and its
 * failure-to-exit-1 mapping stay covered by the refreshCardCache unit tests
 * (test/unit/cache-refresh-source.test.ts) instead of a network-dependent run.
 */
describe('cache preload-all CLI (Integration)', () => {
  test('--source scryfall with --url is a usage error', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['cache', 'preload-all', '--source', 'scryfall', '--url', 'https://feed.example/feed.json'],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("--url only applies when the cache source is 'feed'")
    })
  })
})
