#!/usr/bin/env bun
/**
 * Message-catalog validator (see `research/i18n-framework-plan-2026-08-07.md` §9).
 *
 * English is authored in TypeScript (`src/i18n/messages/en/*.ts`), so a stale
 * `t()` call site is already a `tsc` error. Everything a *translation* can get
 * wrong is invisible to the compiler, because translations ship as JSON data —
 * that is what this script checks. It runs as a `needsBuild: false` check in
 * `scripts/precommit.ts`, and therefore in `bun run test` and `bun run verify`
 * too.
 *
 * Deliberately a dev script, not a `ritual` command: it adds no CLI, MCP,
 * skills, or docs surface.
 *
 * ```sh
 * bun run scripts/check-locales.ts                 # validate
 * bun run scripts/check-locales.ts --report        # + per-locale coverage table
 * bun run scripts/check-locales.ts --allow-dead-keys    # tolerate unwired keys
 * bun run scripts/check-locales.ts --emit-template de   # write locales/de.json
 * ```
 *
 * The ten validations, and why each one has the severity it has:
 *
 * | # | Check | Severity |
 * |---|---|---|
 * | 1 | key in `en` missing from a translation | warn — a partial locale must stay shippable |
 * | 2 | key in a translation that `en` does not have | error — stale/dead weight |
 * | 3 | placeholder-set mismatch (English vs. translation, and a `$plural` branch vs. its own `other`) | error — renders `{cardName}` as literal text |
 * | 4 | plural categories ≠ `Intl.PluralRules(tag)` categories | error — Russian without `few` is wrong for 2–4 |
 * | 5 | `$select` branch-set mismatch | error |
 * | 6 | unbalanced or literal `{` / `}` | error |
 * | 7 | invalid BCP-47 tag | error |
 * | 8 | `maxLen` overrun | error — guards `SESSION_MENU_LIMIT` and toolbar chips |
 * | 9 | dead key (no `t('…')` reference in `src/`) | error — the catalog is fully wired; `--allow-dead-keys` downgrades it |
 * | 10 | namespace-boundary violation (`src/site/**` using a `cli.*` key, or a browser surface *registering* the `cli` namespace) | error |
 */

// Node's stdlib only, no `bun` import: the pure exports here (`messagePlaceholders`,
// `pseudo*` via `generate-locales.ts`) are pulled in by Playwright specs, which run
// under Node. The script itself is still only ever *executed* by Bun.
import { readdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCatalogEntryError, parseCatalogEntry } from '../src/i18n/catalog'
import { pluralRules } from '../src/i18n/format'
import { isLocaleTag, isLocaleTagError, parseLocaleTag } from '../src/i18n/locale-tag'
import { en, MESSAGE_NAMESPACES } from '../src/i18n/messages/en'
import { enMeta } from '../src/i18n/messages/en.meta'
import {
  isPluralForms,
  isSelectForms,
  type MessageCatalogShape,
  type MessageMetaShape,
  type MessageValue,
} from '../src/i18n/types'
import { displayWidth } from '../src/i18n/width'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Whether an issue fails the run or is only reported. */
export type IssueSeverity = 'error' | 'warn'

/** Which of the validations produced an issue. */
export type IssueKind =
  | 'invalid-json'
  | 'invalid-tag'
  | 'invalid-key'
  | 'missing-key'
  | 'extra-key'
  | 'value-shape'
  | 'placeholder-mismatch'
  | 'plural-category'
  | 'select-branch'
  | 'brace'
  | 'max-len'
  | 'dead-key'
  | 'namespace-boundary'

/** One validation failure. `key` is null for whole-file problems. */
export type CatalogIssue = {
  locale: string
  key: string | null
  kind: IssueKind
  severity: IssueSeverity
  message: string
}

/** How much of the English catalog a locale covers. */
export type LocaleCoverage = {
  locale: string
  translated: number
  missing: number
  total: number
  percent: number
}

/** A `src/site/**` or `src/admin/site/**` file reaching into a CLI-only namespace. */
export type NamespaceViolation = {
  file: string
  line: number
  detail: string
}

/** One translation to validate, as parsed from disk (or synthesized by a test). */
export type TranslationInput = {
  locale: string
  origin: string
  catalog: unknown
  /** Set when the file could not be parsed at all; `catalog` is then ignored. */
  parseError?: string
}

/** Everything {@link checkCatalogs} needs. Pure data — the script does the I/O. */
export type CatalogCheckInput = {
  english: MessageCatalogShape
  meta?: MessageMetaShape
  translations?: readonly TranslationInput[]
  /** Message keys referenced from source. `null` skips the dead-key scan. */
  referencedKeys?: ReadonlySet<string> | null
  namespaceViolations?: readonly NamespaceViolation[]
  /**
   * Dead keys were a `warn` while the catalog was being populated (Phases 0–6:
   * most keys had no call site yet). The script now passes `error` — the
   * migration is complete, so an unreferenced key is dead weight a translator
   * would otherwise be asked to translate.
   */
  deadKeySeverity?: IssueSeverity
}

/** The validator's verdict. */
export type CatalogReport = {
  issues: CatalogIssue[]
  coverage: LocaleCoverage[]
  ok: boolean
}

/** Parsed command-line options. */
export type CheckOptions = {
  dir: string
  report: boolean
  emitTemplate: string | null
  /** Downgrade dead keys to a warning, for a branch that adds keys ahead of call sites. */
  allowDeadKeys: boolean
}

// ---------------------------------------------------------------------------
// Shared catalog helpers (also used by scripts/generate-locales.ts)
// ---------------------------------------------------------------------------

/** `<namespace>.<area>.<name>` — explicit and greppable, never a content hash. */
export const MESSAGE_KEY_PATTERN = new RegExp(
  `^(?:${MESSAGE_NAMESPACES.join('|')})\\.[a-zA-Z0-9]+(?:\\.[a-zA-Z0-9]+)+$`,
)

/** The same shape, unanchored, for finding key references inside source text. */
const KEY_REFERENCE_PATTERN = new RegExp(
  `(?:${MESSAGE_NAMESPACES.join('|')})\\.[a-zA-Z0-9]+(?:\\.[a-zA-Z0-9]+)+`,
  'g',
)

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const

/** The same set, typed for membership testing rather than iteration. */
const PLURAL_CATEGORY_SET: ReadonlySet<string> = new Set(PLURAL_CATEGORIES)

/** Every renderable string form of a value: the string, or each plural/select branch. */
export function messageForms(value: MessageValue): string[] {
  if (typeof value === 'string') return [value]
  const forms: string[] = []
  for (const [name, form] of Object.entries(value)) {
    if (name === '$plural' || name === '$select') continue
    if (typeof form === 'string') forms.push(form)
  }
  return forms
}

/** The branch names of a plural or select table (`$plural`/`$select` excluded). */
export function messageBranches(value: MessageValue): string[] {
  if (typeof value === 'string') return []
  return Object.keys(value).filter((name) => name !== '$plural' && name !== '$select')
}

/** The `{named}` placeholders a value uses, across every branch, sorted. */
export function messagePlaceholders(value: MessageValue): string[] {
  const names = new Set<string>()
  for (const form of messageForms(value)) {
    for (const match of form.matchAll(/\{([^{}]*)\}/g)) {
      names.add((match[1] ?? '').trim())
    }
  }
  return [...names].sort()
}

/**
 * Validate brace usage in one form. Placeholders are `{name}` and nothing else:
 * literal braces are banned outright (the inventory contains none), and a
 * nested or unclosed brace would silently swallow text at render time.
 */
export function validateBraces(form: string): string | null {
  let depth = 0
  let current = ''
  for (const char of form) {
    if (char === '{') {
      if (depth > 0) return 'nested "{" — literal braces are not supported'
      depth = 1
      current = ''
      continue
    }
    if (char === '}') {
      if (depth === 0) return 'unmatched "}" — literal braces are not supported'
      depth = 0
      if (current.trim() === '') return 'empty placeholder "{}"'
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(current.trim())) {
        return `invalid placeholder name "${current.trim()}" — use camelCase letters and digits`
      }
      continue
    }
    if (depth === 1) current += char
  }
  return depth === 0 ? null : 'unclosed "{" — literal braces are not supported'
}

/**
 * CLDR plural categories for a tag, or null when the tag is not a locale.
 *
 * Goes through `src/i18n/format.ts`'s memoized factory rather than constructing
 * `Intl.PluralRules` here, so the validator's notion of a locale's categories is
 * literally the runtime's — this is the gate deciding whether a file `t()` will
 * later render is acceptable.
 */
export function pluralCategoriesFor(tag: string): string[] | null {
  const parsed = parseLocaleTag(tag)
  if (isLocaleTagError(parsed)) return null
  return [...pluralRules(parsed).resolvedOptions().pluralCategories]
}

function sortedCategories(names: readonly string[]): string[] {
  const order = new Map<string, number>(PLURAL_CATEGORIES.map((name, index) => [name, index]))
  return [...names].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const other = new Set(b)
  return a.every((value) => other.has(value))
}

/**
 * The placeholders a `$plural` branch names that its `other` form does not.
 *
 * `ParamsOf` in `src/i18n/t.ts` derives an English plural message's parameters
 * from `other` alone (it cannot union the branches without breaking `t`'s key
 * inference — see the note on `Forms` there), so a branch that introduces its
 * own placeholder would be callable without that parameter and would render the
 * raw `{token}`. Checking it here is what lets the type stay simple.
 */
function extraPluralPlaceholders(value: MessageValue): string[] {
  if (!isPluralForms(value)) return []
  const allowed = new Set(messagePlaceholders(value.other))
  const extra = new Set<string>()
  for (const [name, form] of Object.entries(value)) {
    if (name === '$plural' || name === 'other' || typeof form !== 'string') continue
    for (const placeholder of messagePlaceholders(form)) {
      if (!allowed.has(placeholder)) extra.add(placeholder)
    }
  }
  return [...extra].sort()
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

function issue(
  locale: string,
  key: string | null,
  kind: IssueKind,
  severity: IssueSeverity,
  message: string,
): CatalogIssue {
  return { locale, key, kind, severity, message }
}

/** Checks that apply to any catalog, English or translated. */
function checkValue(
  locale: string,
  key: string,
  value: MessageValue,
  maxLen: number | undefined,
  issues: CatalogIssue[],
): void {
  for (const form of messageForms(value)) {
    const braceError = validateBraces(form)
    if (braceError !== null) {
      issues.push(issue(locale, key, 'brace', 'error', braceError))
    }
    if (maxLen !== undefined && displayWidth(form) > maxLen) {
      issues.push(
        issue(
          locale,
          key,
          'max-len',
          'error',
          `"${form}" is ${displayWidth(form)} columns wide, over the ${maxLen}-column budget`,
        ),
      )
    }
  }
  if (isPluralForms(value)) {
    const categories = pluralCategoriesFor(locale)
    const supplied = messageBranches(value)
    const unrecognized = supplied.filter((name) => !PLURAL_CATEGORY_SET.has(name))
    if (unrecognized.length > 0) {
      issues.push(
        issue(
          locale,
          key,
          'plural-category',
          'error',
          `unknown plural forms: ${unrecognized.join(', ')}`,
        ),
      )
    } else if (categories !== null && !sameSet(supplied, categories)) {
      issues.push(
        issue(
          locale,
          key,
          'plural-category',
          'error',
          `$plural must supply exactly [${sortedCategories(categories).join(', ')}] for "${locale}", got [${sortedCategories(supplied).join(', ')}]`,
        ),
      )
    }
  }
}

/**
 * Run every validation. Pure: all filesystem access happens in the caller, so
 * `test/unit/i18n/catalog.test.ts` drives this with synthetic catalogs.
 */
export function checkCatalogs(input: CatalogCheckInput): CatalogReport {
  const {
    english,
    meta = {},
    translations = [],
    referencedKeys = null,
    namespaceViolations = [],
    deadKeySeverity = 'warn',
  } = input

  const issues: CatalogIssue[] = []
  const coverage: LocaleCoverage[] = []
  const englishKeys = Object.keys(english)
  const hasMeta = Object.keys(meta).length > 0

  // ── English: key scheme, braces, plural categories, length budgets ───────
  for (const key of englishKeys) {
    if (!MESSAGE_KEY_PATTERN.test(key)) {
      issues.push(
        issue(
          'en',
          key,
          'invalid-key',
          'error',
          'key must be <namespace>.<area>.<name> with a known namespace',
        ),
      )
    }
    const value = english[key]
    if (value === undefined) continue
    checkValue('en', key, value, meta[key]?.maxLen, issues)
    const extra = extraPluralPlaceholders(value)
    if (extra.length > 0) {
      issues.push(
        issue(
          'en',
          key,
          'placeholder-mismatch',
          'error',
          `$plural branch placeholders [${extra.join(', ')}] do not appear in the "other" form — "other" is what \`ParamsOf\` in src/i18n/t.ts reads, so a call site would never be asked for them`,
        ),
      )
    }
    if (hasMeta && meta[key] === undefined) {
      issues.push(
        issue('en', key, 'value-shape', 'error', 'no meta entry — every key needs a description'),
      )
    }
  }

  // ── Dead keys: an English entry no source file ever asks for ─────────────
  if (referencedKeys !== null) {
    for (const key of englishKeys) {
      if (referencedKeys.has(key)) continue
      issues.push(
        issue(
          'en',
          key,
          'dead-key',
          deadKeySeverity,
          "no t('…') / tSegments('…') reference in src/ — delete it or wire it up",
        ),
      )
    }
  }

  // ── Namespace boundaries ────────────────────────────────────────────────
  for (const violation of namespaceViolations) {
    issues.push(
      issue(
        'en',
        null,
        'namespace-boundary',
        'error',
        `${violation.file}:${violation.line} ${violation.detail}`,
      ),
    )
  }

  // ── Translations ────────────────────────────────────────────────────────
  for (const translation of translations) {
    const { locale, origin, catalog, parseError } = translation
    if (!isLocaleTag(locale)) {
      issues.push(issue(locale, null, 'invalid-tag', 'error', `${origin}: not a BCP-47 tag`))
      continue
    }
    if (parseError !== undefined) {
      issues.push(issue(locale, null, 'invalid-json', 'error', `${origin}: ${parseError}`))
      continue
    }
    if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
      issues.push(
        issue(locale, null, 'invalid-json', 'error', `${origin}: expected a JSON object of keys`),
      )
      continue
    }
    const entries = catalog as Record<string, unknown>
    let translated = 0

    for (const [key, raw] of Object.entries(entries)) {
      const englishValue = english[key]
      if (englishValue === undefined) {
        issues.push(
          issue(
            locale,
            key,
            'extra-key',
            'error',
            'not present in the English catalog — remove it',
          ),
        )
        continue
      }
      const parsed = parseCatalogEntry(raw)
      if (isCatalogEntryError(parsed)) {
        issues.push(issue(locale, key, 'value-shape', 'error', parsed.error))
        continue
      }
      const value: MessageValue = parsed
      translated += 1
      checkValue(locale, key, value, meta[key]?.maxLen, issues)

      const englishPlaceholders = messagePlaceholders(englishValue)
      const localePlaceholders = messagePlaceholders(value)
      if (!sameSet(englishPlaceholders, localePlaceholders)) {
        issues.push(
          issue(
            locale,
            key,
            'placeholder-mismatch',
            'error',
            `placeholders must match English [${englishPlaceholders.join(', ')}], got [${localePlaceholders.join(', ')}]`,
          ),
        )
      }

      if (isSelectForms(englishValue) !== isSelectForms(value)) {
        issues.push(
          issue(
            locale,
            key,
            'select-branch',
            'error',
            isSelectForms(englishValue)
              ? 'English is a $select table; the translation must be one too'
              : 'English is not a $select table; the translation must not be one',
          ),
        )
      } else if (isSelectForms(englishValue) && isSelectForms(value)) {
        if (englishValue.$select !== value.$select) {
          issues.push(
            issue(
              locale,
              key,
              'select-branch',
              'error',
              `$select must switch on "${englishValue.$select}", got "${value.$select}"`,
            ),
          )
        }
        const englishBranches = messageBranches(englishValue)
        const localeBranches = messageBranches(value)
        if (!sameSet(englishBranches, localeBranches)) {
          issues.push(
            issue(
              locale,
              key,
              'select-branch',
              'error',
              `$select branches must match English [${englishBranches.join(', ')}], got [${localeBranches.join(', ')}]`,
            ),
          )
        }
      }

      if (isPluralForms(englishValue) && !isPluralForms(value)) {
        issues.push(
          issue(locale, key, 'plural-category', 'error', 'English is a $plural table; this is not'),
        )
      }
    }

    for (const key of englishKeys) {
      if (key in entries) continue
      issues.push(issue(locale, key, 'missing-key', 'warn', 'untranslated — falls back to English'))
    }

    const total = englishKeys.length
    coverage.push({
      locale,
      translated,
      missing: total - translated,
      total,
      percent: total === 0 ? 100 : Math.round((translated / total) * 100),
    })
  }

  return { issues, coverage, ok: !issues.some((entry) => entry.severity === 'error') }
}

// ---------------------------------------------------------------------------
// Filesystem inputs
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Load every `locales/<tag>.json` (skipping `*.meta.json` template sidecars). */
export async function loadTranslations(dir: string): Promise<TranslationInput[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const files = names
    .filter((name) => name.endsWith('.json') && !name.endsWith('.meta.json'))
    .sort()
  const translations: TranslationInput[] = []
  for (const name of files) {
    const origin = path.join(dir, name)
    const locale = name.slice(0, -'.json'.length)
    const text = await fs.readFile(origin, 'utf-8')
    try {
      translations.push({ locale, origin, catalog: JSON.parse(text) as unknown })
    } catch (error) {
      translations.push({
        locale,
        origin,
        catalog: null,
        parseError: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return translations
}

function sourceFiles(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(path.join(root, 'src'), { recursive: true }).map(String)
  } catch {
    entries = []
  }
  const files = entries
    .map((entry) => `src/${entry.replace(/\\/g, '/')}`)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !file.startsWith('src/generated/') && !file.startsWith('src/i18n/messages/'))
  files.push('index.ts')
  return files.sort()
}

/**
 * Every message key any source file mentions. Deliberately generous: a key
 * named inside a `Record<Key, MessageKey>` label table is a real reference,
 * because the table is resolved through `t()` at render time.
 *
 * The generosity extends to comments — raw file text is scanned, so a key named
 * only in a doc comment counts as live. That was reviewed when dead keys became
 * blocking (plan §12, Phase 7) and kept deliberately: the two failure modes are
 * not symmetric. A false *negative* leaves one unused key in the catalog, which
 * a reviewer can spot. A false *positive* fails `bun run test` for everyone over
 * a key that is genuinely wired, and stripping comments correctly (without
 * mangling `//` inside strings, regexes and URLs) needs a real parser. Anything
 * more precise than this belongs in `tsc`, which already catches the opposite
 * direction — a call site naming a key the catalog does not have.
 */
export async function scanMessageReferences(root: string = ROOT): Promise<Set<string>> {
  const keys = new Set<string>()
  for (const file of sourceFiles(root)) {
    let content: string
    try {
      content = await fs.readFile(path.join(root, file), 'utf-8')
    } catch {
      continue
    }
    for (const match of content.matchAll(KEY_REFERENCE_PATTERN)) {
      if (MESSAGE_KEY_PATTERN.test(match[0])) keys.add(match[0])
    }
  }
  return keys
}

/** Directories whose bundles must never carry the CLI's message inventory. */
const BROWSER_ONLY_DIRS = ['src/site/', 'src/admin/site/']

/** Namespaces those directories may not reach into. */
const CLI_ONLY_NAMESPACES = ['cli', 'help']

/**
 * Find `src/site/**` / `src/admin/site/**` files that use a `cli.*` or `help.*`
 * key, or import those catalog fragments directly. The namespace boundary is
 * what keeps ~1,400 CLI messages out of the SPA bundles.
 *
 * The companion check is {@link scanRegistrationBoundaries}: a key a browser
 * file never names cannot be *rendered* there, and a namespace no browser
 * surface registers is not *shipped* there.
 */
export async function scanNamespaceBoundaries(root: string = ROOT): Promise<NamespaceViolation[]> {
  const violations: NamespaceViolation[] = []
  const files = sourceFiles(root).filter((file) =>
    BROWSER_ONLY_DIRS.some((dir) => file.startsWith(dir)),
  )
  for (const file of files) {
    let content: string
    try {
      content = await fs.readFile(path.join(root, file), 'utf-8')
    } catch {
      continue
    }
    // A browser file may name `MessageKey` — the type is erased — but importing
    // the barrel's *value*, or the CLI's registration module, inlines all seven
    // namespaces regardless of which keys the file goes on to use.
    for (const entry of moduleImports(content)) {
      if (entry.typeOnly) continue
      const resolved = resolveSpecifier(file, entry.specifier)
      if (resolved === CATALOG_PATH) {
        violations.push({ file, line: entry.line, detail: 'imports the full English catalog' })
      } else if (resolved === 'src/i18n/register/cli') {
        violations.push({
          file,
          line: entry.line,
          detail: 'imports the CLI registration module, which registers every namespace',
        })
      }
    }
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      for (const namespace of CLI_ONLY_NAMESPACES) {
        if (new RegExp(`messages/en/${namespace}(?:['"]|\\.meta)`).test(line)) {
          violations.push({
            file,
            line: index + 1,
            detail: `imports the "${namespace}" catalog fragment`,
          })
          continue
        }
        for (const match of line.matchAll(KEY_REFERENCE_PATTERN)) {
          if (!MESSAGE_KEY_PATTERN.test(match[0])) continue
          if (!match[0].startsWith(`${namespace}.`)) continue
          violations.push({
            file,
            line: index + 1,
            detail: `uses the "${namespace}" namespace key ${match[0]}`,
          })
        }
      }
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Registration boundaries
// ---------------------------------------------------------------------------

/**
 * The English catalog, root-relative and extensionless — which is both the
 * barrel module (`…/en.ts`, importing it registers every namespace) and the
 * directory the per-namespace fragments live in (`…/en/site-pages.ts`).
 */
const CATALOG_PATH = 'src/i18n/messages/en'

/** A per-surface registration module and the namespaces its bundle may carry. */
export type RegistrationSurface = {
  /** The module, relative to the repo root. */
  module: string
  /** The namespaces this surface is allowed to register. */
  allowed: readonly string[]
}

/**
 * The browser surfaces' registration modules (plan §4.2).
 *
 * Registration is what puts message *text* in a bundle: the runtime holds no
 * catalog of its own, so a namespace reaches `src/site/app.compiled.js` only by
 * being imported from one of these modules. `scanNamespaceBoundaries` polices
 * the keys a browser file may *name*; this polices the text its bundle carries,
 * which is the half that costs bytes.
 *
 * The CLI has no entry here on purpose — it is the surface that registers all
 * seven, and it ships as a binary rather than a bundle.
 */
export const REGISTRATION_SURFACES: readonly RegistrationSurface[] = [
  { module: 'src/i18n/register/site.ts', allowed: ['site', 'ui', 'domain', 'errors'] },
  { module: 'src/i18n/register/admin.ts', allowed: ['admin', 'site', 'ui', 'domain', 'errors'] },
]

/** One `import … from '…'` statement, with the line it starts on. */
type ModuleImport = {
  specifier: string
  typeOnly: boolean
  line: number
}

const IMPORT_PATTERN = /import\s+(type\s+)?[^;'"]*?from\s+['"]([^'"]+)['"]/g

/** Every value import in a module. Type-only imports are erased, so they are skipped. */
function moduleImports(content: string): ModuleImport[] {
  const imports: ModuleImport[] = []
  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const specifier = match[2] ?? ''
    imports.push({
      specifier,
      typeOnly: match[1] !== undefined,
      line: content.slice(0, match.index).split('\n').length,
    })
  }
  return imports
}

/** Resolve a relative specifier against the importing file, as a root-relative path. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
}

/**
 * The namespace a catalog fragment carries: `cli-cards` → `cli`, `site-pages`
 * → `site`, `errors` → `errors`. Null when the module is not a fragment.
 */
function fragmentNamespace(resolved: string): string | null {
  if (path.posix.dirname(resolved) !== CATALOG_PATH) return null
  return (path.posix.basename(resolved).split('-')[0] ?? '').replace(/\.meta$/, '')
}

/**
 * Walk a registration module's value imports and report every namespace it
 * registers that its surface is not allowed to.
 *
 * Transitive by design: `register/admin.ts` reuses `register/site.ts` rather
 * than re-listing eight fragments, so following the edge is what keeps the
 * admin's allowance honest.
 */
async function scanSurface(
  root: string,
  surface: RegistrationSurface,
  fromFile: string,
  seen: Set<string>,
  violations: NamespaceViolation[],
): Promise<void> {
  if (seen.has(fromFile)) return
  seen.add(fromFile)
  let content: string
  try {
    content = await fs.readFile(path.join(root, fromFile), 'utf-8')
  } catch {
    violations.push({
      file: fromFile,
      line: 1,
      detail: `${surface.module} registration module is missing`,
    })
    return
  }
  const allowed = new Set(surface.allowed)
  for (const entry of moduleImports(content)) {
    if (entry.typeOnly) continue
    const resolved = resolveSpecifier(fromFile, entry.specifier)
    if (resolved === null) continue
    if (resolved === CATALOG_PATH) {
      violations.push({
        file: fromFile,
        line: entry.line,
        detail: `imports the full English catalog, registering every namespace for the "${surface.module}" surface`,
      })
      continue
    }
    if (resolved.startsWith('src/i18n/register/')) {
      await scanSurface(root, surface, `${resolved}.ts`, seen, violations)
      continue
    }
    const namespace = fragmentNamespace(resolved)
    if (namespace === null) continue
    if (!allowed.has(namespace)) {
      violations.push({
        file: fromFile,
        line: entry.line,
        detail: `registers the "${namespace}" namespace, which the "${surface.module}" surface may not carry`,
      })
    }
  }
}

/**
 * Check every browser surface's registration module against its allowance.
 * See {@link REGISTRATION_SURFACES}.
 */
export async function scanRegistrationBoundaries(
  root: string = ROOT,
): Promise<NamespaceViolation[]> {
  const violations: NamespaceViolation[] = []
  for (const surface of REGISTRATION_SURFACES) {
    await scanSurface(root, surface, surface.module, new Set<string>(), violations)
  }
  return violations
}

/**
 * Write a ready-to-fill translation file plus a sibling `<tag>.meta.json`
 * carrying each key's description and length budget — JSON has no comments, so
 * the context a translator needs travels beside the strings.
 */
export async function emitTemplate(tag: string, dir: string): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true })
  const catalogPath = path.join(dir, `${tag}.json`)
  const metaPath = path.join(dir, `${tag}.meta.json`)
  await fs.writeFile(catalogPath, `${JSON.stringify(en, null, 2)}\n`)
  await fs.writeFile(metaPath, `${JSON.stringify(enMeta, null, 2)}\n`)
  return [catalogPath, metaPath]
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Parse this script's own arguments. Unknown flags are a usage error. */
export function parseCheckOptions(argv: readonly string[]): CheckOptions | string {
  const options: CheckOptions = {
    dir: path.join(ROOT, 'locales'),
    report: false,
    emitTemplate: null,
    allowDeadKeys: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? ''
    if (arg === '--report') options.report = true
    else if (arg === '--allow-dead-keys') options.allowDeadKeys = true
    else if (arg === '--dir') {
      const value = argv[++index]
      if (value === undefined) return '--dir needs a path'
      options.dir = value
    } else if (arg === '--emit-template') {
      const value = argv[++index]
      if (value === undefined) return '--emit-template needs a BCP-47 tag'
      if (!isLocaleTag(value)) return `--emit-template: invalid locale tag "${value}"`
      options.emitTemplate = value
    } else {
      return `unknown option: ${arg}`
    }
  }
  return options
}

function formatIssue(entry: CatalogIssue): string {
  const mark = entry.severity === 'error' ? '✗' : '!'
  const key = entry.key === null ? '' : ` ${entry.key}`
  return `${mark} [${entry.locale}]${key} (${entry.kind}): ${entry.message}`
}

function printCoverage(coverage: readonly LocaleCoverage[], total: number): void {
  console.log('\nCoverage')
  console.log(`  en${' '.repeat(8)}${String(total).padStart(5)} keys  100%  (source language)`)
  for (const row of coverage) {
    const name = row.locale.padEnd(10)
    console.log(
      `  ${name}${String(row.translated).padStart(5)} keys  ${String(row.percent).padStart(3)}%  (${row.missing} missing)`,
    )
  }
}

async function main(): Promise<void> {
  const parsed = parseCheckOptions(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(`check-locales: ${parsed}`)
    process.exitCode = 2
    return
  }

  if (parsed.emitTemplate !== null) {
    const written = await emitTemplate(parsed.emitTemplate, parsed.dir)
    for (const file of written) console.log(`Wrote ${file}`)
    return
  }

  const [translations, referencedKeys, keyViolations, registrationViolations] = await Promise.all([
    loadTranslations(parsed.dir),
    scanMessageReferences(ROOT),
    scanNamespaceBoundaries(ROOT),
    scanRegistrationBoundaries(ROOT),
  ])

  const report = checkCatalogs({
    english: en,
    meta: enMeta,
    translations,
    referencedKeys,
    namespaceViolations: [...keyViolations, ...registrationViolations],
    deadKeySeverity: parsed.allowDeadKeys ? 'warn' : 'error',
  })

  const errors = report.issues.filter((entry) => entry.severity === 'error')
  const warnings = report.issues.filter((entry) => entry.severity !== 'error')

  // Untranslated keys are the *expected* state for a partial locale, which is
  // shippable by design, so they get one summary line rather than one line per
  // key — the coverage table is where they belong. Dead keys are printed in
  // full: they are an error by default now, and each one names a key to delete.
  const deadKeys = warnings.filter((entry) => entry.kind === 'dead-key')
  const notableWarnings = warnings.filter(
    (entry) => entry.kind !== 'missing-key' && entry.kind !== 'dead-key',
  )
  for (const entry of [...errors, ...notableWarnings]) console.log(formatIssue(entry))
  if (deadKeys.length > 0) {
    if (parsed.report) {
      for (const entry of deadKeys) console.log(formatIssue(entry))
    } else {
      console.log(
        `! ${deadKeys.length} English key(s) have no t('…') reference yet — run with --report to list them`,
      )
    }
  }

  if (parsed.report) printCoverage(report.coverage, Object.keys(en).length)

  const summary = `${Object.keys(en).length} English keys, ${translations.length} translation file(s): ${errors.length} error(s), ${warnings.length} warning(s)`
  console.log(report.ok ? `check-locales: ${summary}` : `check-locales failed — ${summary}`)
  if (!report.ok) process.exitCode = 1
}

if (import.meta.main) await main()
