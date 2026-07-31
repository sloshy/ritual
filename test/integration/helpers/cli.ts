import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

export const repoRoot = path.resolve(import.meta.dir, '../../..')
export const binaryPath = path.join(repoRoot, 'ritual')

export type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

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
