import { describe, expect, test } from 'bun:test'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import { withWorkspace } from '../helpers/workspace'

/**
 * Network-free argument-surface tests for `deck-sync`. The sync flows
 * themselves are exercised against a stubbed Archidekt in
 * `deck-sync-run.test.ts` — these pin the subcommand surface and the
 * unauthenticated failure path.
 *
 * Every case resolves before any network call could happen; `OFFLINE_ENV` is the
 * backstop, so a stored or expired token can never turn one of these into a real
 * request to Archidekt (matching `collection-sync-cli.test.ts`).
 */
describe('deck-sync CLI (Integration)', () => {
  test('an unknown subcommand is a usage error', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync', 'sideways'], dir, OFFLINE_ENV)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("unknown command 'sideways'")
    })
  })

  test('a missing subcommand is a usage error', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync'], dir, OFFLINE_ENV)

      expect(result.exitCode).toBe(2)
    })
  })

  test('every documented subcommand is registered', async () => {
    await withWorkspace(async (dir) => {
      const help = await runCli(['deck-sync', '--help'], dir, OFFLINE_ENV)

      expect(help.exitCode).toBe(0)
      for (const name of ['pull', 'push', 'link', 'status']) {
        // Matched as a command-list entry, not as a substring anywhere in the
        // help: "link" also appears inside `status`'s own description, so a
        // `toContain` would stay green with the `link` subcommand deleted.
        expect(help.stdout).toMatch(new RegExp(`^\\s+${name}\\s`, 'm'))
      }
    })
  })

  test('--force is a push-only flag', async () => {
    await withWorkspace(async (dir) => {
      // A pull never writes to Archidekt, so it has no remote changes to
      // overwrite and no --force to give.
      const pull = await runCli(['deck-sync', 'pull', '--force'], dir, OFFLINE_ENV)
      expect(pull.exitCode).toBe(2)
      expect(pull.stderr).toContain("unknown option '--force'")

      const push = await runCli(['deck-sync', 'push', '--force'], dir, OFFLINE_ENV)
      expect(push.exitCode).toBe(1)
      expect(push.stderr).toContain('Not signed into Archidekt')
    })
  })

  test('status reports an empty workspace without a login', async () => {
    await withWorkspace(async (dir) => {
      // Read-only and offline: no Archidekt session is required to answer it.
      const result = await runCli(['deck-sync', 'status'], dir, OFFLINE_ENV)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('No Archidekt-linked decks')
      expect(result.stdout).toContain('Collection: never synced.')
    })
  })

  test('the removed --download-changes flag is rejected', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync', 'pull', '--download-changes'], dir, OFFLINE_ENV)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('unknown option')
    })
  })

  test('--yes is a recognized flag', async () => {
    // The confirmation logic itself is unit-tested; this pins the wiring, so a
    // renamed or dropped option surfaces as a usage error rather than silently
    // never confirming.
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync', 'pull', '--yes'], dir, OFFLINE_ENV)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Not signed into Archidekt')
    })
  })

  test('--only accepts the change filter values and rejects anything else', async () => {
    // Filtering itself is unit-tested; this pins the flag wiring, so a renamed
    // option or argParser surfaces here rather than silently syncing everything.
    await withWorkspace(async (dir) => {
      const accepted = await runCli(['deck-sync', 'pull', '--only', 'additions'], dir, OFFLINE_ENV)
      expect(accepted.exitCode).toBe(1)
      expect(accepted.stderr).toContain('Not signed into Archidekt')

      const rejected = await runCli(['deck-sync', 'pull', '--only', 'adds'], dir, OFFLINE_ENV)
      expect(rejected.exitCode).toBe(2)
      expect(rejected.stderr).toContain("Invalid change filter 'adds'")
      expect(rejected.stderr).toContain('Use one of: additions, removals.')
    })
  })

  test('a sync subcommand without an Archidekt login fails with exit 1', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync', 'pull'], dir, OFFLINE_ENV)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Not signed into Archidekt')
    })
  })

  test('--output json reports the login failure as a structured error', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync', 'push', '--output', 'json'], dir, OFFLINE_ENV)

      expect(result.exitCode).toBe(1)
      const parsed = JSON.parse(result.stderr) as {
        error: { code: string; message: string }
      }
      expect(parsed.error.code).toBe('runtime_error')
      expect(parsed.error.message).toContain('Not signed into Archidekt')
    })
  })
})
