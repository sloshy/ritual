import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '../..')

/**
 * Source-scan convention test for the interactive prompt gate, modeled on
 * `test/unit/i18n-conventions.test.ts`: textual, not an AST lint.
 *
 * `ask()` in `src/cli/prompts.ts` is the one place the `--no-input` refusal,
 * the library-string overrides, and the Esc/Ctrl-C tracking live. A card
 * session that called the `prompts` library directly would open a prompt that
 * `--no-input` cannot refuse and that speaks the library's English — so the
 * session directory may import the library's types, never its value.
 */

type Violation = { file: string; line: number; text: string }

async function scan(dir: string, pattern: RegExp): Promise<Violation[]> {
  const files = [...new Glob(`${dir}/**/*.ts`).scanSync(ROOT)]
    .map((file) => file.replace(/\\/g, '/'))
    .sort()
  const violations: Violation[] = []
  for (const file of files) {
    const lines = (await Bun.file(path.join(ROOT, file)).text()).split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index]
      if (text !== undefined && pattern.test(text)) {
        violations.push({ file, line: index + 1, text: text.trim() })
      }
    }
  }
  return violations
}

describe('prompt gate conventions', () => {
  test('the scan actually sees the session directory', async () => {
    expect((await scan('src/commands/session', /from\s+['"]prompts['"]/)).length).toBeGreaterThan(0)
  })

  test('no value import of the prompts library under src/commands/session/', async () => {
    // `import type { Choice } from 'prompts'` is fine; `import prompts from`
    // or `import { ... } from 'prompts'` (a value import) is not.
    expect(
      await scan('src/commands/session', /^\s*import\s+(?!type\b)[^'"]*from\s+['"]prompts['"]/),
    ).toEqual([])
  })
})
