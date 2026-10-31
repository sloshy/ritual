import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import { withWorkspace } from '../helpers/workspace'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import type { CacheSchema } from '../../src/cache/file-cache'

/**
 * `build-site --refresh ask` asks before a bulk download like every other
 * command, so a run that cannot ask (here `--no-input`, with stdout a pipe)
 * downloads nothing — and its card-fetch progress, written to a pipe, is a few
 * whole lines rather than a stream of `\r` redraws.
 */
describe('build-site --refresh ask without prompts (Integration)', () => {
  test('skips the never-downloaded cache download and prints plain progress lines', async () => {
    await withWorkspace(
      async (dir) => {
        createSyntheticWorkspace(dir)
        // A cache that holds every card but was never bulk-downloaded: the one
        // state `build-site` used to download for without asking.
        const cachePath = path.join(dir, 'cache', 'cache.json')
        const cache = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as CacheSchema
        delete cache.metadata
        await fs.writeFile(cachePath, JSON.stringify(cache))

        const result = await runCli(['--no-input', 'build-site', '--refresh', 'ask'], dir, {
          ...OFFLINE_ENV,
          RITUAL_CACHE_DIR: 'cache',
        })

        expect(result.exitCode).toBe(0)
        // The cache it reads is the one just edited, and nothing was downloaded into it.
        expect(result.stdout).toContain(`Card data is cached in ${path.join(dir, 'cache')}.`)
        expect(result.stdout).toContain('Skipped the card cache download')
        const after = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as CacheSchema
        expect(after.metadata).toBeUndefined()
        expect(result.stdout).not.toContain('Downloading from Scryfall')
        expect(result.stdout).not.toContain('\r')
        // The seed has six cards: a plain line at the start, at each 25% milestone
        // crossed, and at the end — never a redraw per card.
        expect(result.stdout).toContain('Found 6 unique cards.')
        const progress = result.stdout
          .split('\n')
          .filter((line) => /^\d+% \(\d+\/\d+\)$/.test(line))
        expect(progress).toEqual(['0% (0/6)', '33% (2/6)', '50% (3/6)', '83% (5/6)', '100% (6/6)'])
      },
      { dirs: [], config: false },
    )
  }, 120_000)
})
