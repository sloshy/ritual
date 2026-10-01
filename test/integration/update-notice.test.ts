import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'

/**
 * A spawned CLI is both a local build (never a release) and a scripted run
 * (stderr is a pipe), and either gate alone keeps the update notice out of its
 * way: no notice even with a cache naming a newer release, and no lookup — the
 * stale cache is left exactly as it was (a lookup, answered or not, records
 * itself). Which gate fired cannot be told apart here; each is pinned on its
 * own in-process by test/unit/commands/update-notice.test.ts.
 */
describe('update notice (Integration)', () => {
  test('a scripted run of a development build never announces or looks anything up', async () => {
    await withTempDir(async (dir) => {
      const stateDir = path.join(dir, 'state')
      await fs.mkdir(stateDir)
      const stateFile = path.join(stateDir, 'state.json')
      const stale = `${JSON.stringify({
        updateCheck: { channel: 'stable', checkedAt: 0, latest: '999.0.0' },
      })}\n`
      await fs.writeFile(stateFile, stale)

      const result = await runCli(['lists'], dir, {
        RITUAL_STATE_DIR: stateDir,
        CI: undefined,
        RITUAL_NO_UPDATE_CHECK: undefined,
        RITUAL_INSTALL: undefined,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stderr).not.toContain('999.0.0')
      expect(await fs.readFile(stateFile, 'utf-8')).toBe(stale)
    })
  })
})
