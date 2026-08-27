import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '../..')

/**
 * Source-scan convention test for the interactive prompt gate, modeled on
 * `test/unit/i18n-conventions.test.ts`: textual, not an AST lint.
 *
 * `ask()` in `src/cli/prompts.ts` is the one place the `--no-input` refusal,
 * the library-string overrides, and the Esc/Ctrl-C tracking live. Any other
 * module that called the `prompts` library directly would open a prompt that
 * `--no-input` cannot refuse and that speaks the library's English — so all of
 * `src/` may import the library's types, never its value, except the files in
 * {@link ALLOWED}: `ask()` itself and the three unconverted prompt sites, which
 * are the Zone 12 conversion inventory. A new entry here is a regression.
 */

type Violation = { file: string; text: string }

/**
 * Every `import … from 'prompts'` statement that is not `import type`, matched
 * over the whole file so a specifier list broken across lines is still one
 * statement. `[^'"]*?` cannot run past an earlier import's own module string,
 * so a preceding `import x from 'y'` never joins a later `from 'prompts'`.
 */
const PROMPTS_VALUE_IMPORT = /^[ \t]*import\s+(?!type\b)([^'"]*?)from\s+['"]prompts['"]/gm

/**
 * Whether an import's specifier list is type-only by inline `type` markers —
 * `import { type Choice, type PromptObject } from 'prompts'` compiles to
 * nothing, exactly like `import type`.
 */
function allInlineTypeSpecifiers(clause: string): boolean {
  const braces = clause.match(/^\s*\{([\s\S]*)\}\s*$/)
  // A default or namespace import beside the braces (`import prompts, { type Choice }`)
  // is a value import whatever the braces say.
  if (braces === null) return false
  const specifiers = braces[1]!
    .split(',')
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier.length > 0)
  return specifiers.length > 0 && specifiers.every((specifier) => /^type\s/.test(specifier))
}

async function scan(glob: string): Promise<Violation[]> {
  const files = [...new Glob(glob).scanSync(ROOT)].map((file) => file.replace(/\\/g, '/')).sort()
  const violations: Violation[] = []
  for (const file of files) {
    const text = await Bun.file(path.join(ROOT, file)).text()
    for (const match of text.matchAll(PROMPTS_VALUE_IMPORT)) {
      if (allInlineTypeSpecifiers(match[1]!)) continue
      violations.push({ file, text: match[0].trim() })
    }
  }
  return violations
}

describe('prompt gate conventions', () => {
  const GATED = 'src/**/*.{ts,tsx}'
  const ALLOWED = [
    'src/cli/prompts.ts',
    'src/commands/admin.ts',
    'src/commands/history.ts',
    'src/commands/dep-license.ts',
  ]

  test('only the allowlisted files value-import the prompts library', async () => {
    // `import type { Choice } from 'prompts'` is fine; `import prompts from`
    // or `import { ... } from 'prompts'` (a value import) is not. The
    // allowlist doubling as the expectation keeps the scan from being vacuous:
    // a glob matching nothing would fail it.
    const found = await scan(GATED)
    expect(found.map((violation) => violation.file).sort()).toEqual([...ALLOWED].sort())
  })

  test.each<[string, string, boolean]>([
    ['a default import', "import prompts from 'prompts'", true],
    ['a type-only import', "import type { Choice } from 'prompts'", false],
    [
      'inline type specifiers only',
      "import { type Choice, type PromptObject } from 'prompts'",
      false,
    ],
    ['a mixed specifier list', "import { type Choice, prompts } from 'prompts'", true],
    ['a multi-line value import', "import {\n  a,\n  type B,\n} from 'prompts'", true],
    [
      'a preceding import does not join',
      "import a from 'a'\nimport type { C } from 'prompts'",
      false,
    ],
    [
      'a default import beside type specifiers',
      "import prompts, { type Choice } from 'prompts'",
      true,
    ],
  ])('the scan classifies %s', (_label, source, violates) => {
    const matches = [...source.matchAll(PROMPTS_VALUE_IMPORT)].filter(
      (match) => !allInlineTypeSpecifiers(match[1]!),
    )
    expect(matches.length > 0).toBe(violates)
  })
})
