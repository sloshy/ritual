import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

const repoRoot = process.cwd()
const binaryPath = path.join(repoRoot, 'ritual')
let binaryReady = false

interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string | undefined>,
): Promise<CliResult> {
  if (!binaryReady) {
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

  const proc = Bun.spawn([binaryPath, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
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

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(tmpdir(), `ritual-cli-test-${crypto.randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  try {
    await run(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

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
