import { RuleTester } from '@typescript-eslint/rule-tester'
import { Linter } from 'eslint'
import { afterAll, describe, expect, it, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import rule from '../../../eslint-rules/no-upward-import.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it

const ruleTester = new RuleTester()
const ROOT = path.resolve(import.meta.dir, '../../..')

// A three-layer table small enough to read; the real one lives in eslint.config.js.
const LAYERS = [
  { name: 'domain', dirs: ['src/util', 'src/card', 'src/list'] },
  { name: 'editor', dirs: ['src/editor'] },
  { name: 'apps', dirs: ['src/site', 'src/admin'] },
]
const OPTIONS = [{ layers: LAYERS }]
/** One allow entry, used as a matched/unmatched pair below. */
const COMBINED_LIST_DEBT = [{ from: 'src/editor', to: 'src/site/combined-list' }]

ruleTester.run('no-upward-import', rule as never, {
  valid: [
    // Downward and same-layer imports, in every import form.
    {
      code: `import { a } from '../list/deck'`,
      filename: 'src/editor/commit.ts',
      options: OPTIONS,
    },
    {
      code: `import { a } from '../editor/useEditor'`,
      filename: 'src/site/DeckPage.tsx',
      options: OPTIONS,
    },
    {
      code: `import { a } from '../../site/data-types'`,
      filename: 'src/admin/api/x.ts',
      options: OPTIONS,
    },
    { code: `import { a } from './card-line'`, filename: 'src/card/card.ts', options: OPTIONS },
    { code: `export { a } from '../card/card'`, filename: 'src/list/deck.ts', options: OPTIONS },
    { code: `export * from '../util/fs'`, filename: 'src/editor/x.ts', options: OPTIONS },
    {
      code: `const m = await import('../list/deck')`,
      filename: 'src/editor/x.ts',
      options: OPTIONS,
    },
    // Bare specifiers are packages, never a layer — even when the text looks like a path
    // into a higher layer.
    {
      code: `import { a } from 'src/site/DeckPage'`,
      filename: 'src/list/deck.ts',
      options: OPTIONS,
    },
    // A statement with no source (nothing to resolve) is not a crash.
    { code: `export const a = 1`, filename: 'src/list/deck.ts', options: OPTIONS },
    // A dynamic import whose specifier is not a literal cannot be judged and is skipped.
    { code: `const m = await import(spec)`, filename: 'src/list/deck.ts', options: OPTIONS },
    // Files and targets outside every layer are unconstrained.
    {
      code: `import { a } from '../site/DeckPage'`,
      filename: 'src/commands/foo.ts',
      options: OPTIONS,
    },
    { code: `import { a } from '../i18n/t'`, filename: 'src/list/deck.ts', options: OPTIONS },
    // A sibling directory that merely shares a prefix is not the layer.
    {
      code: `import { a } from '../site-build/x'`,
      filename: 'src/list/deck.ts',
      options: OPTIONS,
    },
    // A single-module allow entry matches the file it names, extension and all.
    {
      code: `import { a } from '../editor/apply-batch'`,
      filename: 'src/list/list-mutate.ts',
      options: [{ layers: LAYERS, allow: [{ from: 'src/list/list-mutate', to: 'src/editor' }] }],
    },
    // The allow list is an exact (from, to) pair — this one matches.
    {
      code: `import { a } from '../site/combined-list'`,
      filename: 'src/editor/swap-targets.ts',
      options: [{ layers: LAYERS, allow: COMBINED_LIST_DEBT }],
    },
    // Type-only imports and re-exports can be opted out of the check.
    {
      code: `import type { A } from '../site/data-types'`,
      filename: 'src/editor/x.ts',
      options: [{ layers: LAYERS, ignoreTypeImports: true }],
    },
    {
      code: `export type { A } from '../site/data-types'`,
      filename: 'src/editor/x.ts',
      options: [{ layers: LAYERS, ignoreTypeImports: true }],
    },
    {
      code: `export type * from '../site/data-types'`,
      filename: 'src/editor/x.ts',
      options: [{ layers: LAYERS, ignoreTypeImports: true }],
    },
    // The longest matching fragment wins, so a sub-directory can sit lower than its parent.
    {
      code: `import { a } from '../../site/details/types'`,
      filename: 'src/list/x/y.ts',
      options: [
        {
          layers: [
            { name: 'domain', dirs: ['src/list', 'src/site/details'] },
            { name: 'apps', dirs: ['src/site'] },
          ],
        },
      ],
    },
  ],

  invalid: [
    {
      code: `import { DeckPage } from '../site/DeckPage'`,
      filename: 'src/editor/DeckEditController.tsx',
      options: OPTIONS,
      errors: [
        {
          messageId: 'upwardImport',
          data: {
            specifier: '../site/DeckPage',
            fromLayer: 'editor',
            fromDir: 'src/editor',
            toLayer: 'apps',
            toDir: 'src/site',
          },
        },
      ],
    },
    // Two layers up, from a nested importer.
    {
      code: `import { a } from '../../admin/api/save-helpers'`,
      filename: 'src/list/x/y.ts',
      options: OPTIONS,
      errors: [
        {
          messageId: 'upwardImport',
          data: {
            specifier: '../../admin/api/save-helpers',
            fromLayer: 'domain',
            fromDir: 'src/list',
            toLayer: 'apps',
            toDir: 'src/admin',
          },
        },
      ],
    },
    // Re-exports and dynamic imports count too.
    {
      code: `export { a } from '../editor/apply-batch'`,
      filename: 'src/list/list-mutate.ts',
      options: OPTIONS,
      errors: [{ messageId: 'upwardImport' }],
    },
    {
      code: `export * from '../editor/apply-batch'`,
      filename: 'src/list/list-mutate.ts',
      options: OPTIONS,
      errors: [{ messageId: 'upwardImport' }],
    },
    {
      code: `const m = await import('../editor/apply-batch')`,
      filename: 'src/list/list-mutate.ts',
      options: OPTIONS,
      errors: [{ messageId: 'upwardImport' }],
    },
    // The option exempts type-only imports, not value imports.
    {
      code: `import { a } from '../site/DeckPage'`,
      filename: 'src/editor/x.ts',
      options: [{ layers: LAYERS, ignoreTypeImports: true }],
      errors: [{ messageId: 'upwardImport' }],
    },
    // An inline type specifier is a value import statement and is judged as one.
    {
      code: `import { type A } from '../site/DeckPage'`,
      filename: 'src/editor/x.ts',
      options: [{ layers: LAYERS, ignoreTypeImports: true }],
      errors: [{ messageId: 'upwardImport' }],
    },
    // Each upward statement is reported on its own.
    {
      code: `import { a } from '../site/DeckPage'\nimport { b } from '../admin/x'`,
      filename: 'src/editor/x.ts',
      options: OPTIONS,
      errors: [{ messageId: 'upwardImport' }, { messageId: 'upwardImport' }],
    },
    // The longest fragment wins for the target: a sub-directory placed ABOVE its parent…
    {
      code: `import { a } from '../site/details/types'`,
      filename: 'src/list/x.ts',
      options: [
        {
          layers: [
            { name: 'domain', dirs: ['src/list', 'src/site'] },
            { name: 'apps', dirs: ['src/site/details'] },
          ],
        },
      ],
      errors: [
        {
          messageId: 'upwardImport',
          data: {
            specifier: '../site/details/types',
            fromLayer: 'domain',
            fromDir: 'src/list',
            toLayer: 'apps',
            toDir: 'src/site/details',
          },
        },
      ],
    },
    // …and for the importer: a file under the sub-directory is judged by the longer fragment.
    {
      code: `import { a } from '../../editor/apply-batch'`,
      filename: 'src/site/details/wanted.ts',
      options: [
        {
          layers: [
            { name: 'domain', dirs: ['src/site/details'] },
            { name: 'editor', dirs: ['src/editor'] },
            { name: 'apps', dirs: ['src/site'] },
          ],
        },
      ],
      errors: [
        {
          messageId: 'upwardImport',
          data: {
            specifier: '../../editor/apply-batch',
            fromLayer: 'domain',
            fromDir: 'src/site/details',
            toLayer: 'editor',
            toDir: 'src/editor',
          },
        },
      ],
    },
    // Windows separators are normalized before matching.
    {
      code: `import { a } from '../site/DeckPage'`,
      filename: 'src\\editor\\x.ts',
      options: OPTIONS,
      errors: [{ messageId: 'upwardImport' }],
    },
    // …including the type-position import form.
    {
      code: `type P = import('../site/DeckPage').DeckPageProps`,
      filename: 'src/editor/x.ts',
      options: OPTIONS,
      errors: [{ messageId: 'upwardImport' }],
    },
    // Type-only imports are checked by default.
    {
      code: `import type { A } from '../site/data-types'`,
      filename: 'src/editor/x.ts',
      options: OPTIONS,
      errors: [{ messageId: 'upwardImport' }],
    },
    // The allow list is exact: a neighbouring module in the same directory is not covered.
    {
      code: `import { a } from '../site/data-types'`,
      filename: 'src/editor/swap-targets.ts',
      options: [{ layers: LAYERS, allow: COMBINED_LIST_DEBT }],
      errors: [{ messageId: 'upwardImport' }],
    },
    // …and scoped to the importer too.
    {
      code: `import { a } from '../editor/apply-batch'`,
      filename: 'src/list/deck.ts',
      options: [{ layers: LAYERS, allow: [{ from: 'src/list/list-mutate', to: 'src/editor' }] }],
      errors: [{ messageId: 'upwardImport' }],
    },
  ],
})

/**
 * Outside RuleTester (which pins `cwd` to the filesystem root) ESLint reports
 * absolute filenames, and the rule takes them relative to `context.cwd`. Driven
 * through the Linter API so the cwd is under test too.
 */
describe('absolute filenames', () => {
  // Plain .js so ESLint's default flat-config file pattern matches without a parser.
  const lintAt = (cwd: string, filename: string): number =>
    new Linter({ cwd })
      .verify(
        "import { a } from '../site/DeckPage'",
        {
          plugins: { ritual: { rules: { 'no-upward-import': rule } } },
          rules: { 'ritual/no-upward-import': ['error', { layers: LAYERS }] },
          languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        },
        filename,
      )
      .filter((message) => message.ruleId === 'ritual/no-upward-import').length

  test('a file under the project root is judged by its repo-relative path', () => {
    expect(lintAt(ROOT, `${ROOT}/src/editor/x.js`)).toBe(1)
    expect(lintAt(ROOT, `${ROOT}/src/site/x.js`)).toBe(0)
  })

  test('a checkout path that itself contains a layer segment does not misclassify', () => {
    // A substring match on '/src/list/' would have put every file here in 'domain'.
    expect(lintAt('/tmp/src/list/ritual', '/tmp/src/list/ritual/src/editor/x.js')).toBe(1)
    expect(lintAt('/tmp/src/list/ritual', '/tmp/src/list/ritual/src/site/x.js')).toBe(0)
  })
})

/**
 * Vacuity guard for the real table in eslint.config.js. A layer fragment naming
 * a path that no longer exists is silently inert — the directory becomes
 * unconstrained — and lint stays green. Pin that every fragment resolves to
 * something on disk, so a rename shows up here instead of quietly widening what
 * the rule permits. The same holds for an `allow` entry, which is why the list
 * is checked for emptiness rather than merely for resolvable paths.
 */
describe('the eslint.config.js layer table', () => {
  type LayerOptions = {
    layers: { name: string; dirs: string[] }[]
    allow: { from: string; to: string }[]
  }
  const loadOptions = async (): Promise<LayerOptions> => {
    const { default: config } = (await import('../../../eslint.config.js')) as {
      default: { rules?: Record<string, unknown> }[]
    }
    const entry = config.find((c) => c.rules?.['ritual/no-upward-import'] !== undefined)
    const [, options] = entry!.rules!['ritual/no-upward-import'] as [string, LayerOptions]
    return options
  }

  test('the layers are the Zone 9 sub-layered table, bottom-up', async () => {
    const options = await loadOptions()
    expect(options.layers.map((layer) => layer.name)).toEqual([
      'core',
      'providers',
      'engines',
      'ui',
      'list-view',
      'editor',
      'site',
      'admin',
      'entry',
    ])
  })

  test('the allow list is empty and stays that way', async () => {
    // Zone 10 closed the last two entries. Each one was a hole in the layering
    // that lint could not see through, so re-adding one is a decision to take
    // deliberately — not a way past a lint failure.
    const options = await loadOptions()
    expect(options.allow).toEqual([])
  })

  test('every layer fragment and allow entry names a real path', async () => {
    const options = await loadOptions()
    const fragments = [
      ...options.layers.flatMap((layer) => layer.dirs),
      ...options.allow.flatMap((debt) => [debt.from, debt.to]),
    ]
    const missing = fragments.filter(
      (fragment) =>
        !existsSync(path.join(ROOT, fragment)) &&
        !['.ts', '.tsx'].some((ext) => existsSync(path.join(ROOT, fragment + ext))),
    )
    expect(fragments.length).toBeGreaterThan(20)
    expect(missing).toEqual([])
  })

  /** Lint one import under the real table; the count of upward-import reports. */
  const lintReal = async (filename: string, specifier: string): Promise<number> =>
    new Linter({ cwd: ROOT })
      .verify(
        `import { a } from '${specifier}'`,
        {
          plugins: { ritual: { rules: { 'no-upward-import': rule } } },
          rules: { 'ritual/no-upward-import': ['error', await loadOptions()] },
          languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        },
        `${ROOT}/${filename}`,
      )
      .filter((message) => message.ruleId === 'ritual/no-upward-import').length

  /**
   * Membership spot-checks: the sub-layered table places `src/scryfall` in
   * providers, `src/list` in core, and `src/importers` in engines, so each may
   * import downward and none upward.
   */
  test.each<[string, string, number]>([
    ['src/scryfall/x.js', '../list/deck', 0],
    ['src/scryfall/x.js', '../importers/csv-apply', 1],
    ['src/list/x.js', '../scryfall/client', 1],
    ['src/list/x.js', '../util/errors', 0],
    ['src/importers/x.js', '../scryfall/client', 0],
    ['src/importers/x.js', '../admin/server', 1],
    // The two edges Zone 10 closed, now enforced rather than allow-listed.
    ['src/api/x.js', '../admin/api/save-helpers', 1],
    ['src/cache/x.js', '../cache-feed/host', 1],
  ])('%s importing %s reports %i', async (filename, specifier, reports) => {
    expect(await lintReal(filename, specifier)).toBe(reports)
  })

  /**
   * The converse: a directory the table does not name is unconstrained in both
   * directions, so a new `src/*` directory silently escapes the rule until
   * someone notices. Every top-level source directory must sit in some layer.
   */
  test('every directory directly under src/ is placed in a layer', async () => {
    // Assets and generated output, not TypeScript modules: nothing imports
    // across them, so they have no place in the layer table.
    const UNLAYERED = ['src/css', 'src/generated']
    // An exemption for a directory that no longer exists is inert; pin it the
    // way the sibling test pins the layer fragments.
    for (const dir of UNLAYERED)
      expect({ dir, exists: existsSync(path.join(ROOT, dir)) }).toEqual({ dir, exists: true })
    const options = await loadOptions()
    const layered = new Set(options.layers.flatMap((layer) => layer.dirs))
    const dirs = readdirSync(path.join(ROOT, 'src'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `src/${entry.name}`)
    expect(dirs.length).toBeGreaterThan(20)
    expect(dirs.filter((dir) => !layered.has(dir) && !UNLAYERED.includes(dir))).toEqual([])
  })
})
