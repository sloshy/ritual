#!/usr/bin/env bun
/**
 * Locale codegen (see `research/i18n-framework-plan-2026-08-07.md` §8.6, §9).
 *
 * Two jobs, both of which have to happen before `tsc` and before the binary is
 * compiled:
 *
 * 1. **Bake the shipped dictionaries into `src/generated/locales.ts`** — a
 *    plain TS data module, following the `src/generated/dep-licenses.ts`
 *    precedent, so the compiled binary carries them with no filesystem read
 *    and no dynamic `import()` (both of which work under `bun run index.ts`
 *    and fail in the shipped executable). `RITUAL_BUNDLED_LOCALES` selects the
 *    set — default `en`, which bakes *nothing* extra, because English is
 *    inline in `src/i18n/messages/en.ts`. `all` bakes every locale on disk.
 *
 * 2. **Generate the `en-XA` pseudo-locale from English** — accent-substituted,
 *    padded, bracketed, with `{placeholders}` and `$plural`/`$select`
 *    structure preserved verbatim. Zero translator time, and it catches the
 *    three things that actually matter before any human translates: strings
 *    that never got routed through `t()` (they stay plain ASCII and
 *    unbracketed — visually obvious and mechanically greppable), layout
 *    overflow under realistic length inflation, and English-fallback gaps.
 *    `locales/en-XA.json` is gitignored: it is derived, never edited.
 *
 * ```sh
 * bun run scripts/generate-locales.ts                    # bake `en` (default)
 * RITUAL_BUNDLED_LOCALES=all bun run scripts/generate-locales.ts
 * bun run scripts/generate-locales.ts --emit-types       # §3 bailout clause
 * ```
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { coerceCatalog } from '../src/i18n/catalog'
import { isLocaleTagError, localeTag, parseLocaleTag } from '../src/i18n/locale-tag'
import { en } from '../src/i18n/messages/en'
import { enMeta } from '../src/i18n/messages/en.meta'
import type { LocaleCatalog, MessageCatalogShape, MessageMetaShape } from '../src/i18n/types'
import { displayWidth } from '../src/i18n/width'
import { checkCatalogs, loadTranslations, messagePlaceholders } from './check-locales'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed command-line options. */
export type GenerateOptions = {
  /** Locale tags to bake into `src/generated/locales.ts`. */
  bundled: string[]
  /** Bake every locale found on disk, ignoring {@link GenerateOptions.bundled}. */
  bundleAll: boolean
  /** Emit `src/generated/messages.ts` instead of catalogs (the §3 bailout). */
  emitTypes: boolean
  localesDir: string
  generatedDir: string
}

/** One locale's baked dictionary. */
export type BakedLocale = {
  tag: string
  catalog: LocaleCatalog
}

// ---------------------------------------------------------------------------
// Pseudo-locale
// ---------------------------------------------------------------------------

/** The tag of the generated pseudo-locale. Not a real language; `en` plural rules. */
export const PSEUDO_LOCALE = localeTag('en-XA')

/** How much longer a pseudo-localized string is than its English source. */
const PSEUDO_PADDING_RATIO = 0.4

/** The character appended to reach the padded length. */
const PSEUDO_PAD_CHAR = '~'

/**
 * Accent substitutions. Every replacement is a single code point that renders
 * in common terminal fonts and is unmistakably *not* English, so an untouched
 * string stands out in a screenshot.
 */
const ACCENTS: Record<string, string> = {
  a: 'ȧ',
  b: 'ƀ',
  c: 'ƈ',
  d: 'ḋ',
  e: 'ḗ',
  f: 'ƒ',
  g: 'ġ',
  h: 'ħ',
  i: 'ī',
  j: 'ĵ',
  k: 'ķ',
  l: 'ŀ',
  m: 'ḿ',
  n: 'ƞ',
  o: 'ǿ',
  p: 'ƥ',
  q: 'ɋ',
  r: 'ř',
  s: 'ş',
  t: 'ŧ',
  u: 'ŭ',
  v: 'ṽ',
  w: 'ẇ',
  x: 'ẋ',
  y: 'ẏ',
  z: 'ż',
  A: 'Ȧ',
  B: 'Ɓ',
  C: 'Ƈ',
  D: 'Ḋ',
  E: 'Ḗ',
  F: 'Ƒ',
  G: 'Ġ',
  H: 'Ħ',
  I: 'Ī',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ŀ',
  M: 'Ḿ',
  N: 'Ƞ',
  O: 'Ǿ',
  P: 'Ƥ',
  Q: 'Ɋ',
  R: 'Ř',
  S: 'Ş',
  T: 'Ŧ',
  U: 'Ŭ',
  V: 'Ṽ',
  W: 'Ẇ',
  X: 'Ẋ',
  Y: 'Ẏ',
  Z: 'Ż',
}

function accent(text: string): string {
  let out = ''
  for (const char of text) out += ACCENTS[char] ?? char
  return out
}

/**
 * Pseudo-localize one message form.
 *
 * `{placeholders}` pass through untouched — accenting them would break
 * interpolation and hide exactly the bug the pseudo-locale exists to surface.
 * The result is bracketed so truncation is visible: a string missing its
 * closing `]` did not fit.
 *
 * When the key carries a `maxLen` budget the padding — and, in the extreme, the
 * brackets — are clamped to it, so the generated catalog is itself valid input
 * for `check-locales.ts` while still exercising the widest text the budget
 * permits. Truncating the text instead is not an option: it would cut
 * placeholders in half.
 */
export function pseudoForm(form: string, maxLen?: number): string {
  const parts = form.split(/(\{[^{}]*\})/)
  const body = parts.map((part) => (part.startsWith('{') ? part : accent(part))).join('')
  const target = Math.ceil(displayWidth(form) * PSEUDO_PADDING_RATIO)
  if (maxLen === undefined) return `[${body}${PSEUDO_PAD_CHAR.repeat(target)}]`
  const room = maxLen - displayWidth(body) - 2
  // Not even the brackets fit: an English form already at its budget. Keep the
  // accents (still visibly non-English) and drop the decoration.
  if (room < 0) return body
  return `[${body}${PSEUDO_PAD_CHAR.repeat(Math.min(target, room))}]`
}

/**
 * Build the full pseudo-locale catalog from English. Structure — `$plural`,
 * `$select`, and every branch name — is preserved verbatim; only the rendered
 * text changes.
 */
export function pseudoLocalize(
  english: MessageCatalogShape,
  meta: MessageMetaShape,
): LocaleCatalog {
  const catalog: LocaleCatalog = {}
  for (const [key, value] of Object.entries(english)) {
    const maxLen = meta[key]?.maxLen
    if (typeof value === 'string') {
      catalog[key] = pseudoForm(value, maxLen)
      continue
    }
    const table: Record<string, string> = {}
    for (const [name, form] of Object.entries(value)) {
      if (name === '$plural' || name === '$select') {
        table[name] = form
        continue
      }
      if (typeof form === 'string') table[name] = pseudoForm(form, maxLen)
    }
    catalog[key] = table as LocaleCatalog[string]
  }
  return catalog
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

const GENERATED_HEADER = '// AUTO-GENERATED by scripts/generate-locales.ts — do not edit'

/** Render `src/generated/locales.ts` from the selected dictionaries. */
export function renderLocalesModule(baked: readonly BakedLocale[]): string {
  const tags = baked.map((entry) => entry.tag)
  const body: Record<string, LocaleCatalog> = {}
  for (const entry of baked) body[entry.tag] = entry.catalog
  return (
    [
      GENERATED_HEADER,
      '',
      "import type { LocaleCatalog, LocaleTag } from '../i18n/types'",
      '',
      '/** One dictionary baked into this build. */',
      'export type BakedDictionary = {',
      '  tag: LocaleTag',
      '  catalog: LocaleCatalog',
      '}',
      '',
      `const bakedTags: readonly string[] = ${JSON.stringify(tags)}`,
      '',
      `const bakedCatalogs: Readonly<Record<string, LocaleCatalog>> = ${JSON.stringify(body, null, 2)}`,
      '',
      '/**',
      ' * Dictionaries baked into this build, selected by RITUAL_BUNDLED_LOCALES.',
      ' *',
      ' * English is **not** here — it is inline in `src/i18n/messages/en.ts`, so the',
      ' * default path is never a lookup away. Use {@link renderableLocales} when you',
      ' * want the set a *reader* can be shown, which does include English.',
      ' *',
      ' * The tags are asserted rather than re-parsed: `scripts/generate-locales.ts`',
      ' * ran each one through `parseLocaleTag` and each catalog through the shared',
      ' * shape parser before writing this file, so validating again at import time',
      ' * would only cost startup.',
      ' */',
      'export const bakedDictionaries: readonly BakedDictionary[] = bakedTags.map((tag) => ({',
      '  tag: tag as LocaleTag,',
      '  catalog: bakedCatalogs[tag] as LocaleCatalog,',
      '}))',
      '',
      '/**',
      ' * Every locale this build can render, English first — the baked set plus the',
      ' * inline English catalog. Read-only: it is frozen build data, and',
      ' * `availableLocales()` hands it straight to the language switcher.',
      ' */',
      "export const renderableLocales: readonly LocaleTag[] = ['en', ...bakedTags].map(",
      '  (tag) => tag as LocaleTag,',
      ')',
    ].join('\n') + '\n'
  )
}

/**
 * Render `src/generated/messages.ts` — the §3 bailout clause. If literal-type
 * placeholder extraction ever costs too much `tsc` time, `t()` switches to
 * reading this generated table instead of inferring from the `as const`
 * catalog. Call sites do not change.
 */
export function renderMessageTypesModule(english: MessageCatalogShape): string {
  const lines = [
    GENERATED_HEADER,
    '',
    '/**',
    ' * Per-key parameter names, extracted from the English catalog. The bailout',
    " * path for `src/i18n/t.ts` (see the plan's §3 decision rule): a plain",
    ' * mapped type costs `tsc` nothing, where template-literal extraction over a',
    ' * few thousand literals is measurable.',
    ' */',
    'export type GeneratedMessageParams = {',
  ]
  for (const [key, value] of Object.entries(english)) {
    const names = [...messagePlaceholders(value)]
    if (typeof value !== 'string') {
      const selector = '$plural' in value ? value.$plural : value.$select
      if (typeof selector === 'string' && !names.includes(selector)) names.push(selector)
    }
    const params =
      names.length === 0
        ? 'Record<never, string | number>'
        : `Record<${names
            .sort()
            .map((name) => `'${name}'`)
            .join(' | ')}, string | number>`
    lines.push(`  ${JSON.stringify(key)}: ${params}`)
  }
  lines.push('}', '')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Parse `RITUAL_BUNDLED_LOCALES` plus this script's flags. */
export function parseGenerateOptions(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): GenerateOptions | string {
  const raw = (env.RITUAL_BUNDLED_LOCALES ?? 'en').trim()
  const requested = raw
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
  const options: GenerateOptions = {
    // English is inline, so it never needs baking; keep it out of the list.
    bundled: requested.filter((tag) => tag !== 'en' && tag !== 'all'),
    bundleAll: requested.includes('all'),
    emitTypes: false,
    localesDir: path.join(ROOT, 'locales'),
    generatedDir: path.join(ROOT, 'src', 'generated'),
  }
  for (const arg of argv) {
    if (arg === '--emit-types') options.emitTypes = true
    else return `unknown option: ${arg}`
  }
  return options
}

async function main(): Promise<void> {
  const parsed = parseGenerateOptions(process.argv.slice(2), process.env)
  if (typeof parsed === 'string') {
    console.error(`generate-locales: ${parsed}`)
    process.exitCode = 2
    return
  }

  await fs.mkdir(parsed.generatedDir, { recursive: true })

  if (parsed.emitTypes) {
    const typesPath = path.join(parsed.generatedDir, 'messages.ts')
    await fs.writeFile(typesPath, renderMessageTypesModule(en))
    console.log(`Generated ${typesPath} (${Object.keys(en).length} keys)`)
    return
  }

  // The pseudo-locale is regenerated on every build so it can never drift from
  // the English catalog it is derived from.
  await fs.mkdir(parsed.localesDir, { recursive: true })
  const pseudo = pseudoLocalize(en, enMeta)
  const pseudoPath = path.join(parsed.localesDir, `${PSEUDO_LOCALE}.json`)
  // Write-then-rename: `precommit` runs `check-locales` concurrently with the
  // build, and a half-written catalog would read as invalid JSON.
  const pseudoTemp = `${pseudoPath}.tmp`
  await fs.writeFile(pseudoTemp, `${JSON.stringify(pseudo, null, 2)}\n`)
  await fs.rename(pseudoTemp, pseudoPath)

  const available = await loadTranslations(parsed.localesDir)
  const wanted = parsed.bundleAll
    ? available.map((entry) => entry.locale)
    : parsed.bundled.filter((tag) => available.some((entry) => entry.locale === tag))
  const missing = parsed.bundleAll
    ? []
    : parsed.bundled.filter((tag) => !available.some((entry) => entry.locale === tag))

  const baked: BakedLocale[] = []
  const rejected: string[] = []
  for (const tag of wanted) {
    const found = available.find((entry) => entry.locale === tag)
    if (found === undefined || found.parseError !== undefined) continue
    // `TranslationInput.catalog` is `unknown` because a `locales/*.json` file may
    // be any JSON at all. Baking it behind a bare `as LocaleCatalog` would let a
    // catalog of numbers or nested objects reach `t()` inside a statically-typed
    // module — so it goes through the same gate `bun run scripts/check-locales.ts`
    // applies, and a locale with error-severity issues is not baked at all.
    const report = checkCatalogs({ english: en, meta: enMeta, translations: [found] })
    const errors = report.issues.filter((entry) => entry.severity === 'error')
    const parsedTag = parseLocaleTag(tag)
    if (errors.length > 0 || isLocaleTagError(parsedTag)) {
      rejected.push(tag)
      if (isLocaleTagError(parsedTag)) console.error(`  ✗ [${tag}] ${parsedTag.error}`)
      for (const entry of errors.slice(0, 5)) {
        console.error(`  ✗ [${entry.locale}] ${entry.key ?? ''} (${entry.kind}): ${entry.message}`)
      }
      continue
    }
    baked.push({ tag: parsedTag, catalog: coerceCatalog(found.catalog) })
  }

  const outputPath = path.join(parsed.generatedDir, 'locales.ts')
  await fs.writeFile(outputPath, renderLocalesModule(baked))
  console.log(`Generated ${outputPath}`)
  console.log(
    `  ${Object.keys(en).length} English keys (inline), ${baked.length} baked locale(s)${
      baked.length > 0 ? `: ${baked.map((entry) => entry.tag).join(', ')}` : ''
    }`,
  )
  console.log(`  Wrote ${pseudoPath}`)
  for (const tag of missing) {
    console.warn(
      `  RITUAL_BUNDLED_LOCALES names "${tag}", but ${parsed.localesDir} has no such file`,
    )
  }
  for (const tag of rejected) {
    console.warn(`  "${tag}" was not baked — run scripts/check-locales.ts and fix its errors`)
  }
  if (rejected.length > 0) process.exitCode = 1
}

if (import.meta.main) await main()
