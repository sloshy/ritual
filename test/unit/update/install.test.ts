import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { MessageKey } from '../../../src/i18n/messages/en'
import type { SelfUpdateEnv } from '../../../src/update/env'
import {
  parseChecksumFile,
  removeLeftoverBinary,
  smokeTestDetail,
} from '../../../src/update/install'
import type { MessageParseError, SyncText } from '../../../src/sync/message'
import type { BinaryRunResult } from '../../../src/update/env'
import { assetNameFor } from '../../../src/update/release-source'
import {
  assertSelfUpdatable,
  installUpdate,
  planUpdate,
  prepareInstall,
  type UpdatePlan,
} from '../../../src/update/self-update'
import { ExitCode } from '../../../src/util/errors'
import {
  FAKE_ASSET,
  fakeBinary,
  fakeEnv,
  fakeRelease,
  installedBinary,
  serveReleases,
  sha256Hex,
  type FakeReleaseOptions,
  type FakeRuns,
} from '../../helpers/fake-release'
import { commandFailure, failureIdentity } from '../../helpers/rejection'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'
import { pseudoCatalog, pseudoString, withGuardedLocaleAsync } from '../../helpers/sync-text'

describe('assetNameFor', () => {
  test.each<[NodeJS.Platform, NodeJS.Architecture, string]>([
    ['linux', 'x64', 'ritual-linux-x86_64'],
    ['linux', 'arm64', 'ritual-linux-arm64'],
    ['darwin', 'x64', 'ritual-macos-x86_64'],
    ['darwin', 'arm64', 'ritual-macos-arm64'],
    ['win32', 'x64', 'ritual-windows-x86_64.exe'],
    ['win32', 'arm64', 'ritual-windows-arm64.exe'],
  ])('%s/%s → %s', (platform, arch, asset) => {
    expect(assetNameFor(platform, arch)).toBe(asset)
  })

  test.each<[NodeJS.Platform, NodeJS.Architecture]>([
    ['linux', 'ia32'],
    ['freebsd', 'x64'],
  ])('%s/%s has no release binary', (platform, arch) => {
    expect(assetNameFor(platform, arch)).toBeUndefined()
  })
})

describe('parseChecksumFile', () => {
  const digest = 'AB'.repeat(32)

  test.each([
    ['sha256sum text mode', `${digest}  ${FAKE_ASSET}\n`],
    ['sha256sum binary mode', `${digest} *${FAKE_ASSET}`],
    ['a path before the name', `${digest}  ./dist/${FAKE_ASSET}`],
    ['a bare digest', `${digest}\n`],
  ])('reads %s, lowercased', (_label, text) => {
    expect(parseChecksumFile(text, FAKE_ASSET)).toBe(digest.toLowerCase())
  })

  const malformed: MessageParseError = {
    error: {
      message: 'expected a SHA-256 digest followed by a file name',
      messageKey: 'cli.selfUpdate.checksum.malformed',
    },
  }

  test.each<[string, string, MessageParseError]>([
    [
      'a digest for another file',
      `${digest}  ./dist/ritual-macos-arm64`,
      {
        error: {
          message: `the digest is for ./dist/ritual-macos-arm64, not ${FAKE_ASSET}`,
          messageKey: 'cli.selfUpdate.checksum.otherFile',
          messageParams: { file: './dist/ritual-macos-arm64', asset: FAKE_ASSET },
        },
      },
    ],
    [
      'a digest naming a file with control characters, quoted onto one line',
      `${digest}  ./dist/\u001b[31mevil\u001b[0m\tname`,
      {
        error: {
          message: `the digest is for ./dist/evil name, not ${FAKE_ASSET}`,
          messageKey: 'cli.selfUpdate.checksum.otherFile',
          messageParams: { file: './dist/evil name', asset: FAKE_ASSET },
        },
      },
    ],
    ['a short digest', `${'a'.repeat(63)}  ${FAKE_ASSET}`, malformed],
    ['an empty file', '', malformed],
  ])('rejects %s', (_label, text, error) => {
    expect(parseChecksumFile(text, FAKE_ASSET)).toEqual(error)
  })
})

describe('smokeTestDetail', () => {
  const run = (overrides: Partial<BinaryRunResult>): BinaryRunResult => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
    killed: false,
    ...overrides,
  })
  const long = 'x'.repeat(250)

  // The policy: the binary's own text is quoted on one line — every line break
  // and control character a space, runs collapsed, ends trimmed — and capped at
  // 200 characters; only why there is nothing to quote is worded by Ritual.
  test.each<[string, BinaryRunResult, SyncText]>([
    [
      'a run that timed out',
      run({ exitCode: 1, stdout: '1.1.0', killed: true }),
      { messageKey: 'cli.selfUpdate.smoke.timedOut' },
    ],
    ['the wrong version', run({ stdout: '6.6.6\n' }), '6.6.6'],
    [
      'a multi-line version answer, on one line',
      run({ stdout: 'Ritual\n  6.6.6\n' }),
      'Ritual 6.6.6',
    ],
    [
      'nothing printed at all',
      run({ stdout: ' \n' }),
      { messageKey: 'cli.selfUpdate.smoke.noOutput' },
    ],
    [
      'multi-line stderr, on one line',
      run({ exitCode: 1, stderr: 'error: bad\n    at main\n' }),
      {
        messageKey: 'cli.selfUpdate.smoke.exited',
        messageParams: { exitCode: 1, output: 'error: bad at main' },
      },
    ],
    [
      'control characters in stderr',
      run({ exitCode: 2, stderr: '\u001b[31mred\u001b[0m\tand\u0007bell' }),
      {
        messageKey: 'cli.selfUpdate.smoke.exited',
        messageParams: { exitCode: 2, output: 'red and bell' },
      },
    ],
    [
      'stderr past the cap',
      run({ exitCode: 1, stderr: long }),
      {
        messageKey: 'cli.selfUpdate.smoke.exited',
        messageParams: { exitCode: 1, output: `${'x'.repeat(200)}…` },
      },
    ],
    [
      'a failure with empty stderr, quoting stdout',
      run({ exitCode: 1, stdout: 'oops\n' }),
      { messageKey: 'cli.selfUpdate.smoke.exited', messageParams: { exitCode: 1, output: 'oops' } },
    ],
    [
      'a failure that printed nothing',
      run({ exitCode: 139 }),
      { messageKey: 'cli.selfUpdate.smoke.exitedSilently', messageParams: { exitCode: 139 } },
    ],
  ])('%s', (_label, result, detail) => {
    expect(smokeTestDetail(result)).toEqual(detail)
  })
})

describe('refusals', () => {
  const refusal = (env: SelfUpdateEnv): Promise<unknown> =>
    failureIdentity(Promise.resolve().then(() => assertSelfUpdatable(env)))

  test('a development build cannot update itself (usage error)', async () => {
    const { env } = fakeEnv('/unused', { build: { version: '1.0.0-dev.abc', release: false } })
    expect(await refusal(env)).toEqual({
      key: 'cli.selfUpdate.refuse.notRelease',
      exitCode: ExitCode.UsageError,
    })
  })

  test('the Docker image refuses first, even though its build is not a release', async () => {
    const { env } = fakeEnv('/unused', {
      installKind: 'docker',
      build: { version: '1.0.0-dev.abc', release: false },
    })
    expect(await refusal(env)).toEqual({
      key: 'cli.selfUpdate.refuse.docker',
      exitCode: ExitCode.UsageError,
    })
  })

  test('an unsupported platform is a runtime error', async () => {
    expect(
      await failureIdentity(prepareInstall(fakeEnv('/unused', { platform: 'aix' }).env)),
    ).toEqual({
      key: 'cli.selfUpdate.error.unsupportedPlatform',
      exitCode: ExitCode.RuntimeError,
    })
  })

  // Root can write anywhere, so the directory's mode would not stop it.
  test.skipIf(process.getuid?.() === 0)('an unwritable binary directory is refused', async () => {
    const binary = await installedBinary('1.0.0')
    const dir = path.dirname(binary)
    await fs.chmod(dir, 0o555)
    try {
      expect(await failureIdentity(prepareInstall(fakeEnv(binary).env))).toEqual({
        key: 'cli.selfUpdate.refuse.notWritable',
        exitCode: ExitCode.RuntimeError,
      })
    } finally {
      await fs.chmod(dir, 0o755)
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('installUpdate', () => {
  let server: StubbedFetch | undefined
  let dir: string | undefined
  afterEach(async () => {
    server?.restore()
    server = undefined
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  type SetUp = { binary: string; plan: UpdatePlan; env: SelfUpdateEnv; runs: FakeRuns }

  /**
   * A temp dir holding Ritual 1.0.0, a server offering `tag` built from
   * `options`, the plan to install it, and the environment to install it with.
   */
  async function setUp(
    tag: string,
    options: FakeReleaseOptions = {},
    overrides: Partial<SelfUpdateEnv> = {},
  ): Promise<SetUp> {
    const binary = await installedBinary('1.0.0')
    dir = path.dirname(binary)
    server = serveReleases({ latest: fakeRelease(tag, options) })
    const { env, runs } = fakeEnv(binary, overrides)
    return { binary, plan: await planUpdate(env, {}), env, runs }
  }

  /** Every file in the temp dir: the binary plus anything an install left behind. */
  async function filesBeside(binary: string): Promise<string[]> {
    return (await fs.readdir(path.dirname(binary))).sort()
  }

  test('replaces the binary with the verified release, leaving nothing behind', async () => {
    const { binary, plan, env, runs } = await setUp('v1.1.0')

    await installUpdate(env, plan, await prepareInstall(env))

    expect(await fs.readFile(binary, 'utf8')).toBe(fakeBinary('1.1.0'))
    expect(await filesBeside(binary)).toEqual(['ritual'])
    // The smoke test ran the new bytes from a temp file beside the binary.
    expect(runs.smokeTests.map((file) => path.dirname(file))).toEqual([path.dirname(binary)])
  })

  test('keeps the current binary’s mode, whatever the umask', async () => {
    const { binary, plan, env } = await setUp('v1.1.0')
    await fs.chmod(binary, 0o750)
    const umask = process.umask(0o077)
    try {
      await installUpdate(env, plan, binary)
    } finally {
      process.umask(umask)
    }
    expect((await fs.stat(binary)).mode & 0o777).toBe(0o750)
  })

  test('a symlinked executable keeps its link; the real file is replaced', async () => {
    const { binary, plan } = await setUp('v1.1.0')
    const link = path.join(path.dirname(binary), 'ritual-link')
    await fs.symlink(binary, link)
    const { env } = fakeEnv(link)

    await installUpdate(env, plan, await prepareInstall(env))

    expect((await fs.lstat(link)).isSymbolicLink()).toBeTrue()
    expect(await fs.readFile(binary, 'utf8')).toBe(fakeBinary('1.1.0'))
  })

  test('removes temp files an interrupted run left long ago, and only those', async () => {
    const { binary, plan, env } = await setUp('v1.1.0')
    const stale = path.join(path.dirname(binary), '.ritual.0badf00d.new')
    const fresh = path.join(path.dirname(binary), '.ritual.1badf00d.new')
    await fs.writeFile(stale, 'partial')
    await fs.writeFile(fresh, 'another update in progress')
    const longAgo = new Date(Date.now() - 2 * 60 * 60_000)
    await fs.utimes(stale, longAgo, longAgo)

    await installUpdate(env, plan, binary)

    expect(await filesBeside(binary)).toEqual(['.ritual.1badf00d.new', 'ritual'])
  })

  test.each<[string, FakeReleaseOptions, MessageKey]>([
    [
      'a checksum mismatch',
      { checksum: `${sha256Hex('other')}  ${FAKE_ASSET}` },
      'cli.selfUpdate.error.checksumMismatch',
    ],
    ['a download longer than listed', { listedSize: 3 }, 'cli.selfUpdate.error.sizeMismatch'],
    ['a download shorter than listed', { listedSize: 9999 }, 'cli.selfUpdate.error.sizeMismatch'],
    ['a failed download', { binaryStatus: 404 }, 'cli.selfUpdate.error.http'],
  ])(
    '%s is caught before the smoke test, and the temp file removed',
    async (_label, options, key) => {
      const { binary, plan, env, runs } = await setUp('v1.1.0', options)

      expect((await commandFailure(installUpdate(env, plan, binary))).messageKey).toBe(key)

      expect(runs.smokeTests).toEqual([])
      expect(await fs.readFile(binary, 'utf8')).toBe(fakeBinary('1.0.0'))
      expect(await filesBeside(binary)).toEqual(['ritual'])
    },
  )

  test('a malformed checksum file nests why in the refusal', async () => {
    const { binary, plan, env } = await setUp('v1.1.0', { checksum: 'not a digest' })

    const error = await commandFailure(installUpdate(env, plan, binary))

    expect({ message: error.message, key: error.messageKey, params: error.messageParams }).toEqual({
      message: `The checksum file for ${FAKE_ASSET} is malformed (expected a SHA-256 digest followed by a file name); nothing was installed.`,
      key: 'cli.selfUpdate.error.badChecksumFile',
      params: {
        asset: FAKE_ASSET,
        error: 'expected a SHA-256 digest followed by a file name',
      },
    })
  })

  test('a malformed checksum file reads in the CLI’s language, its reason too', async () => {
    const { binary, plan, env } = await setUp('v1.1.0', { checksum: 'not a digest' })

    const error = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
      commandFailure(installUpdate(env, plan, binary)),
    )

    expect(error.message).toBe(
      pseudoString('cli.selfUpdate.error.badChecksumFile')
        .replace('{asset}', FAKE_ASSET)
        .replace('{error}', pseudoString('cli.selfUpdate.checksum.malformed')),
    )
    expect(error.messageParams).toEqual({
      asset: FAKE_ASSET,
      error: 'expected a SHA-256 digest followed by a file name',
    })
  })

  test.each<[string, FakeReleaseOptions, MessageKey]>([
    [
      'a malformed checksum file',
      { checksum: 'not a digest' },
      'cli.selfUpdate.error.badChecksumFile',
    ],
    ['no checksum file', { checksum: null }, 'cli.selfUpdate.error.missingChecksum'],
  ])('%s is refused before anything is written', async (_label, options, key) => {
    const { binary, plan, env, runs } = await setUp('v1.1.0', options)

    expect((await commandFailure(installUpdate(env, plan, binary))).messageKey).toBe(key)

    expect(runs.smokeTests).toEqual([])
    expect(server?.sent.some((sent) => sent.url.endsWith(FAKE_ASSET))).toBeFalse()
    expect(await filesBeside(binary)).toEqual(['ritual'])
  })

  test.each<[string, string, string]>([
    ['reports the wrong version', fakeBinary('6.6.6'), '6.6.6'],
    ['fails to run', 'garbage', 'exit 1: not a ritual binary'],
  ])(
    'a binary that %s is not installed, and its temp file is removed',
    async (_label, bytes, detail) => {
      const { binary, plan, env, runs } = await setUp('v1.1.0', { binary: bytes })

      const error = await commandFailure(installUpdate(env, plan, binary))

      expect({ key: error.messageKey, params: error.messageParams }).toEqual({
        key: 'cli.selfUpdate.error.smokeTest',
        params: { expected: '1.1.0', detail },
      })
      expect(runs.smokeTests).toHaveLength(1)
      expect(await fs.readFile(binary, 'utf8')).toBe(fakeBinary('1.0.0'))
      expect(await filesBeside(binary)).toEqual(['ritual'])
    },
  )

  test('a failed smoke test reads in the CLI’s language, its exit reason too', async () => {
    const { binary, plan, env } = await setUp(
      'v1.1.0',
      {},
      { runBinary: async () => ({ exitCode: 3, stdout: '', stderr: 'boom', killed: false }) },
    )
    const error = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
      commandFailure(installUpdate(env, plan, binary)),
    )

    expect(error.messageParams).toEqual({ expected: '1.1.0', detail: 'exit 3: boom' })
    const detail = pseudoString('cli.selfUpdate.smoke.exited')
      .replace('{exitCode}', '3')
      .replace('{output}', 'boom')
    expect(error.message).toBe(
      pseudoString('cli.selfUpdate.error.smokeTest')
        .replace('{expected}', '1.1.0')
        .replace('{detail}', detail),
    )
  })

  test('a failed swap removes the temp file and leaves the target alone', async () => {
    const failing = async (): Promise<void> => {
      throw Object.assign(new Error('EXDEV: simulated'), { code: 'EXDEV' })
    }
    const { binary, plan, env } = await setUp('v1.1.0', {}, { rename: failing })

    expect((await commandFailure(installUpdate(env, plan, binary))).messageKey).toBe(
      'cli.selfUpdate.error.installFailed',
    )
    expect(await fs.readFile(binary, 'utf8')).toBe(fakeBinary('1.0.0'))
    expect(await filesBeside(binary)).toEqual(['ritual'])
  })

  test('a release without this platform’s binary is refused', async () => {
    // The fake release only carries the linux/x64 binary.
    const { binary, plan, env } = await setUp('v1.1.0', {}, { arch: 'arm64' })
    expect((await commandFailure(installUpdate(env, plan, binary))).messageKey).toBe(
      'cli.selfUpdate.error.missingAsset',
    )
    expect(await fs.readFile(binary, 'utf8')).toBe(fakeBinary('1.0.0'))
  })

  /** The URL the plan downloads `name` from. */
  const assetUrl = (plan: UpdatePlan, name: string): string =>
    plan.release.assets.find((asset) => asset.name === name)!.url

  test('a checksum file that breaks off mid-body is a network error', async () => {
    const { binary, plan, env } = await setUp('v1.1.0')
    const broken = new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(new Error('connection reset')),
    })
    const layered = stubFetch(
      { [assetUrl(plan, `${FAKE_ASSET}.sha256`)]: () => new Response(broken) },
      { passthrough: true },
    )
    try {
      const error = await commandFailure(installUpdate(env, plan, binary))
      expect(error.messageKey).toBe('cli.selfUpdate.error.network')
    } finally {
      layered.restore()
    }
    expect(await filesBeside(binary)).toEqual(['ritual'])
  })

  test('a compressed download’s Content-Length is not held against the listed size', async () => {
    const { binary, plan, env } = await setUp('v1.1.0')
    const bytes = fakeBinary('1.1.0')
    // Routes match by prefix, so the binary's route would also answer for its
    // `.sha256`; serve that too.
    const layered = stubFetch(
      {
        [assetUrl(plan, `${FAKE_ASSET}.sha256`)]: () =>
          new Response(`${sha256Hex(bytes)}  ${FAKE_ASSET}`),
        [assetUrl(plan, FAKE_ASSET)]: () =>
          new Response(bytes, { headers: { 'content-length': '3', 'content-encoding': 'gzip' } }),
      },
      { passthrough: true },
    )
    try {
      await installUpdate(env, plan, binary)
    } finally {
      layered.restore()
    }
    expect(await fs.readFile(binary, 'utf8')).toBe(bytes)
  })

  describe('on Windows', () => {
    const windows = { asset: 'ritual-windows-x86_64.exe' }

    test('ignores Ctrl+C while the binary is moved aside and back', async () => {
      const before = process.listenerCount('SIGINT')
      const during: number[] = []
      const rename: SelfUpdateEnv['rename'] = async (from, to) => {
        during.push(process.listenerCount('SIGINT'))
        await fs.rename(from, to)
      }
      const { binary, plan, env } = await setUp('v1.1.0', windows, { platform: 'win32', rename })

      await installUpdate(env, plan, binary)

      expect(during).toEqual([before + 1, before + 1])
      expect(process.listenerCount('SIGINT')).toBe(before)
    })

    test('steps aside to a fresh name when an older .old is still in use', async () => {
      const { binary, plan, env } = await setUp('v1.1.0', windows, { platform: 'win32' })
      // A non-empty directory stands in for a .old a running `ritual serve` holds:
      // removing it fails the way deleting a running .exe does.
      await fs.mkdir(`${binary}.old`)
      await fs.writeFile(path.join(`${binary}.old`, 'in-use'), '')

      await installUpdate(env, plan, binary)

      expect(await fs.readFile(binary, 'utf8')).toBe(fakeBinary('1.1.0'))
      const aside = (await filesBeside(binary)).filter((name) =>
        /^ritual\.[0-9a-f]{8}\.old$/.test(name),
      )
      expect(aside).toHaveLength(1)
      expect(await fs.readFile(path.join(path.dirname(binary), aside[0]!), 'utf8')).toBe(
        fakeBinary('1.0.0'),
      )

      // The next start removes what it can and skips what is still in use.
      await removeLeftoverBinary(binary, 'win32')
      expect(await filesBeside(binary)).toEqual(['ritual', 'ritual.old'])
    })

    test('moves the running binary aside to .old and the new one into its name', async () => {
      const { binary, plan, env, runs } = await setUp('v1.1.0', windows, { platform: 'win32' })
      await fs.writeFile(`${binary}.old`, 'from an earlier update')

      await installUpdate(env, plan, binary)

      expect(await fs.readFile(binary, 'utf8')).toBe(fakeBinary('1.1.0'))
      expect(await fs.readFile(`${binary}.old`, 'utf8')).toBe(fakeBinary('1.0.0'))
      expect(runs.smokeTests[0]).toEndWith('.exe')
      expect(await filesBeside(binary)).toEqual(['ritual', 'ritual.old'])

      await removeLeftoverBinary(binary, 'win32')
      expect(await filesBeside(binary)).toEqual(['ritual'])
    })

    /** A rename that fails for any move whose source matches `refuse`. */
    const renameRefusing =
      (refuse: (from: string) => boolean): SelfUpdateEnv['rename'] =>
      async (from, to) => {
        if (refuse(from)) throw Object.assign(new Error('EINVAL: simulated'), { code: 'EINVAL' })
        await fs.rename(from, to)
      }

    test('puts the old binary back when the new one cannot take its name', async () => {
      const refuseNew = renameRefusing((from) => from.endsWith('.new.exe'))
      const { binary, plan, env } = await setUp('v1.1.0', windows, {
        platform: 'win32',
        rename: refuseNew,
      })

      const error = await commandFailure(installUpdate(env, plan, binary))

      expect(error.messageKey).toBe('cli.selfUpdate.error.installFailed')
      expect(await fs.readFile(binary, 'utf8')).toBe(fakeBinary('1.0.0'))
      expect(await filesBeside(binary)).toEqual(['ritual'])
    })

    test('when even the rollback fails, keeps the new binary and names both files', async () => {
      const refuseBoth = renameRefusing(
        (from) => from.endsWith('.new.exe') || from.endsWith('.old'),
      )
      const { binary, plan, env } = await setUp('v1.1.0', windows, {
        platform: 'win32',
        rename: refuseBoth,
      })

      const error = await commandFailure(installUpdate(env, plan, binary))

      expect(error.messageKey).toBe('cli.selfUpdate.error.swapStranded')
      const kept = (await filesBeside(binary)).filter((name) => name.endsWith('.new.exe'))
      expect(kept).toHaveLength(1)
      expect(await fs.readFile(path.join(path.dirname(binary), kept[0]!), 'utf8')).toBe(
        fakeBinary('1.1.0'),
      )
      expect(await fs.readFile(`${binary}.old`, 'utf8')).toBe(fakeBinary('1.0.0'))
      expect(error.message).toContain(kept[0]!)
    })
  })

  test('the leftover cleanup does nothing off Windows', async () => {
    const binary = await installedBinary('1.0.0')
    dir = path.dirname(binary)
    await fs.writeFile(`${binary}.old`, 'kept')
    await removeLeftoverBinary(binary, 'linux')
    expect(await filesBeside(binary)).toEqual(['ritual', 'ritual.old'])
  })
})
