/**
 * The single source of truth for per-card languages.
 *
 * The vocabulary is **Scryfall's language codes**, not strict ISO two-letter
 * codes — `zhs` (Simplified Chinese), `zht` (Traditional Chinese), `grc`
 * (Ancient Greek), and `ph` (Phyrexian) all exist alongside the familiar
 * two-letter codes. These are the exact values Scryfall's card objects carry in
 * their `lang` field, so no translation layer sits between the cache and the
 * list files.
 *
 * On a card line the language is a bracket token in lowercase (`[ja]`), and the
 * token is **omitted when the language is English**: a bare line ALWAYS means
 * `en`, regardless of any configured default, so a list file stays
 * self-describing no matter whose config reads it. Parsers therefore never
 * synthesize `en` — an entry's `language` field is set only when the token is
 * physically present — and {@link displayLanguage} is the one place the
 * "missing means English" rule is applied when a resolved value is needed.
 */

import { compareData } from '../i18n/collate'
import type { ScryfallCard } from '../scryfall/types'

/** Every card language, in Scryfall's canonical listing order. */
export const CARD_LANGUAGES = [
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'ja',
  'ko',
  'ru',
  'zhs',
  'zht',
  'he',
  'la',
  'grc',
  'ar',
  'sa',
  'ph',
] as const

/** A Scryfall card language code. */
export type CardLanguage = (typeof CARD_LANGUAGES)[number]

/** The language a bare card line means, and the shipped `defaultLanguage` config value. */
export const DEFAULT_CARD_LANGUAGE: CardLanguage = 'en'

/**
 * The **frozen English** name of every card language, and the only table the
 * reverse lookup is built from.
 *
 * This is not a display table. {@link LANGUAGE_BY_NAME} inverts it so
 * `normalizeLanguageValue('Japanese') → 'ja'`, which backs `config set
 * defaultLanguage`, CSV import, the malformed-token hint, and — critically —
 * `changelog-parser.ts`, which re-reads `Set language of "X" to Japanese` out
 * of a persisted `.changes.md`. Translating these strings would make an old
 * changelog unparseable, so they are English by contract (plan §4.9) and
 * `languageLabel` is where a localized name comes from instead.
 */
export const LANGUAGE_PARSE_NAMES: Record<CardLanguage, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  zhs: 'Simplified Chinese',
  zht: 'Traditional Chinese',
  he: 'Hebrew',
  la: 'Latin',
  grc: 'Ancient Greek',
  ar: 'Arabic',
  sa: 'Sanskrit',
  ph: 'Phyrexian',
}

export function isCardLanguage(value: string): value is CardLanguage {
  return (CARD_LANGUAGES as readonly string[]).includes(value)
}

/**
 * Spellings other tools use for the same languages, lowercased. Covers
 * Scryfall's printed-code quirks (`jp`, `sp`, `cs`, `ct` appear on physical
 * cards and in third-party CSVs — Archidekt's CSV export uses exactly
 * `EN CT DE FR IT JP KR PT RU CS SP`, which lowercases into this table or the
 * codes themselves).
 */
const LANGUAGE_ALIASES: Record<string, CardLanguage> = {
  jp: 'ja',
  kr: 'ko',
  sp: 'es',
  cs: 'zhs',
  ct: 'zht',
}

/** Lowercased English name → code, built once from {@link LANGUAGE_PARSE_NAMES}. */
const LANGUAGE_BY_NAME: ReadonlyMap<string, CardLanguage> = new Map(
  (Object.entries(LANGUAGE_PARSE_NAMES) as [CardLanguage, string][]).map(([code, name]) => [
    name.toLowerCase(),
    code,
  ]),
)

/**
 * Parse a language value from any external source (user input, a CSV cell, an
 * import payload) into a {@link CardLanguage}, or `null` when the value names
 * no known language. Case-insensitive; accepts the codes themselves, the
 * common printed-code aliases (`jp`→`ja`, `kr`→`ko`, `sp`→`es`, `cs`→`zhs`,
 * `ct`→`zht`), and full English names (`Japanese`→`ja`).
 */
export function normalizeLanguageValue(raw: string): CardLanguage | null {
  const value = raw.trim().toLowerCase()
  if (value === '') return null
  if (isCardLanguage(value)) return value
  const alias = LANGUAGE_ALIASES[value]
  if (alias !== undefined) return alias
  return LANGUAGE_BY_NAME.get(value) ?? null
}

/**
 * The **frozen English** name for a language code (`ja` → `Japanese`).
 *
 * Every persisted or re-parsed surface uses this: `formatChangeCore`'s
 * `Set language of "X" to Japanese` line, and anything else whose output a
 * parser has to read back. Display surfaces that may be translated call
 * {@link languageLabel} instead.
 */
// Remaining display callers still on this frozen English table — CollectionPage,
// editor/language-prompt, CardSearchModal, admin Settings, session/prompts,
// card-target, set-card — move to `languageLabel` in the domain-vocabulary pass.
// **New display code must use `languageLabel`**; this is the parse-side name.
export function languageDisplayName(code: CardLanguage): string {
  return LANGUAGE_PARSE_NAMES[code]
}

/**
 * Memoized `Intl.DisplayNames` per UI locale. Built lazily and never with a
 * bare (host-resolved) locale — Bun resolves none from the environment, so the
 * tag is always passed in explicitly.
 */
const languageDisplayNames = new Map<string, Intl.DisplayNames | null>()

function displayNamesFor(locale: string): Intl.DisplayNames | null {
  const cached = languageDisplayNames.get(locale)
  if (cached !== undefined) return cached
  let names: Intl.DisplayNames | null
  try {
    names = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' })
  } catch {
    // An unusable tag is not worth failing a render over; English is the answer.
    names = null
  }
  languageDisplayNames.set(locale, names)
  return names
}

/**
 * The name of a card language **in the UI locale** (`ja` → `Japanese` under
 * `en`, `Japanisch` under `de`) — the display half of the split described on
 * {@link LANGUAGE_PARSE_NAMES}.
 *
 * Scryfall's vocabulary is not BCP-47: `zhs`, `zht` and `ph` name no language
 * ICU knows, so `fallback: 'none'` makes those lookups return `undefined` and
 * the frozen English name stands in. Under `en` this returns exactly
 * {@link LANGUAGE_PARSE_NAMES} for every one of the 17 codes, so English output
 * is unchanged by the split.
 *
 * The locale is a required argument rather than read ambiently: this module is
 * imported by the changelog writer's dependency graph, and a hidden read of the
 * active locale is exactly what must never leak into a persisted line.
 */
export function languageLabel(code: CardLanguage, locale: string): string {
  const frozen = LANGUAGE_PARSE_NAMES[code]
  const names = displayNamesFor(locale)
  if (names === null) return frozen
  try {
    return names.of(code) ?? frozen
  } catch {
    return frozen
  }
}

/**
 * The single resolution rule for an entry's language: a missing value means
 * English. Analogous to `displayFinish` — every comparison, key, and display
 * surface resolves through here so "absent" and `en` can never disagree.
 */
export function displayLanguage(language: CardLanguage | undefined): CardLanguage {
  return language ?? DEFAULT_CARD_LANGUAGE
}

/**
 * The write half of the en-omission invariant: the ` [ja]`-style token a card
 * line (or line-shaped display string) carries for a language, with its leading
 * space, and the empty string for English or an absent value — a bare line
 * ALWAYS means `en`, so the token is never written for it. Every serializer and
 * line-shaped formatter appends this rather than open-coding the fold.
 */
export function languageToken(language: string | undefined): string {
  return language && language !== DEFAULT_CARD_LANGUAGE ? ` [${language}]` : ''
}

/**
 * The inverse of {@link displayLanguage}: fold `en` to `undefined` for
 * storage on an entry. Serializers omit the token for English and a bare line
 * always means `en`, so an entry never stores an explicit `en` — every write
 * path that accepts a resolved language folds it through here.
 */
export function storedLanguage(language: CardLanguage | undefined): CardLanguage | undefined {
  return language === DEFAULT_CARD_LANGUAGE ? undefined : language
}

/**
 * The uppercase badge a card row/modal shows for a non-English entry (`ja` →
 * `JA`), or `null` for English/absent — English is the default and is never
 * badged, mirroring the bare-line rule.
 */
export function languageBadge(language: string | undefined): string | null {
  return language && language !== DEFAULT_CARD_LANGUAGE ? language.toUpperCase() : null
}

/**
 * Sort distinct language codes into canonical {@link CARD_LANGUAGES} order
 * (`en` first); codes outside that vocabulary sort last, alphabetically.
 * Tolerant of unknown codes so a raw external list can be ordered as-is.
 */
export function sortLanguages(codes: Iterable<string>): string[] {
  return [...codes].sort((a, b) => {
    const indexA = CARD_LANGUAGES.indexOf(a as CardLanguage)
    const indexB = CARD_LANGUAGES.indexOf(b as CardLanguage)
    if (indexA !== -1 && indexB !== -1) return indexA - indexB
    if (indexA !== -1) return -1
    if (indexB !== -1) return 1
    // Codes, not names: the order must not move with the UI locale.
    return compareData(a, b)
  })
}

/**
 * Render a list of language codes as `Japanese (ja), Korean (ko)` for the
 * "only available in …" notices. Codes outside the vocabulary render as-is.
 */
export function formatLanguageList(codes: readonly string[]): string {
  return codes
    .map((code) => (isCardLanguage(code) ? `${languageDisplayName(code)} (${code})` : code))
    .join(', ')
}

/**
 * The one refusal message for a value that names no known language, always
 * ending in the joined code list. `hint` is an optional context clause spliced
 * after the offender (e.g. `for "defaultLanguage"`, `on a card entry`). The
 * offender is JSON-encoded: a string is quoted verbatim, and a non-string
 * payload is shown as data rather than default-stringified. Every caller
 * guards `undefined` before refusing (an absent field is "use the default",
 * not an invalid language), so the encoding never comes back undefined.
 */
export function invalidLanguageMessage(raw: unknown, hint?: string): string {
  const offender = JSON.stringify(raw)
  const context = hint ? ` ${hint}` : ''
  return `Invalid language ${offender}${context}. Valid languages: ${CARD_LANGUAGES.join(', ')}`
}

/**
 * The language of a Scryfall card object as a {@link CardLanguage}, folding an
 * absent or unrecognized `lang` to `en` (the `default_cards` bulk omits it).
 * The Scryfall-object twin of {@link displayLanguage}.
 */
export function scryfallCardLanguage(card: ScryfallCard): CardLanguage {
  return card.lang !== undefined && isCardLanguage(card.lang) ? card.lang : DEFAULT_CARD_LANGUAGE
}

/**
 * The `(did you mean [ja]?)` suffix for a malformed-line warning: when a line
 * the grammar rejected carries a bracket token that names a language in the
 * wrong spelling (`[JA]`, `[jp]`, `[Japanese]`), the fix is worth naming.
 * Only tokens the grammar would *not* have matched qualify — a canonical
 * lowercase code means the line failed for some other reason. Empty when no
 * such token exists.
 */
export function malformedLanguageTokenHint(line: string): string {
  for (const match of line.matchAll(/\[([^\][]+)\]/g)) {
    const token = match[1]!
    const language = normalizeLanguageValue(token)
    if (language !== null && token !== language) return ` (did you mean [${language}]?)`
  }
  return ''
}

/**
 * Regex alternation of every language code, longest first, for embedding in
 * the card-line grammars (`(?:\s\[(${LANGUAGE_TOKEN_PATTERN})\])?`). Lowercase
 * only — the token is written lowercase, like set codes internally.
 */
export const LANGUAGE_TOKEN_PATTERN: string = [...CARD_LANGUAGES]
  .sort((a, b) => b.length - a.length)
  .join('|')
