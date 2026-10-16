import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { compareData } from '../../src/i18n/collate'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { scanNamespaceBoundaries, scanRegistrationBoundaries } from '../../scripts/check-locales'
import { MESSAGE_NAMESPACES } from '../../src/i18n/messages/en'
import { isInScope } from '../../eslint-rules/no-untranslated-literal.js'
import tseslint from 'typescript-eslint'

/**
 * Source-scan convention tests for the i18n framework, modeled on
 * `test/unit/exit-conventions.test.ts`: glob `src/**`, skip generated code,
 * assert zero violations. Like that file this is textual, not an AST lint — a
 * comment containing a banned call would fail it. The brittleness is accepted,
 * because each convention below is absolute and prose can be reworded.
 *
 * The persistence fence is the highest-value test here. `.changes.md` is a
 * git-diffable data format: each entry's `ritual-changes` block is re-read by
 * `changelog-blocks.ts` on its JSON keys, and the prose beside it is the
 * English record every collaborator's copy was written with. If a localized
 * string ever reached those writers, the file would parse to zero changes and
 * show an empty history **with no error** — silent data destruction.
 */

const ROOT = path.resolve(import.meta.dir, '../..')

/** What {@link forbiddenDirectives} reads from a parse: the comments. */
type ParsedComments = { ast: { comments?: ReadonlyArray<{ value: string }> } }

/** The repo's own TypeScript parser, typed for the one field read here. */
const parseWithComments = tseslint.parser.parseForESLint as unknown as (
  code: string,
  options: Record<string, boolean>,
) => ParsedComments

/** An ESLint directive comment: its keyword, then its body. `/*eslint-disable*\/` needs no space. */
const DIRECTIVE =
  /^\s*(eslint-disable-next-line|eslint-disable-line|eslint-disable|eslint-enable|eslint)(?:\s|$)([\s\S]*)$/

/**
 * The inline ESLint directives in `source` that would switch off or reconfigure
 * `ritual/no-untranslated-literal`: an `eslint-disable*` naming it or naming no
 * rule at all, or an `eslint` config comment naming it.
 */
function forbiddenDirectives(source: string): string[] {
  // Every directive spells `eslint`, so a file without it needs no parse — which
  // keeps the whole-`src/` scan to the handful of files that mention it.
  if (!source.includes('eslint')) return []
  const { ast } = parseWithComments(source, {
    comment: true,
    jsx: true,
    range: true,
    loc: true,
  })
  const found: string[] = []
  for (const comment of ast.comments ?? []) {
    const match = DIRECTIVE.exec(comment.value)
    if (match === null) continue
    const [, keyword = '', body = ''] = match
    const rules = (body.split(/(?:^|\s)--(?:\s|$)/)[0] ?? '').trim()
    const namesRule = rules.includes('no-untranslated-literal')
    const blanket = keyword.startsWith('eslint-disable') && rules.length === 0
    if (namesRule || blanket) found.push(comment.value.trim())
  }
  return found
}

/** The persistence fence: modules that must never import `src/i18n` (see AGENTS.md). */
const PERSISTENCE_FENCE = [
  'src/changes/change-event.ts',
  'src/changes/changelog-writer.ts',
  'src/changes/changelog-parser.ts',
  'src/changes/changelog-blocks.ts',
  'src/changes/change-event-decode.ts',
  'src/changes/csv.ts',
  'src/changes/change-bundle.ts',
  // The fenced validators' refusal type: codes and values, never words.
  'src/changes/change-problem.ts',
  'src/changes/list-snapshot.ts',
  'src/changes/diff-categories.ts',
  'src/changes/wire-changes.ts',
  'src/changes/save-limits.ts',
  'src/list/entry-load.ts',
  'src/buylist/cart-csv.ts',
  ...[...new Glob('src/export/**/*.ts').scanSync(ROOT)].map((file) => file.replace(/\\/g, '/')),
]

/**
 * The card-line fence: the modules that write and re-parse the card-line
 * grammar itself, which must never import `src/i18n` (AGENTS.md, "Card-line
 * grammar is not prose").
 */
const LINE_FENCE = [
  'src/card/card-line-grammar.ts',
  // The grammar's diagnostics as codes and values, worded by the unfenced
  // `card-line-message.ts`.
  'src/card/card-line-text.ts',
  // The quantity token's reader and writer, shared by the grammar and every
  // line writer.
  'src/card/card-line-quantity.ts',
  'src/card/card-line-id.ts',
  'src/card/card-line-tail.ts',
  'src/card/card-line-read.ts',
  'src/list/line-diagnostics.ts',
  'src/list/deck-file.ts',
  'src/list/deck-text.ts',
  'src/card/card-line.ts',
  'src/list/collection-file.ts',
  'src/list/wanted-file.ts',
  'src/list/flat-list-scan.ts',
  'src/card/set-codes.ts',
  'src/card/card-id.ts',
  'src/card/printing-key.ts',
  'src/list/list-file-name.ts',
  'src/list/flat-list-read.ts',
  'src/importers/text-file.ts',
]

/**
 * The modules a line-fenced file reaches that import `src/i18n`, each with why
 * it cannot put localized text into a card line: what a line carries is a
 * literal token, and what these modules render is a refusal or a display label
 * returned to a caller, or a collation.
 */
const LINE_ROUTE_LEDGER: Record<string, string> = {
  'src/card/card-labels.ts':
    'label refusals and display labels returned to callers; the [labels] token is built from the literal vocabulary (formatLabelOverride)',
  'src/card/card-language.ts': 'collation only; the [ja] token is the literal code (languageToken)',
  'src/card/card-tags.ts':
    'collation only (compareData, pinned English) to order a tag set; tag values are the owner’s data',
  'src/card/finish-condition.ts':
    'display labels and refusals for callers; the [foil] / [NM] tokens are literals',
  'src/config/ritual-config.ts':
    'config validation refusals returned to callers and its own warning to the console; a card line carries no config text',
  'src/list/deck-format.ts':
    'display labels and the invalid-format refusal returned to callers; section headings and format slugs are literals',
  'src/list/list-type.ts':
    'display labels and nouns for list types; no line token is a list-type noun',
  'src/list/resolve-list.ts': 'refusals for a list that does not resolve, returned to callers',
  'src/pricing/price-currency.ts': 'formats prices for display; a card line carries no price',
  'src/scryfall/card-utils.ts': 'collation only, to order printings',
  'src/sync/message.ts':
    'renders the parsers’ notices and the line-break / set-code refusals for a reader; the line format never passes through it',
  'src/util/duration.ts': 'formats durations for display',
  'src/util/errors.ts': 'error text thrown to callers (localizedCommandError)',
  'src/util/parse-enum.ts': 'enum refusals returned to callers',
}

/**
 * The modules a fenced file reaches that import `src/i18n`, each with why it is
 * safe: what it takes from the catalog either orders data with the pinned
 * English collation, or is prose returned to (or thrown at) a caller — a
 * refusal, a display label — never text a fenced writer puts in a file.
 */
const I18N_ROUTE_LEDGER: Record<string, string> = {
  'src/card/card-labels.ts':
    'label refusals (keyed messages) and display labels returned to callers; the label tokens a line carries are literals',
  'src/card/card-language.ts':
    'collation only; persisted language names come from LANGUAGE_PARSE_NAMES, not the catalog',
  'src/card/card-tags.ts': 'collation only (compareData) to order a tag set',
  'src/card/finish-condition.ts':
    'display-only conditionLabel / finishLabel / finishSuffix and refusals for callers; the persisted tokens are literals',
  'src/config/ritual-config.ts':
    'parseLocaleTag and DEFAULT_LOCALE to validate uiLocale; validation refusals are messages returned or thrown to callers, and the ignored-field warning goes to the console; ritual.config.json is written from typed config values, or the raw file plus migration ops; never message text',
  'src/list/card-categories-record.ts':
    'collation only (compareData, pinned English) to order category names; its parse refusals are messages returned to callers, never sidecar bytes',
  'src/list/deck-format.ts':
    'display labels for deck formats and the invalid-format refusal returned to callers; the persisted format slugs and section-role spellings are literals',
  'src/list/list-type.ts':
    'display labels and nouns for list types; the persisted kinds and the English workspaceListTypeNoun commit messages use are literals',
  'src/list/resolve-list.ts':
    'refusals for a list that does not resolve (their remedies included), returned to callers',
  'src/pricing/price-currency.ts': 'formats prices for display; export rows carry raw numbers',
  'src/scryfall/card-utils.ts': 'collation only, to order printings',
  'src/sync/message.ts': 'renders messages for a reader at a boundary; persists nothing',
  'src/util/duration.ts': 'formats durations for display',
  'src/util/errors.ts': 'error text thrown to callers (localizedCommandError)',
  'src/util/parse-enum.ts': 'enum refusals returned to callers',
}

/**
 * The transpiler's own import scan: runtime imports only (type-only ones are
 * erased), including side-effect imports, re-exports (`export * from`,
 * `export { x } from`) and dynamic `import()` — the self-tests below pin each.
 */
const IMPORT_SCANNER = new Bun.Transpiler({ loader: 'tsx' })

/** The runtime import specifiers of a source text. */
function runtimeImports(source: string): string[] {
  return IMPORT_SCANNER.scanImports(source).map((entry) => entry.path)
}

/** The source-file extensions a relative specifier may name or omit. */
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/

/**
 * A relative specifier as a repo path to a source file, or null for a package.
 * Throws on a relative specifier that resolves to nothing: a walk that skipped
 * it could miss a whole subtree of routes.
 */
function resolveRelative(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  const stem = base.replace(SOURCE_EXTENSION, '')
  for (const candidate of [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`]) {
    if (existsSync(path.join(ROOT, candidate))) return candidate
  }
  throw new Error(`${from}: cannot resolve the relative import "${specifier}"`)
}

/**
 * Every module reached from `entries` by runtime relative imports,
 * transitively (the entries included), that imports `src/i18n` itself — sorted.
 * The walk stops at `src/i18n`: what is past it is the catalog, not a route.
 */
function i18nRoutes(entries: readonly string[]): string[] {
  const routes = new Set<string>()
  const seen = new Set<string>(entries)
  const queue = [...entries]
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const source = readFileSync(path.join(ROOT, file), 'utf-8')
    for (const specifier of runtimeImports(source)) {
      const target = resolveRelative(file, specifier)
      if (target === null) continue
      if (target.startsWith('src/i18n/')) {
        routes.add(file)
        continue
      }
      if (!seen.has(target)) {
        seen.add(target)
        queue.push(target)
      }
    }
  }
  return [...routes].sort(compareData)
}

type Violation = {
  file: string
  line: number
  text: string
}

function sourceFiles(): string[] {
  const files = [...new Glob('src/**/*.{ts,tsx}').scanSync(ROOT)].filter(
    (file) => !file.startsWith('src/generated/'),
  )
  files.push('index.ts')
  return files.map((file) => file.replace(/\\/g, '/')).sort()
}

/** Options for {@link scan}: which files to read, and which of them to skip. */
type ScanOptions = {
  files?: readonly string[]
  skip?: readonly string[]
}

async function scan(pattern: RegExp, options: ScanOptions = {}): Promise<Violation[]> {
  const files = (options.files ?? sourceFiles()).filter(
    (file) => !(options.skip ?? []).includes(file),
  )
  const violations: Violation[] = []
  for (const file of files) {
    const handle = Bun.file(path.join(ROOT, file))
    // An explicitly fenced file that no longer exists means the fence has gone
    // stale — silently skipping it would quietly drop it from the guard.
    if (options.files !== undefined) {
      expect({ file, exists: await handle.exists() }).toEqual({ file, exists: true })
    }
    if (!(await handle.exists())) continue
    const lines = (await handle.text()).split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index]
      if (text !== undefined && pattern.test(text)) {
        violations.push({ file, line: index + 1, text: text.trim() })
      }
    }
  }
  return violations
}

describe('the source scan', () => {
  /**
   * Vacuity guard. Every test in this file asserts `toEqual([])` against a scan,
   * so a glob that stopped matching — a moved `src/`, a `Glob` behavior change, a
   * `scanSync` cwd surprise — would turn all of them into unconditional passes,
   * including the persistence fence this file exists for.
   */
  test('actually sees the tree', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('src/changes/change-event.ts')
    expect(files).toContain('index.ts')
  })
})

describe('i18n persistence fence', () => {
  /**
   * These modules write or re-parse `.changes.md`, CSV exports, the
   * ritual-change-bundle envelope, and the Archidekt/Moxfield dialect headers.
   * All of it is English by contract, so none of them may import
   * the message catalog directly. Transitive routes are judged by the ledger
   * test below.
   */
  test('changelog, CSV, and export modules never import src/i18n', async () => {
    expect(await scan(/from\s+['"][^'"]*\bi18n\b/, { files: PERSISTENCE_FENCE })).toEqual([])
  })

  /**
   * Every module a fenced file reaches at runtime (following relative value
   * imports, transitively) that itself imports `src/i18n` is a route into the
   * catalog, and each must be in {@link I18N_ROUTE_LEDGER} with the reason it
   * cannot put localized text into a persisted file. A new route fails here
   * until someone writes that reason down; a route that is no longer reached
   * fails as stale, so the ledger stays exactly the set of edges that exist.
   */
  test('every i18n route a fenced module reaches is in the ledger', () => {
    const routes = i18nRoutes(PERSISTENCE_FENCE)
    // A fenced module is never a route itself — not even through a side-effect
    // or a dynamic import, which the direct scan above does not see.
    expect(routes.filter((file) => PERSISTENCE_FENCE.includes(file))).toEqual([])
    expect(routes).toEqual(Object.keys(I18N_ROUTE_LEDGER).sort(compareData))
  })

  /** The scanner the walk trusts, on the shapes a regex scan gets wrong. */
  test.each([
    [
      'an import after a quote-free type alias',
      "export type X = Y\nimport { t } from '../i18n/t'\n",
    ],
    ['an import after a type-only re-export', "export type { A }\nimport { t } from '../i18n/t'\n"],
    ['a side-effect import', "import '../i18n/t'\n"],
    ['a dynamic import', "const m = await import('../i18n/t')\nexport { m }\n"],
    ['a star re-export', "export * from '../i18n/t'\n"],
    ['a named re-export', "export { t } from '../i18n/t'\n"],
    [
      'an import after a quote inside braces',
      "const q = { 'a': 1 }; import { t } from '../i18n/t'\nvoid q\n",
    ],
  ])('the import scan sees %s', (_shape, source) => {
    expect(runtimeImports(source)).toContain('../i18n/t')
  })

  test('the import scan skips a type-only import, which loads nothing', () => {
    expect(runtimeImports("import type { MessageKey } from '../i18n/messages/en'\n")).toEqual([])
  })

  /**
   * The second fence, over the modules that write and re-parse the **card-line
   * grammar** itself. `1 Sol Ring (LEA:161) [foil] [NM] [ja] &12` is not prose:
   * `parseCardLine` reads those exact tokens back, and `SET:CN` casing, the `&N`
   * suffix and the bracket vocabulary are all matched literally. A `t()` inside a
   * line serializer would translate them into a markdown file the parser then
   * fails to read — the same silent-data-loss shape as the changelog fence, with
   * no test that would have caught it.
   */
  test('card-line serializers never import src/i18n', async () => {
    expect(await scan(/from\s+['"][^'"]*\bi18n\b/, { files: LINE_FENCE })).toEqual([])
  })

  /**
   * The line fence's direct scan cannot see a route through another module, so
   * — as for the persistence fence — every module a line-fenced file reaches
   * that imports `src/i18n` itself is listed in {@link LINE_ROUTE_LEDGER}, with
   * why it cannot put localized text into a card line. A new route fails here
   * until someone writes that reason down.
   */
  test('every i18n route a line-fenced module reaches is in the line ledger', () => {
    const routes = i18nRoutes(LINE_FENCE)
    expect(routes.filter((file) => LINE_FENCE.includes(file))).toEqual([])
    expect(routes).toEqual(Object.keys(LINE_ROUTE_LEDGER).sort(compareData))
  })

  /**
   * The card-line grammar words nothing itself: its diagnostics are codes and
   * values (`card-line-text.ts`), which `card-line-message.ts` maps to catalog
   * keys. The codes module — and the quantity token module, which every line
   * writer imports — load nothing at run time; what else the line-fenced
   * modules reach at run time (`sync/message.ts` for the line-break and
   * set-code refusals, the label and tag vocabularies) is pinned in
   * {@link LINE_ROUTE_LEDGER} above, each with why it never puts a translated
   * sentence into a card line.
   */
  test.each(['src/card/card-line-text.ts', 'src/card/card-line-quantity.ts'])(
    '%s loads nothing at run time',
    (file) => {
      const source = readFileSync(path.join(ROOT, file), 'utf-8')
      expect(runtimeImports(source)).toEqual([])
    },
  )

  /**
   * The persistence writer's *own* module must not reach the display renderer
   * either. `changeMessage` follows the active UI locale; one call to it from
   * `formatChangeCore` would put translated prose into a file that
   * the migration reads back on English verbs. Nor may a fenced validator word
   * its own refusal through `change-problem-message`: it returns the structured
   * problem, and the surface showing it words it.
   */
  test('the changelog writer and validators never reach a renderer', async () => {
    expect(
      await scan(/from\s+['"][^'"]*\bchange-(?:problem-)?message\b/, {
        files: [
          'src/changes/change-event.ts',
          'src/changes/changelog-writer.ts',
          'src/changes/changelog-parser.ts',
          'src/changes/changelog-blocks.ts',
          'src/changes/change-event-decode.ts',
          'src/changes/change-bundle.ts',
          'src/changes/wire-changes.ts',
          'src/changes/change-problem.ts',
        ],
      }),
    ).toEqual([])
  })
})

describe('i18n casing conventions', () => {
  /**
   * `toUpperCase()`/`toLowerCase()` are locale-invariant by spec (`'istanbul'`
   * uppercases to `ISTANBUL` everywhere), so the set-code normalization
   * invariant is safe as written. The *locale-sensitive* variants are the
   * hazard: `'I'.toLocaleLowerCase('tr')` is `ı`, which would corrupt a set
   * code, a slug, or a printing key.
   */
  test('no toLocaleUpperCase / toLocaleLowerCase anywhere in src/', async () => {
    expect(await scan(/\.toLocale(?:Upper|Lower)Case\s*\(/)).toEqual([])
  })
})

describe('i18n width conventions', () => {
  /**
   * `String.prototype.padEnd` counts UTF-16 code units, so it under-pads any
   * cell holding a Japanese card name — and `[ja]` card-language support
   * already puts those names into these columns. `src/i18n/width.ts` owns the
   * grapheme-aware replacements (`padEndDisplay` / `padStartDisplay`).
   */
  test('no padEnd / padStart on text outside src/i18n/width.ts', async () => {
    const violations = await scan(/\.pad(?:End|Start)\s*\(/, { skip: ['src/i18n/width.ts'] })
    // Digit padding (`.padStart(6, '0')` on a TOTP code) is not a text-width
    // problem — every digit is one column wide in every font.
    expect(violations.filter((entry) => !/,\s*'0'\s*\)/.test(entry.text))).toEqual([])
  })
})

describe('i18n namespace boundaries', () => {
  /**
   * `src/site/**` and `src/admin/site/**` may use `site` / `admin` / `ui` /
   * `domain` / `errors` keys, never `cli` / `help`. This is what keeps the
   * CLI's message inventory out of the two SPA bundles.
   */
  test('the SPAs never reach into the cli or help namespaces', async () => {
    expect(await scanNamespaceBoundaries(ROOT)).toEqual([])
  })

  /**
   * The scanner's own falsifiability. The assertion above is the *passing*
   * state, and `catalog.test.ts` drives `checkCatalogs` with a pre-made
   * violation list — so neither exercises the two detection branches. If either
   * broke, both tests and the `check-locales` precommit gate would pass silently
   * forever.
   */
  /**
   * The *other* half of the boundary. `scanNamespaceBoundaries` polices the
   * keys a browser file may name; this polices the namespaces a browser
   * surface's registration module pulls into its bundle. Naming no `cli.*` key
   * is not enough — one `import { en }` in `src/i18n/register/site.ts` would put
   * all 1,440 CLI messages back into both SPAs while every other check passed.
   */
  test('the browser surfaces register only the namespaces they may carry', async () => {
    expect(await scanRegistrationBoundaries(ROOT)).toEqual([])
  })

  test('detects a browser surface registering a CLI namespace', async () => {
    const root = path.join(tmpdir(), `ritual-reg-${crypto.randomUUID()}`)
    await fs.mkdir(path.join(root, 'src', 'i18n', 'register'), { recursive: true })
    try {
      // `site.ts` reaches for a CLI fragment; `admin.ts` grabs the whole barrel
      // *and* inherits site's mistake through the register-to-register edge the
      // real modules use.
      await fs.writeFile(
        path.join(root, 'src', 'i18n', 'register', 'site.ts'),
        "import { cliMessages } from '../messages/en/cli'\n",
      )
      await fs.writeFile(
        path.join(root, 'src', 'i18n', 'register', 'admin.ts'),
        "import { en } from '../messages/en'\nimport { registerSiteMessages } from './site'\n",
      )
      const violations = await scanRegistrationBoundaries(root)
      expect(violations).toEqual([
        {
          file: 'src/i18n/register/site.ts',
          line: 1,
          detail:
            'registers the "cli" namespace, which the "src/i18n/register/site.ts" surface may not carry',
        },
        {
          file: 'src/i18n/register/admin.ts',
          line: 1,
          detail:
            'imports the full English catalog, registering every namespace for the "src/i18n/register/admin.ts" surface',
        },
        {
          file: 'src/i18n/register/site.ts',
          line: 1,
          detail:
            'registers the "cli" namespace, which the "src/i18n/register/admin.ts" surface may not carry',
        },
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  /**
   * A type-only import of the barrel is how ~40 files name `MessageKey`; it is
   * erased, costs no bytes, and must stay legal. A *value* import of the same
   * module from a browser directory is the regression this catches.
   */
  test('a type-only catalog import is legal, a value import is not', async () => {
    const root = path.join(tmpdir(), `ritual-ns-${crypto.randomUUID()}`)
    await fs.mkdir(path.join(root, 'src', 'site'), { recursive: true })
    try {
      await fs.writeFile(
        path.join(root, 'src', 'site', 'Fine.ts'),
        "import type { MessageKey } from '../i18n/messages/en'\n",
      )
      await fs.writeFile(
        path.join(root, 'src', 'site', 'Heavy.ts'),
        "import { en } from '../i18n/messages/en'\n",
      )
      await fs.writeFile(
        path.join(root, 'src', 'site', 'Heavier.ts'),
        "import { registerCliMessages } from '../i18n/register/cli'\n",
      )
      expect(await scanNamespaceBoundaries(root)).toEqual([
        {
          file: 'src/site/Heavier.ts',
          line: 1,
          detail: 'imports the CLI registration module, which registers every namespace',
        },
        {
          file: 'src/site/Heavy.ts',
          line: 1,
          detail: 'imports the full English catalog',
        },
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test('detects both shapes of violation in a synthetic tree', async () => {
    const root = path.join(tmpdir(), `ritual-ns-${crypto.randomUUID()}`)
    await fs.mkdir(path.join(root, 'src', 'site'), { recursive: true })
    await fs.mkdir(path.join(root, 'src', 'admin', 'site'), { recursive: true })
    try {
      await fs.writeFile(
        path.join(root, 'src', 'site', 'Bad.tsx'),
        "const label = t('cli.menu.exit')\n",
      )
      await fs.writeFile(
        path.join(root, 'src', 'admin', 'site', 'Worse.ts'),
        "import { cliMessages } from '../../i18n/messages/en/cli'\n",
      )
      const violations = await scanNamespaceBoundaries(root)
      expect(violations).toEqual([
        {
          file: 'src/admin/site/Worse.ts',
          line: 1,
          detail: 'imports the "cli" catalog fragment',
        },
        {
          file: 'src/site/Bad.tsx',
          line: 1,
          detail: 'uses the "cli" namespace key cli.menu.exit',
        },
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe('i18n boot ordering', () => {
  /**
   * No message may be **rendered at module scope**.
   *
   * Namespaces are registered by the surface entry point — `main()` in
   * `index.ts`, or the `registerSiteMessages()` / `registerAdminMessages()` call
   * at the top of each SPA's `app.tsx` — and every module body in the graph has
   * already run by then. A `const X = t('…')` or `const X = apiMessage('…')` at
   * module scope therefore captures the *key string*, silently, in whatever it
   * is later spread into. (It was also already wrong for a different reason: the
   * CLI resolves `--locale` inside `main()`, so a module-scope render would be
   * stuck in the boot language.)
   *
   * Lines are only flagged when the renderer is called *eagerly*: an arrow
   * function or a function body is exactly the deferral this asks for.
   */
  test('no message is rendered at module scope', async () => {
    const violations = await scan(
      /^(?:export )?const [^=]*=[^=]*\b(?:apiMessage|tIn|tSegmentsIn|tSegments|tDynamic|t)\(/,
    )
    expect(violations.filter((entry) => !/=>|\bfunction\b/.test(entry.text))).toEqual([])
  })
})

describe('changelog display rendering', () => {
  /**
   * `formatChangeCore` is persistence-only. Display goes through a single
   * `changeMessage(change)` renderer shared by the CLI, the public site's
   * changelog modal, and the editors — collapsing the documented "keep the two
   * in sync" duplication `src/site/changelog-format.ts` used to carry rather
   * than adding a third copy.
   */
  test('changeMessage has exactly one implementation', async () => {
    const declarations = await scan(/export\s+(?:function|const)\s+changeMessage\b/)
    expect(declarations.map((entry) => entry.file)).toEqual(['src/changes/change-message.ts'])
  })

  /**
   * The old renderer's `{ prefix, suffix }` shape is what forced the card name
   * into a fixed position mid-sentence; `tSegments` replaced it. If it comes
   * back, so does the duplication.
   */
  test('the prefix/suffix changelog renderer is gone', async () => {
    expect(await scan(/\bformatChangeText\b/)).toEqual([])
  })
})

describe('lint-rule vocabulary', () => {
  /**
   * `eslint-rules/no-untranslated-literal.js` treats a key-shaped literal in a
   * `label:` / `description:` position as a *reference* to catalog text rather
   * than untranslated prose, so the `Record<Key, MessageKey>` label tables do not
   * each need an exempt comment. An ESLint rule cannot import TypeScript, so it
   * duplicates the namespace list — this keeps the copy honest. A namespace
   * missing from the rule would make every label table in it a lint error.
   */
  test('the rule knows every message namespace', async () => {
    const source = await Bun.file(path.join(ROOT, 'eslint-rules/no-untranslated-literal.js')).text()
    const match = /const MESSAGE_KEY_LIKE =\s*\/\^\(\?:([^)]+)\)/.exec(source)
    expect(match).not.toBeNull()
    expect((match?.[1] ?? '').split('|').sort()).toEqual([...MESSAGE_NAMESPACES].sort())
  })

  /**
   * The fence stops these modules importing the catalog; it does not make their
   * human messages (validation errors, export warnings) English by contract. They
   * stay visible to `no-untranslated-literal` — baselined debt that converts to
   * structured codes translated at the boundary — so none can land unnoticed.
   */
  test('the persistence fence stays in the untranslated-text rule scope', () => {
    expect(PERSISTENCE_FENCE.filter((file) => !isInScope(file))).toEqual([])
  })

  /**
   * The only escape hatch from `no-untranslated-literal` is a reasoned
   * `// i18n-exempt:` comment. An `eslint-disable` naming the rule — or naming no
   * rule at all, which disables every rule — or an inline `/* eslint … *\/`
   * config that reconfigures it would be a silent second one. Comments are read
   * from the parsed AST, so spacing, block comments and multi-line directives
   * cannot hide one; only files containing `eslint` are parsed, which keeps the
   * scan fast.
   */
  test('no inline directive turns off or reconfigures the untranslated-text rule', async () => {
    const violations: string[] = []
    for (const file of sourceFiles()) {
      const source = await Bun.file(path.join(ROOT, file)).text()
      for (const directive of forbiddenDirectives(source)) violations.push(`${file}: ${directive}`)
    }
    expect(violations).toEqual([])
  })

  test.each([
    ['/* eslint ritual/no-untranslated-literal: off */', true],
    ['/* eslint ritual/no-untranslated-literal: ["error", { "include": [] }] */', true],
    ['/*eslint-disable*/', true],
    ['// eslint-disable-next-line', true],
    ['/* eslint-disable\n   ritual/no-untranslated-literal\n*/', true],
    ['// eslint-disable-line -- a reason, but no rule list', true],
    ['// eslint-disable-next-line ritual/no-untranslated-literal -- x', true],
    ['// eslint-disable-next-line no-control-regex -- y', false],
    ['/* eslint no-console: off */', false],
    ['// i18n-exempt: data', false],
    ['// prose that mentions eslint-disable in passing', false],
  ])('the directive scan judges %p', (comment, forbidden) => {
    const source = `const a = 1\n${comment}\nconst b = 2\n`
    expect(forbiddenDirectives(source).length > 0).toBe(forbidden)
  })

  /**
   * The lint config may hand the rule only its root and the baseline: any
   * `include` / `exclude` / `contractCalls` override there would quietly narrow
   * what the rule sees, away from the defaults AGENTS.md documents. Likewise no
   * `src/` path may be ESLint-ignored beyond generated code and compiled bundles.
   */
  test('the lint config passes the rule only its root and baseline, and ignores no source', async () => {
    const config = (await import('../../eslint.config.js')).default as ReadonlyArray<{
      ignores?: string[]
      rules?: Record<string, unknown>
    }>
    const settings = config
      .map((entry) => entry.rules?.['ritual/no-untranslated-literal'])
      .filter((setting): setting is [string, Record<string, unknown>] => Array.isArray(setting))
    expect(settings).toHaveLength(1)
    const options = settings[0]?.[1] ?? {}
    expect(Object.keys(options).sort()).toEqual(['baseline', 'root'])
    expect(options['root']).toBe(ROOT)
    const ignoredSources = config
      .flatMap((entry) => (entry.rules === undefined ? (entry.ignores ?? []) : []))
      .filter((pattern) => pattern.startsWith('src/'))
      .sort()
    expect(ignoredSources).toEqual([
      'src/admin/site/app.compiled.js',
      'src/admin/site/styles.compiled.css',
      'src/generated/**',
      'src/site/app.compiled.js',
      'src/site/styles.compiled.css',
    ])
  })

  test('no JavaScript sources under src/ escape the TypeScript-only lint', () => {
    const js = [...new Glob('src/**/*.{js,jsx,mjs,cjs}').scanSync(ROOT)]
      .map((file) => file.replace(/\\/g, '/'))
      .filter((file) => !file.endsWith('.compiled.js'))
    expect(js).toEqual([])
  })
})
