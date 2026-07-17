import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '../..')

// This is a textual scan, not an AST lint: a comment or string literal
// containing `process.exit(` under src/ would fail it. That brittleness is
// accepted — the convention is absolute, and prose can be reworded.

type Violation = { file: string; line: number; text: string }

async function scanSources(pattern: RegExp): Promise<Violation[]> {
  const glob = new Glob('src/**/*.ts')
  const files = [...glob.scanSync(ROOT)].filter((file) => !file.startsWith('src/generated/'))
  files.push('index.ts')

  const violations: Violation[] = []
  for (const file of files) {
    const content = await Bun.file(path.join(ROOT, file)).text()
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]
      if (text !== undefined && pattern.test(text)) {
        violations.push({ file, line: i + 1, text: text.trim() })
      }
    }
  }
  return violations
}

describe('command exit conventions', () => {
  test('no process.exit() calls — set process.exitCode and return instead', async () => {
    expect(await scanSources(/process\.exit\s*\(/)).toEqual([])
  })

  test('no numeric process.exitCode literals — use the ExitCode constants', async () => {
    expect(await scanSources(/process\.exitCode\s*=\s*\d/)).toEqual([])
  })
})
