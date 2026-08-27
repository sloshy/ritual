import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import noAnonymousObjectTypes from './eslint-rules/no-anonymous-object-types.js'
import noBareIntlLocale from './eslint-rules/no-bare-intl-locale.js'
import noInlinePlural from './eslint-rules/no-inline-plural.js'
import noUntranslatedLiteral from './eslint-rules/no-untranslated-literal.js'
import noUpwardImport from './eslint-rules/no-upward-import.js'

// Project-local plugin housing custom rules that enforce AGENTS.md guidelines.
const ritualPlugin = {
  rules: {
    'no-anonymous-object-types': noAnonymousObjectTypes,
    'no-upward-import': noUpwardImport,
    'no-bare-intl-locale': noBareIntlLocale,
    'no-inline-plural': noInlinePlural,
    'no-untranslated-literal': noUntranslatedLiteral,
  },
}

// Focused ruleset: rules picked to catch the same kinds of issues that the
// most recent code review flagged, plus a small set of clear-bug rules. The
// broader `recommendedTypeChecked` preset is deliberately NOT extended — it
// surfaces hundreds of stylistic violations across this codebase that would
// need a separate cleanup pass.
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'out/**',
      'coverage/**',
      'docs-site/**',
      'research/**',
      '.admin-dist/**',
      'src/generated/**',
      'src/site/app.compiled.js',
      'src/site/styles.compiled.css',
      'src/admin/site/app.compiled.js',
      'src/admin/site/styles.compiled.css',
      'app.svg',
      'ritual',
      '**/*.d.ts',
      // Several unit tests create scratch directories under `test/` and delete
      // them in `afterEach`. `precommit` runs lint and the unit suite
      // concurrently, so a directory can vanish between ESLint enumerating it
      // and reading it — an ENOENT that aborts the whole lint run. Skipping the
      // walk is the fix; new tests should use `os.tmpdir()` instead.
      'test/.test-*/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        Bun: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      ritual: ritualPlugin,
    },
    rules: {
      // TypeScript already resolves type names — `no-undef` only knows about
      // values and produces false positives for built-in TS types like
      // `BufferEncoding`, `NodeJS`, etc.
      'no-undef': 'off',

      // ── Targeted: catches review issue #3 (parseInt without radix) ────
      radix: 'error',

      // ── Targeted: catches review issue #1 (missing return types on the
      // module boundary, e.g. exported functions). Narrower than
      // `explicit-function-return-type`, which would flag every inline arrow.
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // ── Targeted: enforces AGENTS.md #2 (no anonymous object types
      // outside named declarations). Catches the kind of inline `{ … }`
      // shape that the recent review surfaced in `watchedDirs`.
      'ritual/no-anonymous-object-types': 'error',

      // ── i18n framework (research/i18n-framework-plan-2026-08-07.md §9).
      // All three landed at `warn` in Phase 0 and flipped to `error` per
      // directory as each surface converted, which is what made a ~2,000-message
      // migration reviewable instead of a big bang. Each rule carries its own
      // scope/carve-out defaults — see the rule files.
      //
      // The ratchet is now fully closed: `no-inline-plural` and
      // `no-bare-intl-locale` flipped at the end of Phase 3, and
      // `no-untranslated-literal` at the end of Phase 7, once Phases 4–6 had
      // routed the site, admin and CLI strings through the catalog. The
      // remaining English-by-contract surfaces (plan §4.9, §11) are excluded by
      // path in `eslint-rules/no-untranslated-literal.js` rather than downgraded
      // here, so a new violation in a converted directory fails the build.
      'ritual/no-untranslated-literal': 'error',
      'ritual/no-bare-intl-locale': 'error',
      'ritual/no-inline-plural': 'error',

      // ── Directory layering (research/simplification-zones-2026-08-26.md, Zone 2).
      // Bottom-up: a file may import its own layer or anything below, never
      // above. Directories missing from the table are unconstrained. The
      // `allow` list is the known debt at the time the rule landed; the zone
      // that closes a debt deletes its entry — never widen one.
      'ritual/no-upward-import': [
        'error',
        {
          layers: [
            // Zone 9 sub-layered `domain` into three. Fragments pin a single
            // file whose imports differ from its directory's layer
            // (longest-fragment-wins, see eslint-rules/no-upward-import.js).
            {
              name: 'core',
              dirs: [
                'src/i18n',
                'src/util',
                'src/config',
                'src/card',
                'src/list',
                'src/changes',
                'src/theme',
                'src/export',
                'src/buylist',
                'src/sync',
                'src/scryfall/types',
                'src/scryfall/card-utils',
                'src/pricing/price-currency',
                'src/pricing/price-source',
                'src/pricing/price-data',
                'src/cache/constants',
                'src/importers/text-file',
                'src/importers/archidekt-types',
                'src/importers/archidekt-collection',
                'src/importers/csv',
              ],
            },
            {
              name: 'providers',
              dirs: [
                'src/scryfall',
                'src/cache',
                'src/cardkingdom',
                'src/pricing',
                'src/auth',
                // Imports `cache/bulk-provenance`; every importer is a command.
                'src/card/printing-pin',
                // Type-only imports from `buylist`, `cardkingdom`, `pricing`, `list`.
                'src/site-build/types',
              ],
            },
            {
              name: 'engines',
              dirs: [
                'src/clients',
                'src/importers',
                'src/deck-sync',
                'src/collection-sync',
                'src/api',
                'src/site-build',
              ],
            },
            { name: 'ui', dirs: ['src/ui'] },
            { name: 'list-view', dirs: ['src/list-view'] },
            { name: 'editor', dirs: ['src/editor'] },
            { name: 'site', dirs: ['src/site'] },
            { name: 'admin', dirs: ['src/admin'] },
            {
              name: 'entry',
              dirs: [
                'src/cli',
                'src/commands',
                'src/mcp',
                'src/serve',
                'src/skills',
                'src/cache-server',
                'src/cache-feed',
              ],
            },
          ],
          allow: [
            // Zone 10/11 — cache/ reaches into the feed server.
            { from: 'src/cache/refresh-source', to: 'src/cache-feed/fetch' },
            // Zone 10 — the client-neutral card routes borrow admin's HTTP helpers.
            { from: 'src/api', to: 'src/admin/api/save-helpers' },
          ],
        },
      ],

      // ── Targeted: catches review issue #4 (commander `.action(cb)` lands
      // `options` as `any` because of commander's `(...args: any[])` signature).
      // `no-unsafe-argument` flags passing that `any` into typed APIs.
      '@typescript-eslint/no-unsafe-argument': 'error',

      // ── Clear-bug rules (low false-positive, real bug classes) ─────────
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',

      // ── Style cleanup (cheap to fix, prevents bit-rot) ─────────────────
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-unused-vars': 'off', // ts-eslint's variant supersedes the core rule
      // The core rule reads a TypeScript overload set as a redeclaration; the
      // ts-eslint variant understands overload signatures.
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      'prefer-const': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'error',
      'no-useless-assignment': 'error',
      // `no-unassigned-vars` produces false positives for SolidJS refs
      // (`let foo!: HTMLDivElement; ref={foo}` — Solid populates the var via
      // the JSX `ref` prop). The rule doesn't see that as an assignment.
      'no-unassigned-vars': 'off',
      'no-control-regex': 'error',
    },
  },
  {
    files: ['test/**/*.{ts,tsx}'],
    rules: {
      // Test files don't need full module-boundary typing.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Tests routinely use ad-hoc inline shapes for mock data and response
      // assertions; requiring a named type for every one would be high noise.
      'ritual/no-anonymous-object-types': 'off',
      // Tests assert on English by design (the suite pins `locale=en`), and
      // they construct plural fixtures deliberately.
      'ritual/no-untranslated-literal': 'off',
      'ritual/no-inline-plural': 'off',
      // `ritual/no-bare-intl-locale` deliberately stays ON here. A bare
      // `localeCompare` / `toLocaleString` in a test follows the *host* locale,
      // which is precisely the cross-machine flakiness `LOCALE_ENV` and
      // Playwright's `locale: 'en-US'` exist to prevent — the rule catches the
      // one hole those two cannot cover. A test that means to exercise the bare
      // form uses an `eslint-disable-next-line` at that line.
    },
  },
]
