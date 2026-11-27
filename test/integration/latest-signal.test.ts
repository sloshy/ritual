import { expect, test } from 'bun:test'
import path from 'node:path'
import type { LatestSignalProbe } from '../fixtures/latest-signal-probe'

/**
 * `createLatestSignal` against Solid's client reactive core. Under `bun test`
 * `solid-js` resolves to its server build, where every write lands at once and
 * a read before the flush cannot go stale — so the probe runs in its own Bun
 * process with the `browser` condition.
 */
test('a read before the flush sees the write, where a plain signal and a memo do not', async () => {
  const probePath = path.join(import.meta.dir, '../fixtures/latest-signal-probe.ts')
  const proc = Bun.spawn([process.execPath, '--conditions=browser', probePath], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  expect(exitCode).toBe(0)
  const probe = JSON.parse(out) as LatestSignalProbe
  expect(probe).toEqual({
    latestBeforeFlush: 5,
    // The controls: a plain signal and a memo still answer the old value.
    plainBeforeFlush: 1,
    memoBeforeFlush: 2,
    memoAfterFlush: 10,
    chained: ['a', 'b'],
    clearedReturn: undefined,
    clearedRead: undefined,
  })
})
