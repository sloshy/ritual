import path from 'node:path'
import { withWorkspace } from '../../helpers/workspace'

export const repoRoot = path.resolve(import.meta.dir, '../../..')
export const binaryPath = path.join(repoRoot, 'ritual')

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

/**
 * A **bare** temp directory scoped to `run`: no list subdirectories and no
 * `ritual.config.json`. Its ~180 call sites are the suites that pin
 * bare-directory behaviour, where writing a config would change the outcome —
 * hence the name and the one-argument shape. The directory itself comes from
 * {@link withWorkspace}, so there is one temp-workspace implementation.
 */
export async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  return withWorkspace(run, { dirs: [], config: false })
}
