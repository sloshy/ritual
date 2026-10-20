import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildProgram, type CommandRegistrar } from '../../../src/cli/program'
import { addOutputOption, addQuietOption } from '../../../src/cli/options'
import {
  createUpdateNotice,
  defaultUpdateNoticeEnv,
  LONG_RUNNING_COMMANDS,
  UPDATE_NOTICE_EXEMPT,
  updateNoticeMode,
  type UpdateNotice,
  type UpdateNoticeEnv,
  type UpdateNoticeGate,
  type UpdateNoticeMode,
} from '../../../src/commands/update-notice'
import { t } from '../../../src/i18n/t'
import {
  readUserState,
  writeUserStateSection,
  type UpdateCheckState,
} from '../../../src/util/user-state'
import { captureConsole, type ConsoleCapture } from '../../helpers/capture'
import { FAKE_API, fakeRelease, fakeReleaseApiEnv, hangingFetch } from '../../helpers/fake-release'
import { captureExitCode } from '../../helpers/cli'
import { rejectionOf } from '../../helpers/rejection'
import { setNoInputOverride } from '../../../src/util/no-input'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import { stubTty } from '../../test-utils'
import { COMMAND, commandLine } from '../../../src/util/cli-tokens'
import { realProgram } from '../../helpers/program'

const HOUR = 60 * 60 * 1000

describe('updateNoticeMode', () => {
  const OPEN: UpdateNoticeGate = {
    build: { version: '1.0.0', release: true },
    installKind: undefined,
    optedOut: false,
    ci: false,
    stderrIsTTY: true,
    command: 'lists',
    output: 'text',
    quiet: false,
  }

  test.each<[string, Partial<UpdateNoticeGate>, UpdateNoticeMode]>([
    ['an ordinary command on a release build', {}, 'command'],
    ['a development build', { build: { version: '1.0.0-dev.abc', release: false } }, 'off'],
    ['the Docker image', { installKind: 'docker' }, 'off'],
    ['RITUAL_NO_UPDATE_CHECK', { optedOut: true }, 'off'],
    ['CI', { ci: true }, 'off'],
    ['stderr not a terminal', { stderrIsTTY: false }, 'off'],
    ['JSON output', { output: 'json' }, 'off'],
    ['NDJSON output', { output: 'ndjson' }, 'off'],
    ['CSV output', { output: 'csv' }, 'off'],
    ['--quiet', { quiet: true }, 'off'],
    ['self-update', { command: 'self-update' }, 'off'],
    ['mcp', { command: 'mcp' }, 'off'],
    ['help', { command: 'help' }, 'off'],
    ['a subcommand of an exempt one', { command: 'help config' }, 'off'],
    ['a name that only starts with an exempt one', { command: 'self-updater' }, 'command'],
    ['serve', { command: 'serve' }, 'long-running'],
    ['admin', { command: 'admin' }, 'long-running'],
    ['an admin subcommand', { command: 'admin setup' }, 'command'],
    ['a long-running command under CI', { command: 'serve', ci: true }, 'off'],
  ])('%s', (_label, change, mode) => {
    expect(updateNoticeMode({ ...OPEN, ...change })).toBe(mode)
  })

  test('every exempt and long-running name except Commander’s own help is a registered command', () => {
    const registered = new Set(realProgram().commands.map((command) => command.name()))
    const named = [...UPDATE_NOTICE_EXEMPT, ...LONG_RUNNING_COMMANDS]
    expect(named.filter((name) => name !== 'help' && !registered.has(name))).toEqual([])
  })

  test.each<[string | undefined, boolean]>([
    [undefined, false],
    ['1', true],
    ['0', false],
  ])('RITUAL_NO_UPDATE_CHECK=%p opts out: %p', (value, optedOut) => {
    const saved = process.env.RITUAL_NO_UPDATE_CHECK
    try {
      if (value === undefined) delete process.env.RITUAL_NO_UPDATE_CHECK
      else process.env.RITUAL_NO_UPDATE_CHECK = value
      expect(defaultUpdateNoticeEnv().optedOut).toBe(optedOut)
    } finally {
      if (saved === undefined) delete process.env.RITUAL_NO_UPDATE_CHECK
      else process.env.RITUAL_NO_UPDATE_CHECK = saved
    }
  })
})

/**
 * The notice driven through the real root hooks with probe commands. The
 * environment is the process's own (so the stderr-TTY, CI, Docker and opt-out
 * halves are the real wiring) with a release identity and a fake releases API.
 */
/** One request the fake releases API saw. */
type SeenRequest = { url: string; signal: AbortSignal | undefined }

describe('the update notice around a command', () => {
  stubTty({ stderr: true })

  const NOW = 1_000_000_000_000
  const NOTICE = t('cli.updateNotice.available', {
    latest: '1.2.0',
    current: '1.0.0',
    command: commandLine(COMMAND.selfUpdate),
  })
  const AMBIENT = ['CI', 'RITUAL_STATE_DIR', 'RITUAL_NO_UPDATE_CHECK', 'RITUAL_INSTALL'] as const
  const original = new Map(AMBIENT.map((name) => [name, process.env[name]]))
  let ws: BoundWorkspace
  let stateDir: string
  /** Every request the fake releases API saw, by URL, with its signal. */
  let requests: SeenRequest[]
  /** What the fake API answers; `null` never answers (until aborted). */
  let answer: string | null
  /** The running build's version. */
  let version: string

  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [] })
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-state-'))
    for (const name of AMBIENT) delete process.env[name]
    process.env.RITUAL_STATE_DIR = stateDir
    requests = []
    answer = 'v1.2.0'
    version = '1.0.0'
  })
  afterEach(async () => {
    await ws.dispose()
    await fs.rm(stateDir, { recursive: true, force: true })
    setNoInputOverride(undefined)
  })
  afterAll(() => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  const fakeFetch: UpdateNoticeEnv['fetch'] = (url, init) => {
    if (answer === null) {
      return hangingFetch((signal) => requests.push({ url: String(url), signal }))(url, init)
    }
    requests.push({ url: String(url), signal: init?.signal ?? undefined })
    const release = fakeRelease(answer).json
    // The prerelease channel reads the release list, stable reads `latest`.
    return Promise.resolve(Response.json(String(url).includes('/releases?') ? [release] : release))
  }

  const notice = (): UpdateNotice =>
    createUpdateNotice(() => ({
      ...defaultUpdateNoticeEnv(),
      ...fakeReleaseApiEnv(fakeFetch),
      build: { version, release: true },
      now: () => NOW,
    }))

  /** A probe that prints a line, waits `waitMs` (letting a lookup answer), then runs `then`. */
  function probe(name: string, waitMs = 0, then: () => void = () => {}): CommandRegistrar {
    return (root) => {
      addQuietOption(addOutputOption(root.command(name))).action(async () => {
        console.log(`${name} ran`)
        if (waitMs > 0) await Bun.sleep(waitMs)
        then()
      })
    }
  }

  function run(
    hooks: UpdateNotice,
    args: string[],
    command = probe('probe'),
  ): Promise<ConsoleCapture<number>> {
    const program = buildProgram({
      groups: [{ titleKey: 'help.group.utilities', commands: [command] }],
      backfill: () => false,
      workspaceCheck: () => Promise.resolve(),
      updateNotice: hooks,
    })
    return captureConsole(['log', 'warn'], () =>
      captureExitCode(() => program.parseAsync(['--base-dir', ws.dir, ...args], { from: 'user' })),
    )
  }

  const cache = (fields: Partial<UpdateCheckState> = {}): Promise<void> =>
    writeUserStateSection('updateCheck', {
      channel: 'stable',
      checkedAt: NOW - HOUR,
      latest: '1.2.0',
      ...fields,
    })

  const writeConfig = (json: string): Promise<void> =>
    fs.writeFile(path.join(ws.dir, 'ritual.config.json'), json)

  test('a fresh cache naming a newer release prints the notice on stderr after the output, once a day', async () => {
    await cache()

    const first = await run(notice(), ['probe'])
    expect(first.result).toBe(0)
    expect(first.lines.log).toEqual(['probe ran'])
    expect(first.lines.warn).toEqual([NOTICE])
    expect(first.all).toEqual(['probe ran', NOTICE])
    expect(requests).toEqual([])
    expect((await readUserState()).updateCheck).toMatchObject({
      notifiedAt: NOW,
      notifiedVersion: '1.2.0',
    })

    const second = await run(notice(), ['probe'])
    expect(second.all).toEqual(['probe ran'])
  })

  test('the notice still follows a command that failed through its exit code', async () => {
    await cache()
    const failing = probe('probe', 0, () => {
      process.exitCode = 3
    })

    const { result, all } = await run(notice(), ['probe'], failing)
    expect(result).toBe(3)
    expect(all).toEqual(['probe ran', NOTICE])
  })

  test.each<[string, string[], () => unknown]>([
    ['--output json', ['probe', '--output', 'json'], () => {}],
    ['--quiet', ['probe', '--quiet'], () => {}],
    [
      'RITUAL_NO_UPDATE_CHECK=1',
      ['probe'],
      () => {
        process.env.RITUAL_NO_UPDATE_CHECK = '1'
      },
    ],
    [
      'CI=1',
      ['probe'],
      () => {
        process.env.CI = '1'
      },
    ],
    [
      'RITUAL_INSTALL=docker',
      ['probe'],
      () => {
        process.env.RITUAL_INSTALL = 'docker'
      },
    ],
    [
      'stderr not a terminal',
      ['probe'],
      () => {
        // stubTty re-applies before every test, so no restore is needed.
        process.stderr.isTTY = false
      },
    ],
    ['updateCheck: false', ['probe'], () => writeConfig('{ "updateCheck": false }')],
  ])('%s: no notice, no lookup, no state change', async (_label, args, arrange) => {
    await cache({ checkedAt: NOW - 2 * 24 * HOUR })
    await arrange()
    const before = await readUserState()

    const { result, all } = await run(notice(), args)

    expect(result).toBe(0)
    expect(all).toEqual(['probe ran'])
    expect(requests).toEqual([])
    expect(await readUserState()).toEqual(before)
  })

  // `migrate` skips the config load, so a key read from the loaded config would miss it.
  test('updateCheck: false holds for a command that skips the config load', async () => {
    await cache({ checkedAt: NOW - 2 * 24 * HOUR })
    await writeConfig('{ "updateCheck": false }')

    const { all } = await run(notice(), ['migrate'], probe('migrate'))

    expect(all).toEqual(['migrate ran'])
    expect(requests).toEqual([])
  })

  test('a malformed updateCheck leaves the check on', async () => {
    await cache()
    await writeConfig('{ "updateCheck": "no" }')

    const { lines } = await run(notice(), ['probe'])

    expect(lines.warn.at(-1)).toBe(NOTICE)
  })

  test('a stale cache is refreshed beside the command, and a prompt answer is used at once', async () => {
    await cache({ checkedAt: NOW - 2 * 24 * HOUR, latest: '1.1.0' })

    const { all } = await run(notice(), ['probe'], probe('probe', 50))

    expect(requests.map((request) => request.url)).toEqual([`${FAKE_API}/releases/latest`])
    expect(all).toEqual(['probe ran', NOTICE])
    expect((await readUserState()).updateCheck).toMatchObject({ checkedAt: NOW, latest: '1.2.0' })
  })

  test('a prerelease build looks up the release list and caches it for its own channel', async () => {
    version = '1.2.0-beta1'
    answer = 'v1.2.0'
    // Fresh, but for the stable channel: a prerelease build must look again.
    await cache()

    const { all } = await run(notice(), ['probe'], probe('probe', 50))

    expect(requests.map((request) => request.url)).toEqual([`${FAKE_API}/releases?per_page=30`])
    expect(all).toEqual([
      'probe ran',
      t('cli.updateNotice.available', {
        latest: '1.2.0',
        current: '1.2.0-beta1',
        command: commandLine(COMMAND.selfUpdate),
      }),
    ])
    expect((await readUserState()).updateCheck).toMatchObject({ channel: 'prerelease' })
  })

  test('a lookup still running when the command ends is abandoned and recorded as such', async () => {
    await cache({ checkedAt: NOW - 2 * 24 * HOUR })
    answer = null

    const { result, all } = await run(notice(), ['probe'])

    expect(result).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.signal?.aborted).toBeTrue()
    // The old answer still speaks; the attempt holds off the next for a while.
    expect(all).toEqual(['probe ran', NOTICE])
    expect((await readUserState()).updateCheck).toMatchObject({
      latest: '1.2.0',
      abandonedAt: NOW,
    })
  })

  test('a command that throws gets no notice, and abandon aborts its lookup', async () => {
    await cache({ checkedAt: NOW - 2 * 24 * HOUR })
    const before = await readUserState()
    answer = null
    const hooks = notice()
    const throwing = probe('probe', 0, () => {
      throw new Error('boom')
    })

    expect(await rejectionOf(run(hooks, ['probe'], throwing))).toHaveProperty('message', 'boom')
    expect(requests[0]?.signal?.aborted).toBeFalse()
    hooks.abandon()

    expect(requests[0]?.signal?.aborted).toBeTrue()
    // A `finish` that ran would have announced 1.2.0 and recorded the attempt.
    expect(await readUserState()).toEqual(before)
  })

  test('a server announces at startup from the cache and refreshes it in the background', async () => {
    await cache({ checkedAt: NOW - 2 * 24 * HOUR })
    answer = 'v1.3.0'
    const hooks = notice()

    const { result, all } = await run(hooks, ['serve'], probe('serve'))
    // What `main()`'s finally does once a server is up: it must leave the refresh running.
    hooks.abandon()

    expect(result).toBe(0)
    expect(all).toEqual([NOTICE, 'serve ran'])
    expect(requests[0]?.signal?.aborted).toBeFalse()
    // The refresh is fire-and-forget: polling the file is the only way to see it land.
    let state = (await readUserState()).updateCheck
    for (let tries = 0; state?.latest !== '1.3.0' && tries < 50; tries++) {
      await Bun.sleep(10)
      state = (await readUserState()).updateCheck
    }
    expect(state).toMatchObject({ latest: '1.3.0', checkedAt: NOW, notifiedVersion: '1.2.0' })
  })

  test('a server that fails to start cancels its background refresh', async () => {
    await cache({ checkedAt: NOW - 2 * 24 * HOUR })
    answer = null
    const failing = probe('serve', 0, () => {
      process.exitCode = 2
    })

    const { result } = await run(notice(), ['serve'], failing)

    expect(result).toBe(2)
    expect(requests[0]?.signal?.aborted).toBeTrue()
  })
})
