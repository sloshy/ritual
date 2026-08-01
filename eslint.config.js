import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import noAnonymousObjectTypes from './eslint-rules/no-anonymous-object-types.js'

// Project-local plugin housing custom rules that enforce AGENTS.md guidelines.
const ritualPlugin = {
  rules: {
    'no-anonymous-object-types': noAnonymousObjectTypes,
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
    },
  },
]
