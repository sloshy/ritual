import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import prompts from 'prompts'
import { Command } from 'commander'
import { buildProgram } from '../../../src/cli/program'
import { addDryRunOption, addOutputOption } from '../../../src/cli/options'
import { COMMAND_GROUPS } from '../../../src/commands/registry'
import {
  checkWorkspaceMigrations,
  isMigrationCheckExempt,
  MIGRATION_CHECK_EXEMPT,
} from '../../../src/commands/migrate-check'
import { qualifiedCommandName } from '../../../src/cli/command-name'
import { getRitualConfig } from '../../../src/config/ritual-config'
import { latestMigrationId } from '../../../src/migrate/migrations'
import { t } from '../../../src/i18n/t'
import { setNoInputOverride } from '../../../src/util/no-input'
import { readUserState, writeUserStateSection } from '../../../src/util/user-state'
import { captureExitCode, NO_UPDATE_NOTICE } from '../../helpers/cli'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import { stubTty } from '../../test-utils'

/** Resolve `argv` against the real command tree to the command whose action would run. */
function actionCommandFor(argv: string[]): Command {
  const program = buildProgram({
    groups: COMMAND_GROUPS,
    backfill: () => false,
    workspaceCheck: () => Promise.resolve(),
    updateNotice: NO_UPDATE_NOTICE,
  })
  let command: Command = program
  for (const name of argv) {
    const next = command.commands.find((sub) => sub.name() === name)
    if (next === undefined) break
    command = next
  }
  return command
}

describe('migration check exemptions', () => {
  test('a name that only starts with an exempt one is not exempt', () => {
    const near = new Command('ritual').command('mcp-proxy')
    expect(isMigrationCheckExempt(near)).toBeFalse()
  })

  test('every exempt name except Commander’s own help is a registered command', () => {
    const registered = new Set(actionCommandFor([]).commands.map((command) => command.name()))
    const missing = MIGRATION_CHECK_EXEMPT.filter(
      (name) => name !== 'help' && !registered.has(name),
    )
    expect(missing).toEqual([])
  })

  test.each<[string[], string, boolean]>([
    [['migrate'], 'migrate', true],
    [['self-update'], 'self-update', true],
    [['init-site'], 'init-site', true],
    [['mcp'], 'mcp', true],
    [['config', 'set'], 'config set', true],
    [['lists'], 'lists', false],
    [['deck-sync', 'pull'], 'deck-sync pull', false],
    [['cache', 'feed', 'host'], 'cache feed host', false],
  ])('%j', (argv, qualified, exempt) => {
    const command = actionCommandFor(argv)
    expect(qualifiedCommandName(command)).toBe(qualified)
    expect(isMigrationCheckExempt(command)).toBe(exempt)
  })
})

/**
 * The interactive offer, driven through the real preAction hook with a probe
 * command. The confirm answer comes from prompts.inject; ask() still wants a
 * terminal, and the offer also wants one on stdout.
 */
describe('the pre-command migration offer', () => {
  stubTty({ stdin: true, stdout: true })

  const OLD_CONFIG = { site: { version: '0.0.1', ciSystem: 'manual' } }
  const log = spyOn(console, 'log').mockImplementation(() => {})
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  const error = spyOn(console, 'error').mockImplementation(() => {})
  /** Ambient variables that would steer the run: saved, cleared per test, restored after. */
  const AMBIENT = ['CI', 'RITUAL_STATE_DIR', 'RITUAL_BASE_DIR', 'RITUAL_NO_INPUT'] as const
  const original = new Map(AMBIENT.map((name) => [name, process.env[name]]))
  let ws: BoundWorkspace
  let stateDir: string
  /** The `managed.migration` the probe's config load saw, or null when it did not run. */
  let probeSaw: number | null

  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: OLD_CONFIG })
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-state-'))
    for (const name of AMBIENT) delete process.env[name]
    process.env.RITUAL_STATE_DIR = stateDir
    probeSaw = null
  })
  afterEach(async () => {
    await ws.dispose()
    await fs.rm(stateDir, { recursive: true, force: true })
    log.mockClear()
    warn.mockClear()
    error.mockClear()
    setNoInputOverride(undefined)
  })
  afterAll(() => {
    log.mockRestore()
    warn.mockRestore()
    error.mockRestore()
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  /**
   * Run the probe through `buildProgram`, not `runInProcess`: the check lives
   * in the root preAction hook. `--base-dir` pins the bound workspace.
   */
  function run(args: string[]): Promise<number> {
    const program = buildProgram({
      groups: [
        {
          titleKey: 'help.group.utilities',
          commands: [
            (root) => {
              const probe = addOutputOption(root.command('probe')).option('-y, --yes')
              addDryRunOption(probe, 'dry run').action(() => {
                probeSaw = getRitualConfig().managed?.migration ?? 0
              })
            },
          ],
        },
      ],
      backfill: () => false,
      workspaceCheck: checkWorkspaceMigrations,
      updateNotice: NO_UPDATE_NOTICE,
    })
    return captureExitCode(() =>
      program.parseAsync(['--base-dir', ws.dir, ...args], { from: 'user' }),
    )
  }

  const readConfig = async (): Promise<string> =>
    fs.readFile(path.join(ws.dir, 'ritual.config.json'), 'utf-8')
  const warned = (key: 'cli.migrate.notice.pending' | 'cli.migrate.offerDeclined'): boolean =>
    warn.mock.calls.some(([message]) => message === t(key))

  test('yes migrates, then the command runs against the migrated config', async () => {
    prompts.inject([true])

    expect(await run(['probe'])).toBe(0)

    expect(JSON.parse(await readConfig()).site).toEqual({ ciSystem: 'manual' })
    expect(probeSaw).toBe(latestMigrationId())
    const { migratePrompts } = await readUserState()
    expect(Object.keys(migratePrompts)).toEqual([path.resolve(ws.dir)])
  })

  // A read-only config makes the apply's first write fail (root ignores the
  // mode, so the case cannot be exercised there).
  test.skipIf(process.getuid?.() === 0)(
    'a failed apply is reported and the command still runs',
    async () => {
      await fs.chmod(path.join(ws.dir, 'ritual.config.json'), 0o444)
      prompts.inject([true])

      expect(await run(['probe'])).toBe(0)

      expect(error).toHaveBeenCalledTimes(1)
      expect(probeSaw).toBe(0)
    },
  )

  test('no leaves the workspace alone, runs the command, and snoozes the prompt', async () => {
    const before = await readConfig()
    prompts.inject([false])

    expect(await run(['probe'])).toBe(0)

    expect(await readConfig()).toBe(before)
    expect(probeSaw).toBe(0)
    expect(warned('cli.migrate.offerDeclined')).toBeTrue()
    const { migratePrompts } = await readUserState()
    expect(Object.keys(migratePrompts)).toEqual([path.resolve(ws.dir)])
  })

  // An injected yes would migrate had either run prompted, so an unchanged
  // config proves the prompt never opened.
  test('a workspace asked about today only gets the notice', async () => {
    await writeUserStateSection('migratePrompts', { [path.resolve(ws.dir)]: Date.now() })
    const before = await readConfig()
    prompts.inject([true])

    expect(await run(['probe'])).toBe(0)

    expect(await readConfig()).toBe(before)
    expect(warned('cli.migrate.notice.pending')).toBeTrue()
    expect(probeSaw).toBe(0)
  })

  // stubTty re-applies its stubs before every test, so a row may flip one.
  test.each<[string, string[], Record<string, string>, () => void]>([
    ['JSON output', ['probe', '--output', 'json'], {}, () => {}],
    ['CI', ['probe'], { CI: 'true' }, () => {}],
    ['a dry run', ['probe', '--dry-run'], {}, () => {}],
    ['--yes', ['probe', '--yes'], {}, () => {}],
    ['--no-input', ['--no-input', 'probe'], {}, () => {}],
    [
      'stdout not a terminal',
      ['probe'],
      {},
      () => {
        process.stdout.isTTY = false
      },
    ],
  ])('%s gets the notice instead of a prompt', async (_label, args, env, arrange) => {
    Object.assign(process.env, env)
    arrange()
    const before = await readConfig()
    prompts.inject([true])

    expect(await run(args)).toBe(0)

    expect(await readConfig()).toBe(before)
    expect(warned('cli.migrate.notice.pending')).toBeTrue()
    expect(await readUserState()).toEqual({ migratePrompts: {} })
  })
})
