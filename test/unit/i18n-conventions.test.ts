import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { scanNamespaceBoundaries, scanRegistrationBoundaries } from '../../scripts/check-locales'
import { MESSAGE_NAMESPACES } from '../../src/i18n/messages/en'

/**
 * Source-scan convention tests for the i18n framework, modeled on
 * `test/unit/exit-conventions.test.ts`: glob `src/**`, skip generated code,
 * assert zero violations. Like that file this is textual, not an AST lint — a
 * comment containing a banned call would fail it. The brittleness is accepted,
 * because each convention below is absolute and prose can be reworded.
 *
 * The persistence fence is the highest-value test here. `.changes.md` is a
 * git-diffable data format whose bytes are hashed by `.sha256` sidecars and
 * re-parsed by `changelog-parser.ts` on English verbs. If a localized string
 * ever reached that writer, the file would parse to zero changes and show an
 * empty history **with no error** — silent data destruction.
 */

const ROOT = path.resolve(import.meta.dir, '../..')

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
   * All of it is English by contract (plan §4.9), so none of them may import
   * the message catalog directly. (The scan is direct-import only; a transitive
   * route through e.g. `card-labels` returns prose to callers rather than
   * writing it into the file, which is the line the fence protects.)
   */
  test('changelog, CSV, and export modules never import src/i18n', async () => {
    const fenced = [
      'src/changes/change-event.ts',
      'src/changes/changelog-writer.ts',
      'src/changes/changelog-parser.ts',
      'src/changes/csv.ts',
      'src/changes/change-bundle.ts',
      'src/changes/list-snapshot.ts',
      'src/list/entry-load.ts',
      'src/buylist/cart-csv.ts',
      ...[...new Glob('src/export/**/*.ts').scanSync(ROOT)].map((file) => file.replace(/\\/g, '/')),
    ]
    expect(await scan(/from\s+['"][^'"]*\bi18n\b/, { files: fenced })).toEqual([])
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
    const lineFenced = [
      'src/card/card-line-grammar.ts',
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
    expect(await scan(/from\s+['"][^'"]*\bi18n\b/, { files: lineFenced })).toEqual([])
  })

  /**
   * The persistence writer's *own* module must not reach the display renderer
   * either. `changeMessage` follows the active UI locale; one call to it from
   * `formatChangeCore` would put translated prose into a file that
   * `changelog-parser.ts` reads back on English verbs.
   */
  test('the changelog writer never reaches the display renderer', async () => {
    expect(
      await scan(/from\s+['"][^'"]*\bchange-message\b/, {
        files: [
          'src/changes/change-event.ts',
          'src/changes/changelog-writer.ts',
          'src/changes/changelog-parser.ts',
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
   * than untranslated prose, so the §7.2 `Record<Key, MessageKey>` tables do not
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
})
