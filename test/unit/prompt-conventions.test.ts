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
 * session or move screen that called the `prompts` library directly would open
 * a prompt that `--no-input` cannot refuse and that speaks the library's
 * English — so the gated globs below may import the library's types, never
 * its value.
 */

type Violation = { file: string; line: number; text: string }

async function scan(glob: string, pattern: RegExp): Promise<Violation[]> {
  const files = [...new Glob(glob).scanSync(ROOT)].map((file) => file.replace(/\\/g, '/')).sort()
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
  const GATED = [
    'src/commands/session/**/*.ts',
    'src/commands/move*.ts',
    'src/commands/add-card.ts',
    'src/commands/note.ts',
    'src/commands/init-site.ts',
  ]

  test.each(GATED)('the glob %s matches at least one file', (glob) => {
    // A glob that silently matches nothing would make the scan below vacuous.
    expect([...new Glob(glob).scanSync(ROOT)].length).toBeGreaterThan(0)
  })

  test.each(GATED)('no value import of the prompts library under %s', async (glob) => {
    // `import type { Choice } from 'prompts'` is fine; `import prompts from`
    // or `import { ... } from 'prompts'` (a value import) is not.
    expect(await scan(glob, /^\s*import\s+(?!type\b)[^'"]*from\s+['"]prompts['"]/)).toEqual([])
  })
})
