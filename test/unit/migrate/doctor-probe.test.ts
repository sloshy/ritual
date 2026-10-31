import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { DoctorConfigFacts } from '../../../src/doctor/report'
import { doctorMigrationProbe } from '../../../src/migrate/doctor-probe'
import { latestMigrationId } from '../../../src/migrate/migrations'
import { syncText } from '../../../src/sync/message'
import { bindWorkspace, writeConfig, type BoundWorkspace } from '../../helpers/workspace'

/**
 * `ritual doctor`'s migration check: how a plan of the workspace on disk maps
 * onto the report's migration facts. The plan itself is the runner's (pinned
 * in its own suites); this pins the mapping, in a throwaway workspace.
 */

let workspace: BoundWorkspace

beforeEach(async () => {
  workspace = await bindWorkspace()
})

afterEach(async () => {
  await workspace.dispose()
})

const VALID: DoctorConfigFacts = { state: 'valid', problems: [] }

describe('doctorMigrationProbe', () => {
  test('a workspace at the latest migration is current', async () => {
    await writeConfig(workspace.dir, { managed: { migration: latestMigrationId() } })
    expect(await doctorMigrationProbe(VALID)).toEqual({
      state: 'current',
      remedy: null,
      problem: null,
    })
  })

  test('a due managed-output refresh is a pending update', async () => {
    await writeConfig(workspace.dir, {
      site: { ciSystem: 'manual' },
      managed: { migration: latestMigrationId(), output: 'sha256:stale' },
    })
    expect(await doctorMigrationProbe(VALID)).toEqual({
      state: 'pending',
      remedy: null,
      problem: null,
    })
  })

  test('a config the plan would refuse is invalid, unless the config check already failed it', async () => {
    await writeConfig(workspace.dir, { cacheSource: 'torrent' })
    const facts = await doctorMigrationProbe(VALID)
    expect(facts.state).toBe('invalid')
    expect(facts.problem).not.toBeNull()
    expect(await doctorMigrationProbe({ state: 'invalid', problems: [] })).toEqual({
      state: 'unknown',
      remedy: null,
      problem: null,
    })
  })

  test('a workspace a newer release updated names `self-update --tag` with that release', async () => {
    await writeConfig(workspace.dir, { managed: { migration: 9999, version: '9.0.0' } })
    expect(await doctorMigrationProbe(VALID)).toEqual({
      state: 'ahead',
      remedy: 'ritual self-update --tag 9.0.0',
      problem: null,
    })
  })

  test('a newer migration without a recorded release falls back to plain self-update', async () => {
    await writeConfig(workspace.dir, { managed: { migration: 9999 } })
    expect((await doctorMigrationProbe(VALID)).remedy).toBe('ritual self-update')
  })

  test('no config file, or one that cannot be read, plans nothing', async () => {
    expect(await doctorMigrationProbe({ state: 'absent', problems: [] })).toMatchObject({
      state: 'no-config',
    })
    const unreadable: DoctorConfigFacts = { state: 'unreadable', problems: [syncText('bad JSON')] }
    expect(await doctorMigrationProbe(unreadable)).toEqual({
      state: 'unknown',
      remedy: null,
      problem: null,
    })
  })
})
