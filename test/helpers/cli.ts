/**
 * Pure in-process Commander drivers, shared by the unit and integration suites
 * — nothing here spawns or builds the binary, which is what keeps
 * `test/integration/helpers/cli.ts` (and its build step) out of a unit run.
 */

import { Command } from 'commander'
import type { CommandRegistrar } from '../../src/cli/program'

export type { CommandRegistrar }

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
