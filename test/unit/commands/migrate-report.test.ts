import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { applyAndReport, printPlan } from '../../../src/commands/migrate'
import { t } from '../../../src/i18n/t'
import { COMMAND, CONFIG_KEY, commandLine } from '../../../src/util/cli-tokens'
import {
  DEV_BUILD,
  dropKeyMigration,
  expectPlan,
  fixedMigration,
  REFRESH_DUE_CONFIG,
} from '../../helpers/migrations'
import { bindWorkspace, writeConfig, type BoundWorkspace } from '../../helpers/workspace'

/**
 * How `ritual migrate` words numbered migrations: the plan's heading and op
 * lines, the applied line, the backup folder named relative to the workspace,
 * and a dev build's warning that it left the CI pin behind. The shipped list
 * may be empty, so test migrations stand in; the binary's path is covered by
 * test/integration/migrate.test.ts.
 */

const SET_DECKS_DIR = fixedMigration(1, [
  { type: 'config-set', path: ['decksDir'], value: './lists' },
])
/** Already satisfied (no `site.retired`), so it plans no ops. */
const SATISFIED = dropKeyMigration(2, ['site', 'retired'])
const MIGRATIONS = [SET_DECKS_DIR, SATISFIED]

/** What the test migrations' description renders as. */
const DESCRIPTION = t('cli.migrate.planHeading')

describe('migrate report', () => {
  const log = spyOn(console, 'log').mockImplementation(() => {})
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  let ws: BoundWorkspace

  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: {} })
  })
  afterEach(async () => {
    await ws.dispose()
    log.mockClear()
    warn.mockClear()
  })
  afterAll(() => {
    log.mockRestore()
    warn.mockRestore()
  })

  const logged = (): string[] => log.mock.calls.map(([line]) => String(line))
  const warned = (): string[] => warn.mock.calls.map(([line]) => String(line))

  test('the plan names each migration with ops, then its op lines, and skips the rest', async () => {
    printPlan(await expectPlan({ migrations: MIGRATIONS }))

    expect(logged()).toEqual([
      t('cli.migrate.planHeading'),
      `Migration 1: ${DESCRIPTION}`,
      '  set decksDir = "./lists" in ritual.config.json',
    ])
  })

  test('applying reports the migration and the workspace-relative backup', async () => {
    await applyAndReport(await expectPlan({ migrations: MIGRATIONS }))

    const lines = logged()
    expect(lines[0]).toBe(`✓ Applied migration 1: ${DESCRIPTION}`)
    const backup = lines[1]?.match(/^✓ Saved a copy of the files it changed in (.+)$/)?.[1]
    expect(backup).toMatch(/^\.backups[\\/][\dTZ-]+-migration-1$/)
    expect(lines.join('\n')).not.toContain(ws.dir)
    expect(lines.at(-1)).toBe(t('cli.migrate.done'))
  })

  test.each([
    [
      'no pin',
      {},
      t('cli.migrate.devBuildNoPin', {
        version: DEV_BUILD.version,
        configKey: CONFIG_KEY.managedVersion,
        command: commandLine(COMMAND.migrate),
      }),
    ],
    [
      'a pin it leaves behind',
      { managed: { migration: 0, version: '1.0.0' } },
      t('cli.migrate.devBuild', {
        version: DEV_BUILD.version,
        pinned: '1.0.0',
        configKey: CONFIG_KEY.managedVersion,
        command: commandLine(COMMAND.migrate),
      }),
    ],
  ])('a dev build applying a migration warns about %s', async (_label, config, expected) => {
    await writeConfig(ws.dir, config)

    await applyAndReport(await expectPlan({ migrations: MIGRATIONS }))

    expect(warned()).toEqual([expected])
  })

  test('a refresh-only apply by a dev build takes no backup and does not warn', async () => {
    await writeConfig(ws.dir, REFRESH_DUE_CONFIG)

    await applyAndReport(await expectPlan({ migrations: [] }))

    expect(logged().some((line) => line.includes('.backups'))).toBeFalse()
    expect(logged().at(-1)).toBe(t('cli.migrate.done'))
    expect(warned()).toEqual([])
  })
})
