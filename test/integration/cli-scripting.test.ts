import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'

describe('CLI scripting behavior (Integration)', () => {
  test('price returns structured json error with not-found exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['price', 'missing-deck', '--output', 'json'], dir)

      expect(result.exitCode).toBe(3)
      expect(result.stdout).toBe('')

      const errorJson = JSON.parse(result.stderr) as {
        error: { code: string; message: string }
      }
      expect(errorJson.error.code).toBe('not_found')
      expect(errorJson.error.message).toContain('missing-deck.md')
    })
  })

  test('import unsupported url returns usage exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['import', 'https://example.com/decks/123', '--non-interactive'],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('URL not supported')
    })
  })

  test('import moxfield url without user agent returns usage exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['import', 'https://moxfield.com/decks/abc123', '--non-interactive'],
        dir,
        { MOXFIELD_USER_AGENT: undefined },
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Moxfield-approved user agent string')
      expect(result.stderr).toContain('Contact Moxfield support')
    })
  })

  test('import non-interactive conflict returns runtime exit code', async () => {
    await withTempDir(async (dir) => {
      const decksDir = path.join(dir, 'decks')
      await fs.mkdir(decksDir, { recursive: true })
      await Bun.write(path.join(decksDir, 'conflict-deck.md'), '# Existing deck\n')

      const sourcePath = path.join(dir, 'source.txt')
      await Bun.write(
        sourcePath,
        `---
name: "Conflict Deck"
---
## Main
1 Sol Ring
`,
      )

      const result = await runCli(['import', sourcePath, '--non-interactive'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Import conflict')
    })
  })
})
