import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CommanderError } from 'commander'
import prompts, { type PromptObject } from 'prompts'
import { registerSelfUpdateCommand } from '../../../src/commands/self-update'
import type { SelfUpdateEnv } from '../../../src/update/env'
import { ExitCode } from '../../../src/util/errors'
import { setNoInputOverride } from '../../../src/util/no-input'
import { runInProcess } from '../../helpers/cli'
import {
  fakeBinary,
  fakeEnv,
  fakeRelease,
  installedBinary,
  serveReleases,
  type FakeRuns,
} from '../../helpers/fake-release'
import { rejectionOf } from '../../helpers/rejection'
import type { StubbedFetch } from '../../helpers/stub-fetch'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import { stubTty } from '../../test-utils'

// Headless by default: stdin is not a terminal, so an install without --yes
// must refuse. The confirmation tests flip it for their own run.
stubTty({ stdin: false })

/** A captured yes/no question: what it asked and what it defaulted to. */
type AskedConfirm = { message: string; initial: unknown }

type ConfirmElement = (question: PromptObject) => unknown

/**
 * Answer the confirmation prompt with `answer`, recording the question.
 * `prompts.inject` cannot observe the question: an injected answer skips the
 * element entirely, so the element itself is replaced for the run.
 */
async function answeringConfirm(
  answer: boolean,
  action: () => Promise<number>,
): Promise<{ exitCode: number; asked: AskedConfirm[] }> {
  const elements = prompts.prompts as unknown as Record<string, ConfirmElement>
  const original = elements.confirm
  const asked: AskedConfirm[] = []
  elements.confirm = (question) => {
    asked.push({ message: String(question.message), initial: question.initial })
    return answer
  }
  process.stdin.isTTY = true
  try {
    return { exitCode: await action(), asked }
  } finally {
    if (original !== undefined) elements.confirm = original
  }
}

/**
 * The command layer only: exit codes, flag wiring, the prompt gate, and the
 * post-install workspace preview. Release lookup, verification and the swap
 * are pinned in test/unit/update/.
 */
describe('self-update command', () => {
  const log = spyOn(console, 'log').mockImplementation(() => {})
  const error = spyOn(console, 'error').mockImplementation(() => {})
  const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true)
  let server: StubbedFetch
  let binary: string
  let ws: BoundWorkspace
  let env: SelfUpdateEnv
  let runs: FakeRuns

  beforeEach(async () => {
    server = serveReleases({ latest: fakeRelease('v1.1.0') })
    binary = await installedBinary('1.0.0')
    ;({ env, runs } = fakeEnv(binary))
    ws = await bindWorkspace({ dirs: [], config: false })
    setNoInputOverride(false)
  })
  afterEach(async () => {
    server.restore()
    await ws.dispose()
    await fs.rm(path.dirname(binary), { recursive: true, force: true })
    setNoInputOverride(undefined)
    log.mockClear()
    error.mockClear()
    stderr.mockClear()
  })
  afterAll(() => {
    log.mockRestore()
    error.mockRestore()
    stderr.mockRestore()
  })

  const run = (args: string[], withEnv: SelfUpdateEnv = env): Promise<number> =>
    runInProcess(
      (program) => registerSelfUpdateCommand(program, () => withEnv),
      ['self-update', ...args],
    )

  const installed = (): Promise<string> => fs.readFile(binary, 'utf8')

  test('--check exits 4 when an update is available and writes nothing', async () => {
    expect(await run(['--check'])).toBe(ExitCode.UpdatesPending)
    expect(log).toHaveBeenCalledWith('Ritual 1.1.0 is available (installed: 1.0.0).')
    expect(await installed()).toBe(fakeBinary('1.0.0'))
    expect(runs.smokeTests).toEqual([])
  })

  test('--check exits 0 when up to date', async () => {
    const current = fakeEnv(binary, { build: { version: '1.1.0', release: true } }).env
    expect(await run(['--check'], current)).toBe(ExitCode.Success)
    expect(log).toHaveBeenCalledWith(
      'Ritual 1.1.0 is up to date (the newest release on this channel is 1.1.0).',
    )
  })

  test('installing headless without --yes is a usage error naming --yes', async () => {
    expect(await run([])).toBe(ExitCode.UsageError)
    const reported = [...error.mock.calls, ...stderr.mock.calls].flat().map(String).join('\n')
    expect(reported).toContain('--yes')
    expect(await installed()).toBe(fakeBinary('1.0.0'))
  })

  test.each<[string, Partial<SelfUpdateEnv>, string[]]>([
    ['a development build', { build: { version: '1.0.0-dev.abc', release: false } }, ['--check']],
    ['the Docker image', { installKind: 'docker' }, ['--yes']],
    ['the Docker image, even for --check', { installKind: 'docker' }, ['--check']],
  ])('%s is refused with a usage error before any request', async (_label, overrides, args) => {
    expect(await run(args, fakeEnv(binary, overrides).env)).toBe(ExitCode.UsageError)
    expect(server.sent).toEqual([])
  })

  test('--check on a platform with no release binary fails before any request', async () => {
    expect(await run(['--check'], fakeEnv(binary, { platform: 'aix' }).env)).toBe(
      ExitCode.RuntimeError,
    )
    expect(server.sent).toEqual([])
  })

  test.each<[string, string, string]>([
    ['--prerelease', '--prerelease', 'releases?per_page=30'],
    ['--stable', '--stable', 'releases/latest'],
    ['--tag', '--tag=1.1.0', 'releases/tags/v1.1.0'],
  ])('%s reaches the right releases endpoint', async (_label, flag, endpoint) => {
    server.restore()
    server = serveReleases({ list: [fakeRelease('v1.1.0')], latest: fakeRelease('v1.1.0') })
    const beta = fakeEnv(binary, { build: { version: '1.0.0-beta1', release: true } }).env
    expect(await run(['--check', flag], beta)).toBe(ExitCode.UpdatesPending)
    expect(server.sent[0]?.url).toEndWith(endpoint)
  })

  test('confirming the prompt installs', async () => {
    const { exitCode, asked } = await answeringConfirm(true, () => run([]))
    expect(exitCode).toBe(ExitCode.Success)
    expect(asked).toEqual([{ message: 'Update Ritual 1.0.0 → 1.1.0?', initial: true }])
    expect(await installed()).toBe(fakeBinary('1.1.0'))
  })

  test('declining the prompt cancels with a usage exit and changes nothing', async () => {
    const { exitCode } = await answeringConfirm(false, () => run([]))
    expect(exitCode).toBe(ExitCode.UsageError)
    expect(error).toHaveBeenCalledWith('Cancelled; Ritual was not changed.')
    expect(runs.smokeTests).toEqual([])
    expect(await installed()).toBe(fakeBinary('1.0.0'))
  })

  test('--check with an older --tag says it would downgrade, and still exits 4', async () => {
    server.restore()
    server = serveReleases({ list: [fakeRelease('v0.9.0')] })
    expect(await run(['--check', '--tag', '0.9.0'])).toBe(ExitCode.UpdatesPending)
    expect(log).toHaveBeenCalledWith(
      'Ritual 0.9.0 is older than the installed 1.0.0; installing it would downgrade 1.0.0 → 0.9.0.',
    )
  })

  test('an older --tag asks to downgrade, defaulting to no', async () => {
    server.restore()
    server = serveReleases({ list: [fakeRelease('v0.9.0')] })
    const { asked } = await answeringConfirm(false, () => run(['--tag', 'v0.9.0']))
    expect(asked).toEqual([{ message: 'Downgrade Ritual 1.0.0 → 0.9.0?', initial: false }])
  })

  test('--tag naming the running release installs nothing', async () => {
    server.restore()
    server = serveReleases({ list: [fakeRelease('v1.0.0')] })
    expect(await run(['--tag', '1.0.0', '--yes'])).toBe(ExitCode.Success)
    expect(log).toHaveBeenCalledWith('Ritual 1.0.0 is already installed.')
    expect(runs.smokeTests).toEqual([])
  })

  test('--yes installs and, outside a workspace, previews nothing', async () => {
    expect(await run(['--yes'])).toBe(ExitCode.Success)
    expect(await installed()).toBe(fakeBinary('1.1.0'))
    expect(runs.inherited).toEqual([])
  })

  test('inside a workspace, the new binary previews its migrations', async () => {
    await fs.writeFile(path.join(ws.dir, 'ritual.config.json'), '{}')
    expect(await run(['--yes'])).toBe(ExitCode.Success)
    // The swap replaced the resolved file, so that is what runs (macOS tmpdirs are symlinked).
    const target = await fs.realpath(binary)
    expect(runs.inherited).toEqual([[target, 'migrate', '--dry-run', '--base-dir', ws.dir]])
  })

  test('the preview passes --no-input on', async () => {
    await fs.writeFile(path.join(ws.dir, 'ritual.config.json'), '{}')
    setNoInputOverride(true)
    expect(await run(['--yes'])).toBe(ExitCode.Success)
    expect(runs.inherited[0]?.at(-1)).toBe('--no-input')
  })

  test.each<[string, SelfUpdateEnv['runInherited'], string]>([
    [
      'cannot start',
      async () => {
        throw new Error('spawn EACCES')
      },
      'spawn EACCES',
    ],
    ['fails', async () => 1, 'it exited with code 1'],
  ])('a preview that %s only warns; the update stands', async (_label, runInherited, detail) => {
    await fs.writeFile(path.join(ws.dir, 'ritual.config.json'), '{}')
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await run(['--yes'], fakeEnv(binary, { runInherited }).env)).toBe(ExitCode.Success)
      expect(warn.mock.calls.flat().join('\n')).toContain(detail)
      expect(await installed()).toBe(fakeBinary('1.1.0'))
    } finally {
      warn.mockRestore()
    }
  })

  test.each([
    [['--prerelease', '--stable']],
    [['--stable', '--tag', 'v1.0.0']],
    [['--prerelease', '--tag', 'v1.0.0']],
    [['--check', '--yes']],
  ])('%p conflict', async (args) => {
    expect(await rejectionOf(run(args))).toMatchObject({ code: 'commander.conflictingOption' })
  })

  test('a --tag that is not a release tag is rejected', async () => {
    const error = await rejectionOf(run(['--tag', 'latest']))
    expect(error).toBeInstanceOf(CommanderError)
    expect(error).toMatchObject({ code: 'commander.invalidArgument' })
  })
})
