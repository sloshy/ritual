import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { Command } from 'commander'

export const repoRoot = path.resolve(import.meta.dir, '../../..')
export const binaryPath = path.join(repoRoot, 'ritual')

/** Registers one command tree onto a program, e.g. `registerImportCommand`. */
export type CommandRegistrar = (program: Command) => void

/**
 * Run one CLI command in-process and return the exit code it set — the driver
 * for suites whose network is a stubbed `fetch` the built binary could never
 * see. Encodes the rules every hand-rolled copy had to repeat: `exitOverride`
 * so a usage error throws instead of exiting the test process, `from: 'user'`
 * argv parsing, and resetting `process.exitCode` on both sides so one run's
 * failure cannot leak into the next assertion (or the suite's own exit code).
 */
export async function runInProcess(register: CommandRegistrar, args: string[]): Promise<number> {
  const program = new Command()
  program.exitOverride()
  register(program)
  return captureExitCode(() => program.parseAsync(args, { from: 'user' }))
}

/**
 * Run `body` with a cleared exit code and report the one it set, leaving a
 * concrete 0 behind — even when `body` (or a caller's assertion between runs)
 * throws. Bun ignores `process.exitCode = undefined`, so restoring a saved
 * `undefined` does nothing and an in-process run's failure code would become
 * the whole suite's exit code on a green run.
 */
export async function captureExitCode(body: () => Promise<unknown>): Promise<number> {
  process.exitCode = 0
  try {
    await body()
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  } finally {
    process.exitCode = 0
  }
}

export type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Locale env for spawned-CLI tests: clear every POSIX locale variable the CLI's
 * OS detection reads and pin the UI locale to English.
 *
 * The suite asserts on English output in ~1,860 places. Without this, a
 * developer whose shell exports `LANG=de_DE.UTF-8` fails hundreds of stdout
 * assertions locally while CI (on `LANG=C.UTF-8`) passes — and it reads as
 * flakiness, exactly the failure the `RITUAL_BASE_DIR: undefined` scrub below
 * was added to prevent.
 *
 * `undefined` removes the variable from the child's environment. Suites that
 * exercise locale resolution itself opt back in through `runCli`'s `env`, which
 * is merged last.
 */
export const LOCALE_ENV: Record<string, string | undefined> = {
  LANG: undefined,
  LC_ALL: undefined,
  LC_MESSAGES: undefined,
  LC_NUMERIC: undefined,
  LC_TIME: undefined,
  LANGUAGE: undefined,
  RITUAL_LOCALE: 'en',
}

/**
 * The generated pseudo-locale, baked into the binary these tests spawn.
 *
 * Shipping builds carry English only (`RITUAL_BUNDLED_LOCALES` defaults to
 * `en`, and English is inline in the catalog rather than baked). Test builds
 * add `en-XA` because it is the only locale that can prove a string was routed
 * through `t()`: its output is bracketed, so anything still in plain ASCII was
 * never translated. Nothing else changes — the suite pins `RITUAL_LOCALE=en`,
 * so an extra dictionary on the shelf is invisible to every other assertion.
 *
 * `package.json`'s `test:it` sets the same value for the build it runs ahead of
 * the suite; this keeps a directly invoked `bun test` building the same binary.
 */
export const TEST_BUNDLED_LOCALES = 'en-XA'

let binaryReady = false

/**
 * Build the `ritual` binary once per test process. Subsequent calls are no-ops.
 * Throws if the build fails so the failure surfaces at the first test that needs it.
 */
export async function ensureBinary(): Promise<void> {
  if (binaryReady) return
  // The test:it script already ran a build; don't pay for a second one.
  if (process.env.RITUAL_IT_PREBUILT === '1' && (await Bun.file(binaryPath).exists())) {
    binaryReady = true
    return
  }
  const build = Bun.spawn(['bun', 'run', 'build'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, RITUAL_BUNDLED_LOCALES: TEST_BUNDLED_LOCALES },
  })
  const code = await build.exited
  if (code !== 0) {
    const stderr = await new Response(build.stderr).text()
    throw new Error(`Failed to build ritual binary for integration tests: ${stderr}`)
  }
  binaryReady = true
}

/**
 * Spawn the built `ritual` binary with the given args and capture
 * stdout/stderr. When `stdin` is given it is piped to the process (for flags
 * like `--password-stdin`); otherwise stdin is ignored.
 */
export async function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string | undefined>,
  stdin?: string | Buffer,
): Promise<CliResult> {
  await ensureBinary()
  const proc = Bun.spawn([binaryPath, ...args], {
    cwd,
    stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      // The suite's contract is cwd-as-workspace: an ambient RITUAL_BASE_DIR
      // exported in the developer's shell must not redirect every spawned CLI.
      // Tests that exercise the variable opt back in through `env`.
      RITUAL_BASE_DIR: undefined,
      ...LOCALE_ENV,
      ...env,
    },
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

/** Create a fresh temp directory, hand it to `run`, and clean it up afterwards. */
export async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(tmpdir(), `ritual-cli-test-${crypto.randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  try {
    await run(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
