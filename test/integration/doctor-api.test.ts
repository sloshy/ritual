import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleDoctor, type DoctorResponse } from '../../src/admin/api/doctor'
import { clearCacheServerAddressOverride } from '../../src/cache/config'
import { setMigrationProbe } from '../../src/doctor/collect'
import { DOCTOR_CHECK_IDS } from '../../src/doctor/report'
import { doctorMigrationProbe } from '../../src/migrate/doctor-probe'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

/**
 * `GET /api/doctor` — the admin route over the report `ritual doctor --output
 * json` prints. The verdicts are pinned on the engine and the CLI path in
 * `doctor.test.ts`; this pins the route's wiring: the success envelope, a
 * failing check still answering 200, and that the report reads the config
 * file as it is on disk now rather than as the server loaded it.
 */

let workspace: BoundWorkspace
const originalCacheServer = process.env.RITUAL_CACHE_SERVER

beforeEach(async () => {
  delete process.env.RITUAL_CACHE_SERVER
  clearCacheServerAddressOverride()
  workspace = await bindWorkspace({ init: true, clearCardCache: true })
  // What `index.ts` installs at startup.
  setMigrationProbe(doctorMigrationProbe)
})

afterEach(async () => {
  setMigrationProbe(null)
  await workspace.dispose()
  if (originalCacheServer === undefined) delete process.env.RITUAL_CACHE_SERVER
  else process.env.RITUAL_CACHE_SERVER = originalCacheServer
})

async function doctor(): Promise<DoctorResponse> {
  const resp = await handleDoctor()
  expect(resp.status).toBe(200)
  return (await resp.json()) as DoctorResponse
}

describe('handleDoctor', () => {
  test('the route wraps the report in the success envelope', async () => {
    const body = await doctor()
    expect(body.success).toBe(true)
    expect(body.ok).toBe(true)
    expect(body.checks.map((check) => check.id)).toEqual([...DOCTOR_CHECK_IDS])
    expect(body.workspace.baseDir).toBe(workspace.dir)
    // The probe `index.ts` installs answered: the workspace's config is current.
    expect(body.migrations.state).toBe('current')
    expect(body.cache.dir).toBe(path.join(workspace.dir, 'cache'))
  })

  test('a config broken after the server loaded it is a failing check, still a 200', async () => {
    await fs.writeFile(
      path.join(workspace.dir, 'ritual.config.json'),
      JSON.stringify({ updateCheck: 'sometimes' }),
    )
    const body = await doctor()
    expect(body.ok).toBe(false)
    expect(body.config.state).toBe('invalid')
    const config = body.checks.find((check) => check.id === 'config')
    // English plus its key: what an agent reads, and what a client re-renders.
    expect(config?.summary.messageKey).toBe('domain.doctor.config.invalid')
    expect(config?.details[0]?.message).toContain('updateCheck')
    // The migration plan would refuse the same setting: that check stands aside.
    expect(body.migrations).toEqual({ state: 'unknown', remedy: null, problem: null })
  })
})
