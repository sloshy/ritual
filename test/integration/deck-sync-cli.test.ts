import { describe, expect, test } from 'bun:test'
import { runCli } from './helpers/cli'
import { withWorkspace } from './helpers/workspace'

/**
 * Network-free argument-surface tests for `deck-sync`. The sync flows
 * themselves hit Archidekt and are not exercised here — these pin the
 * `<direction>` positional validation and the unauthenticated failure path.
 */
describe('deck-sync CLI (Integration)', () => {
  test('an invalid direction is a usage error', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync', 'sideways'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Invalid direction 'sideways'")
      expect(result.stderr).toContain('Use one of: push, pull.')
    })
  })

  test('a missing direction is a usage error', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('direction')
    })
  })

  test('the removed --download-changes flag is rejected', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync', 'pull', '--download-changes'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('unknown option')
    })
  })

  test('a valid direction without an Archidekt login fails with exit 1', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync', 'pull'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Not signed into Archidekt')
    })
  })

  test('--output json reports the login failure as a structured error', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['deck-sync', 'push', '--output', 'json'], dir)

      expect(result.exitCode).toBe(1)
      const parsed = JSON.parse(result.stderr) as {
        error: { code: string; message: string }
      }
      expect(parsed.error.code).toBe('runtime_error')
      expect(parsed.error.message).toContain('Not signed into Archidekt')
    })
  })
})
