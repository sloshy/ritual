import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'
import { withWorkspace, writeDeckFile } from '../helpers/workspace'
import type { DoctorReport } from '../../src/doctor/report'
import { ExitCode } from '../../src/util/errors'

/**
 * `ritual doctor` end to end: the facts gathered from a real workspace, the
 * command's text and JSON output, and its exit code. Every verdict's wording
 * and branch is pinned on the engine (`test/unit/doctor-report.test.ts`).
 */

// A cache server in the developer's shell would turn the cache facts into a
// server address; doctor never asks it, but the assertions below expect the
// local cache.
const ENV = { RITUAL_CACHE_SERVER: undefined }

/** One `doctor --output json` run: its exit code and the report it printed. */
type DoctorRun = { exitCode: number; report: DoctorReport }

async function doctorJson(dir: string): Promise<DoctorRun> {
  const result = await runCli(['doctor', '--output', 'json'], dir, ENV)
  return { exitCode: result.exitCode, report: JSON.parse(result.stdout) as DoctorReport }
}

describe('ritual doctor (Integration)', () => {
  test('a workspace with lists: counts, a valid config, and a report to paste', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'Elves', { cards: [{ name: 'Llanowar Elves', quantity: 1 }] })

      const { exitCode, report } = await doctorJson(dir)
      expect(exitCode).toBe(ExitCode.Success)
      expect(report.ok).toBe(true)
      expect(report.workspace.baseDir).toBe(await fs.realpath(dir))
      expect(report.workspace.folders.deck).toMatchObject({ exists: true, lists: 1 })
      expect(report.config).toEqual({ state: 'valid', problems: [] })
      // The migration probe `index.ts` installs answered (without it: unknown).
      expect(report.migrations.state).toBe('current')
      // The preload pins RITUAL_CACHE_DIR=cache; nothing has filled it.
      expect(report.cache).toMatchObject({ dirSource: 'env', dirExists: false, server: null })
      expect(report.cache.status?.empty).toBe(true)

      const text = await runCli(['doctor'], dir, ENV)
      expect(text.exitCode).toBe(ExitCode.Success)
      expect(text.stdout).toContain('1 deck, 0 collections, 0 wanted lists')
      expect(text.stdout).toContain(`Paste this into a bug report: ${report.ritual.issuesUrl}`)
    })
  })

  test('a broken config is reported, not refused, and fails the run', async () => {
    await withWorkspace(async (dir) => {
      await fs.writeFile(path.join(dir, 'ritual.config.json'), '{ "decksDir": ')

      const { exitCode, report } = await doctorJson(dir)
      expect(exitCode).toBe(ExitCode.RuntimeError)
      expect(report.ok).toBe(false)
      expect(report.config.state).toBe('unreadable')
      expect(report.workspace.configFile).toBe(true)
      expect(report.migrations).toEqual({ state: 'unknown', remedy: null, problem: null })
      expect(report.checks.find((c) => c.id === 'config')?.status).toBe('fail')
    })
  })

  test('an empty folder is reported as no workspace, and doctor leaves it empty', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['doctor'], dir, ENV)
      expect(result.exitCode).toBe(ExitCode.Success)
      expect(result.stdout).toContain('does not look like a Ritual workspace')
      expect(await fs.readdir(dir)).toEqual([])
    })
  })
})
