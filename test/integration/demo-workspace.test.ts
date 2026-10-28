import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { repoRoot, runCli, withTempDir, type CliResult } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import { snapshotTree } from '../helpers/workspace'
import { parseChangeSets } from '../../src/changes/changelog-blocks'
import type { CleanupReport } from '../../src/commands/cleanup'
import type { VerifyReport } from '../../src/commands/detect-changes'

/**
 * The committed `demo/` workspace (built into the live demo site by
 * deploy-docs.yml) is user data like any other workspace: a format change
 * ships as a `ritual migrate` migration, and that migration must be applied
 * to `demo/` in the same change. This suite fails until it is.
 *
 * It runs against a temp copy of the files git would commit (never the
 * card cache or a built site), offline, so it can neither write into the real
 * `demo/` folder nor reach Scryfall.
 */

const DEMO_DIR = path.join(repoRoot, 'demo')

/** `demo/`'s committable files (tracked, or untracked and not ignored), relative to `demo/`. */
async function demoFiles(): Promise<string[]> {
  const proc = Bun.spawn(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
    {
      cwd: DEMO_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new Error(`git ls-files failed (exit ${code}): ${stderr}`)
  return stdout.split('\0').filter((file) => file !== '')
}

/** Run `body` in a temp copy of the demo workspace; returns the copied files. */
async function withDemoCopy(body: (dir: string, files: string[]) => Promise<void>): Promise<void> {
  const files = await demoFiles()
  await withTempDir(async (dir) => {
    for (const file of files) {
      const source = path.join(DEMO_DIR, file)
      if (!(await Bun.file(source).exists())) {
        throw new Error(`demo/${file} is tracked by git but missing from the working tree`)
      }
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
      await fs.copyFile(source, path.join(dir, file))
    }
    await body(dir, files)
  })
}

/** Parse a command's JSON stdout, failing with its full output when it is not JSON. */
function parseJson<T>(result: CliResult): T {
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new Error(
      `expected JSON (exit ${result.exitCode})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    )
  }
}

/** A list file, as opposed to its `.changes.md` changelog or the README. */
function isListFile(file: string): boolean {
  return /^(decks|collections|wanted)\/.+\.md$/.test(file) && !file.endsWith('.changes.md')
}

describe('demo workspace (Integration)', () => {
  test('is migrated, canonical, warning-free, and its sidecars and histories are intact', async () => {
    await withDemoCopy(async (dir, files) => {
      const before = await snapshotTree(dir)
      expect(files).toContain('ritual.config.json')

      const migrate = await runCli(['migrate', '--check'], dir, OFFLINE_ENV)
      expect(migrate).toMatchObject({ exitCode: 0 })

      // Every list file and categories sidecar the demo commits is covered, and clean.
      const verify = await runCli(
        ['detect-changes', '--verify', '--output', 'json'],
        dir,
        OFFLINE_ENV,
      )
      const report = parseJson<VerifyReport>(verify)
      expect(report.files.filter((f) => f.state !== 'clean')).toEqual([])
      expect(report.files.map((f) => f.file).sort()).toEqual(
        files.filter((f) => isListFile(f) || f.endsWith('.categories.json')).sort(),
      )
      expect(verify.exitCode).toBe(0)

      // `cleanup --check` parses every list: a parse warning or advisory, a
      // non-canonical line (including one missing its `&N`), or a stale
      // categories entry would surface here.
      const cleanup = await runCli(['cleanup', '--check', '--output', 'json'], dir, OFFLINE_ENV)
      expect(parseJson<CleanupReport>(cleanup)).toEqual({ files: [], warnings: [] })
      expect(cleanup.exitCode).toBe(0)

      // Every list has a history the site can show: a changelog that drifted from
      // the grammar would parse to zero changes and read as an empty history.
      for (const list of files.filter(isListFile)) {
        const changelog = list.replace(/\.md$/, '.changes.md')
        expect(files).toContain(changelog)
        const parsed = parseChangeSets(await fs.readFile(path.join(dir, changelog), 'utf-8'), list)
        expect({ changelog, advisories: parsed.advisories }).toEqual({ changelog, advisories: [] })
        expect(parsed.sets.length).toBeGreaterThan(0)
        for (const set of parsed.sets) {
          expect(set.events.length).toBe(set.lines.length)
        }
        const stamps = parsed.sets.map((set) => set.timestamp)
        expect(stamps).toEqual([...stamps].sort())
      }

      expect(await snapshotTree(dir)).toEqual(before)
    })
  })
})
