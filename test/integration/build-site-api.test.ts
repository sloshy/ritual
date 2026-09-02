/**
 * `POST /api/build-site`'s plumbing: the atomic publish, the failure path, the
 * one-at-a-time guard, cancellation, and the stale-directory sweep.
 *
 * The child process is stubbed through the handler's argv seam rather than
 * spawning a real multi-minute site build — what is under test here is the
 * publish protocol around the build, not the build itself (which the CLI's own
 * suites cover).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  defaultBuildArgv,
  handleBuildSite,
  handleBuildSiteStream,
  STALE_BUILD_DIR_MAX_AGE_MS,
  type BuildSiteResponse,
  type BuildSiteStreamEvent,
} from '../../src/admin/api/build-site'
import { parseSseFrames, readStreamFrames } from '../helpers/sse'
import type { RouteProgress } from '../../src/util/progress'
import { clearSiteSellModeOverride, setSiteSellModeOverride } from '../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace()
})

afterEach(async () => {
  await ws.dispose()
})

/** A child that writes a one-file "site" into the scratch directory and exits 0. */
function succeedingBuild(outDir: string): string[] {
  return ['sh', '-c', `printf 'new' > "$0/index.html"`, outDir]
}

/** A child that writes nothing and exits non-zero, with something on stderr. */
function failingBuild(): string[] {
  return ['sh', '-c', 'echo "boom" >&2; exit 3']
}

/** A succeeding child that first sleeps, so a second call can race it. */
function sleepingBuild(seconds: number): (outDir: string) => string[] {
  return (outDir) => ['sh', '-c', `sleep ${seconds}; printf 'new' > "$0/index.html"`, outDir]
}

/** Leftover scratch/parked directories beside `dist/`. */
async function buildLeftovers(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir)
  return entries.filter((n) => n.startsWith('.dist-build-') || n.startsWith('.dist-old-'))
}

/** Create a leftover build directory whose mtime is `ageMs` in the past. */
async function seedLeftover(dir: string, name: string, ageMs: number): Promise<string> {
  const leftover = path.join(dir, name)
  await fs.mkdir(leftover, { recursive: true })
  const when = new Date(Date.now() - ageMs)
  await fs.utimes(leftover, when, when)
  return leftover
}

/** A child that narrates two lines (one on each pipe) before writing its site. */
function talkativeBuild(outDir: string): string[] {
  return [
    'sh',
    '-c',
    `echo "Rendering decks"; echo "Warning: no cover image" >&2; printf 'new' > "$0/index.html"`,
    outDir,
  ]
}

async function exists(target: string): Promise<boolean> {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

describe('handleBuildSite (Integration)', () => {
  test('publishes the child’s output into dist/ and cleans up after itself', async () => {
    const reports: RouteProgress[] = []
    const resp = await handleBuildSite({
      onProgress: (report) => reports.push(report),
      buildArgv: succeedingBuild,
    })

    expect(resp.status).toBe(200)
    const body = (await resp.json()) as BuildSiteResponse
    expect(body.success).toBe(true)
    expect(body.outDir).toBe(path.join(ws.dir, 'dist'))
    expect(body.durationMs).toBeGreaterThanOrEqual(0)

    expect(await fs.readFile(path.join(ws.dir, 'dist', 'index.html'), 'utf-8')).toBe('new')
    expect(await buildLeftovers(ws.dir)).toEqual([])

    // Progress is monotonic and ends on the scale's endpoint.
    expect(reports.map((r) => r.progress)).toEqual([0, 1, 2, 3])
    expect(reports.every((r) => r.total === 3)).toBeTrue()
  })

  test('hands the child’s output over line by line, whichever pipe it came on', async () => {
    const lines: string[] = []
    const resp = await handleBuildSite({
      onOutput: (line) => lines.push(line),
      buildArgv: talkativeBuild,
    })

    expect(resp.status).toBe(200)
    expect(lines).toContain('Rendering decks')
    expect(lines).toContain('Warning: no cover image')
    expect(await fs.readFile(path.join(ws.dir, 'dist', 'index.html'), 'utf-8')).toBe('new')
  })

  test('replaces a previous dist/ rather than merging into it', async () => {
    const dist = path.join(ws.dir, 'dist')
    await fs.mkdir(dist, { recursive: true })
    await fs.writeFile(path.join(dist, 'stale.html'), 'old')

    const resp = await handleBuildSite({ buildArgv: succeedingBuild })
    expect(resp.status).toBe(200)

    expect(await fs.readdir(dist)).toEqual(['index.html'])
    expect(await buildLeftovers(ws.dir)).toEqual([])
  })

  test('a failing build leaves the published site untouched and stops reporting progress', async () => {
    const dist = path.join(ws.dir, 'dist')
    await fs.mkdir(dist, { recursive: true })
    await fs.writeFile(path.join(dist, 'index.html'), 'published')

    const reports: RouteProgress[] = []
    const resp = await handleBuildSite({
      onProgress: (report) => reports.push(report),
      buildArgv: failingBuild,
    })

    expect(resp.status).toBe(500)
    const body = (await resp.json()) as { success: false; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toContain('exit 3')
    expect(body.message).toContain('boom')

    // The scale stops where the run did: nothing claims the publish or the
    // completion step for a build that produced no site.
    expect(reports.map((r) => r.progress)).toEqual([0, 1])

    // The whole point of the scratch directory: the live site is still the old one.
    expect(await fs.readFile(path.join(dist, 'index.html'), 'utf-8')).toBe('published')
    expect(await buildLeftovers(ws.dir)).toEqual([])
  })

  test('refuses a second concurrent build with 503', async () => {
    const first = handleBuildSite({ buildArgv: sleepingBuild(0.4) })
    // Give the first call time to claim the in-flight flag before racing it.
    await Bun.sleep(50)
    const second = await handleBuildSite({ buildArgv: succeedingBuild })

    expect(second.status).toBe(503)
    expect(((await second.json()) as { message: string }).message).toContain('already running')

    const firstResp = await first
    expect(firstResp.status).toBe(200)
    // `durationMs` is the wall clock of this build, not a constant: the child
    // slept 400ms, so anything under that is not measuring the build.
    expect(((await firstResp.json()) as BuildSiteResponse).durationMs).toBeGreaterThanOrEqual(400)
  })

  test('an aborted build is cancelled, never touches dist/, and releases the in-flight flag', async () => {
    const dist = path.join(ws.dir, 'dist')
    await fs.mkdir(dist, { recursive: true })
    await fs.writeFile(path.join(dist, 'index.html'), 'published')

    const controller = new AbortController()
    // Five seconds of sleep the abort has to cut short: if the kill regressed,
    // the elapsed assertion below fails as an assertion rather than as a
    // whole-suite timeout, which says nothing about what broke.
    const startedAt = Date.now()
    const pending = handleBuildSite({ signal: controller.signal, buildArgv: sleepingBuild(5) })
    await Bun.sleep(50)
    controller.abort()

    const resp = await pending
    expect(Date.now() - startedAt).toBeLessThan(2000)
    expect(resp.status).toBe(499)
    expect(await fs.readFile(path.join(dist, 'index.html'), 'utf-8')).toBe('published')
    expect(await buildLeftovers(ws.dir)).toEqual([])

    // The flag is released on the cancelled path too, so the next build is not
    // refused with a 503 forever.
    const next = await handleBuildSite({ buildArgv: succeedingBuild })
    expect(next.status).toBe(200)
    expect(await fs.readFile(path.join(dist, 'index.html'), 'utf-8')).toBe('new')
  })

  describe('GET /api/build-site/stream', () => {
    test('streams the steps and the output, then a done frame with the publish details', async () => {
      const resp = await handleBuildSiteStream(talkativeBuild)
      expect(resp.headers.get('Content-Type')).toBe('text/event-stream')
      const frames = parseSseFrames(await resp.text())

      const progress = frames
        .filter((frame) => frame.event === 'progress')
        .map((frame) => frame.data as unknown as BuildSiteStreamEvent)
      // The three steps ride the same channel as the child's lines, told apart
      // by `kind`, and the steps still climb the whole scale.
      expect(progress.filter((e) => e.kind === 'step').map((e) => e.progress)).toEqual([0, 1, 2, 3])
      const output = progress.flatMap((e) => (e.kind === 'output' ? [e.line] : []))
      expect(output).toContain('Rendering decks')
      expect(output).toContain('Warning: no cover image')

      const done = frames.at(-1)
      expect(done?.event).toBe('done')
      expect(done?.data).toMatchObject({
        message: 'Site built successfully',
        messageKey: 'admin.api.buildSite.built',
        outDir: path.join(ws.dir, 'dist'),
      })
      expect(typeof done?.data.durationMs).toBe('number')
      expect(await fs.readFile(path.join(ws.dir, 'dist', 'index.html'), 'utf-8')).toBe('new')
    })

    test('a failed build ends the stream on an error frame carrying the reason', async () => {
      const resp = await handleBuildSiteStream(failingBuild)
      const frames = parseSseFrames(await resp.text())

      const last = frames.at(-1)
      expect(last?.event).toBe('error')
      expect(String(last?.data.message)).toContain('exit 3')
      expect(String(last?.data.message)).toContain('boom')
      expect(frames.some((frame) => frame.event === 'done')).toBe(false)
    })

    test('is registered on the admin route table', async () => {
      // Dispatched through the table so the method + path registration is
      // covered; the real child command is what a live server runs, so only the
      // one-at-a-time refusal is provoked, which never spawns it.
      const holding = handleBuildSite({ buildArgv: sleepingBuild(0.4) })
      await Bun.sleep(50)
      const frames = await readStreamFrames('/api/build-site/stream')
      expect(frames).toEqual([
        {
          event: 'error',
          data: { message: 'A site build is already running; wait for it to finish.' },
        },
      ])
      expect((await holding).status).toBe(200)
    })
  })

  /**
   * The child inherits this process's environment but not its in-memory state,
   * so anything the server holds only in memory has to be spelled onto the
   * command line or it is silently lost across the spawn.
   */
  describe('the default child command line', () => {
    afterEach(() => {
      clearSiteSellModeOverride()
    })

    test('names the server’s own base dir and output directory', () => {
      const argv = defaultBuildArgv(path.join(ws.dir, 'dist'))

      // An exported RITUAL_BASE_DIR would otherwise outrank the spawn's cwd and
      // build a different workspace than the server's.
      expect(argv).toContain('--base-dir')
      expect(argv).toContain(ws.dir)
      expect(argv).toContain('build-site')
      expect(argv).toContain(path.join(ws.dir, 'dist'))
    })

    test('omits --sell-mode when the server has sell mode off', () => {
      expect(defaultBuildArgv(path.join(ws.dir, 'dist'))).not.toContain('--sell-mode')
    })

    test('forwards --sell-mode under a session override, which no spawn can inherit', () => {
      // `ritual admin --sell-mode` sets a process-global override. Without this
      // the server advertises sell mode and then publishes a site with it off.
      setSiteSellModeOverride(true)

      expect(defaultBuildArgv(path.join(ws.dir, 'dist'))).toContain('--sell-mode')
    })
  })

  test('sweeps only leftovers old enough to be abandoned', async () => {
    // Another live process's scratch directory looks exactly like this one's,
    // so the sweep goes by age: removing a fresh foreign directory would delete
    // a running build's output, or the only copy of the site inside another
    // process's publish swap.
    const stale = await seedLeftover(ws.dir, '.dist-old-999-1', STALE_BUILD_DIR_MAX_AGE_MS + 60_000)
    const fresh = await seedLeftover(ws.dir, '.dist-build-999-2', 0)

    const resp = await handleBuildSite({ buildArgv: succeedingBuild })
    expect(resp.status).toBe(200)

    expect(await exists(stale)).toBe(false)
    expect(await exists(fresh)).toBe(true)
  })
})
