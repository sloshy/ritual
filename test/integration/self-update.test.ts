import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { ExitCode } from '../../src/util/errors'
import { binaryPath, ensureBinary, runCli, withTempDir } from './helpers/cli'

/**
 * The one path a spawned CLI can exercise: the test binary is a local build,
 * never a release, so `self-update` refuses before touching the network or
 * itself. Lookup, verification and the swap are unit-tested against a fake
 * release server in test/unit/update/.
 *
 * The `--tag` row also pins that the flag reaches the subcommand through the
 * real root program: the root owns `--version`, which is why the flag is not
 * spelled that way (a root option wins wherever it appears).
 */
describe('self-update CLI (Integration)', () => {
  test.each([[['self-update']], [['self-update', '--tag', 'v1.0.0']]])(
    '%p refuses a non-release build (exit 2) and leaves the binary alone',
    async (args) => {
      await ensureBinary()
      await withTempDir(async (dir) => {
        const before = await fs.stat(binaryPath)

        const result = await runCli(args, dir)

        expect(result.exitCode).toBe(ExitCode.UsageError)
        expect(result.stderr).toContain('self-update only replaces a Ritual release binary')
        expect((await fs.stat(binaryPath)).mtimeMs).toBe(before.mtimeMs)
      })
    },
  )
})
