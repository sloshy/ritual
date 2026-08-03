import { describe, expect, test } from 'bun:test'
import { ExitCode } from '../../src/commands/scripting'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import { withWorkspace } from './helpers/workspace'

/**
 * Network-free scripting-surface tests for `import-account`. The Archidekt
 * fetch itself (including pagination) is pinned against a mocked transport in
 * `test/unit/clients/ArchidektClient.test.ts`; these cover what the command
 * contributes — the `--output`/`--quiet` wiring, the structured error envelope,
 * and the usage exit codes a script keys on.
 *
 * Every case resolves before a request could happen; `OFFLINE_ENV` is the
 * backstop so a stored token can never turn one of these into a real fetch.
 */
describe('import-account CLI (Integration)', () => {
  test('deck selection without --all is a usage error, in the JSON error envelope', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(
        ['import-account', 'someuser', '--no-input', '--output', 'json'],
        dir,
        OFFLINE_ENV,
      )

      expect(result.exitCode).toBe(ExitCode.UsageError)
      // The payload channel stays clean; the error goes to stderr as structured JSON.
      expect(result.stdout).toBe('')
      type Envelope = { error: { code: string; message: string } }
      const envelope = JSON.parse(result.stderr) as Envelope
      expect(envelope.error.code).toBe('usage_error')
      expect(envelope.error.message).toContain('--all')
    })
  })

  test('no username and no login is a usage error', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['import-account', '--all', '--no-input'], dir, OFFLINE_ENV)

      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr).toContain('You must specify a username or login first.')
    })
  })

  test('--output and --quiet are recognized flags', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(
        ['import-account', '--all', '--no-input', '--output', 'ndjson', '--quiet'],
        dir,
        OFFLINE_ENV,
      )

      // Naming the error that DID fire is what proves the flags parsed: an
      // unknown option is also a usage error, so the negative alone proves nothing.
      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr).toContain('You must specify a username or login first.')
    })
  })

  test('an invalid --output value is rejected', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(
        ['import-account', 'someuser', '--all', '--output', 'yaml'],
        dir,
        OFFLINE_ENV,
      )

      expect(result.exitCode).toBe(ExitCode.UsageError)
      expect(result.stderr).toContain("Invalid output format 'yaml'")
    })
  })
})
