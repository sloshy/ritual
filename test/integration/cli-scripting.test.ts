import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'

describe('CLI scripting behavior (Integration)', () => {
  test('price returns structured json error with not-found exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['price', 'missing-deck', '--deck', '--output', 'json'], dir)

      expect(result.exitCode).toBe(3)
      expect(result.stdout).toBe('')

      const errorJson = JSON.parse(result.stderr) as {
        error: { code: string; message: string }
      }
      expect(errorJson.error.code).toBe('not_found')
      expect(errorJson.error.message).toContain('No deck')
    })
  })

  test('price with an empty cache reports a structured runtime error', async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
      await fs.writeFile(path.join(dir, 'decks', 'sample.md'), '# sample\n\n1 Sol Ring &1\n')
      const result = await runCli(['price', '--summary', '--output', 'json'], dir)

      expect(result.exitCode).toBe(1)
      const errorJson = JSON.parse(result.stderr) as {
        error: { code: string; message: string }
      }
      expect(errorJson.error.code).toBe('runtime_error')
      expect(errorJson.error.message).toContain('card cache is empty')
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
      // sanitizeDeckFileName preserves case and spaces, so the pre-existing file
      // must match the source's `name:` frontmatter verbatim (plus `.md`) for the
      // conflict check to fire.
      await Bun.write(path.join(decksDir, 'Conflict Deck.md'), '# Existing deck\n')

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

  test('import text file with --type wanted writes a wanted list', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'wants.txt')
      await Bun.write(sourcePath, '2 Lightning Bolt (lea:161)\n')

      const result = await runCli(
        ['import', sourcePath, '--type', 'wanted', '--non-interactive'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'wanted', 'wants.md'), 'utf-8')
      expect(content).toContain('- Lightning Bolt (LEA:161) &1')
      expect(content).toContain('- Lightning Bolt (LEA:161) &2')
    })
  })

  test('import text file with --type collection writes a collection', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'binder.txt')
      await Bun.write(sourcePath, '1 Sol Ring (C19:221)\n')

      const result = await runCli(
        ['import', sourcePath, '--type', 'collection', '--non-interactive'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'collections', 'binder.md'), 'utf-8')
      expect(content).toContain('- Sol Ring (C19:221) &1')
    })
  })

  test('import text file without printings as collection returns runtime exit code', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'binder.txt')
      await Bun.write(sourcePath, '1 Arcane Signet\n')

      const result = await runCli(
        ['import', sourcePath, '--type', 'collection', '--non-interactive'],
        dir,
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no printing')
    })
  })

  test('import url with non-deck --type returns usage exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['import', 'https://archidekt.com/decks/12345', '--type', 'collection'],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('URL imports only support decks')
    })
  })

  test('import with invalid --type returns usage exit code', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['import', 'cards.txt', '--type', 'binder'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Invalid list type 'binder'")
    })
  })
})
