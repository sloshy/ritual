/**
 * `t()` — the single message-rendering entry point, and the type machinery that
 * makes a stale call site a compile error.
 *
 * The English catalog is authored as `as const`, so a message's `{placeholder}`
 * names are extractable from its literal type: a params-free message takes no
 * second argument, a plural message *requires* `count`, and a misnamed
 * placeholder fails to compile. There is no extraction step and no codegen.
 *
 * The *type* is the whole catalog; the *values* are only the namespaces this
 * surface registered (`src/i18n/register/*`, §4.2). A key whose namespace is
 * unregistered renders as the key string — the same §4.8 degradation as a
 * missing key, and a throw under `RITUAL_I18N_STRICT=1`.
 *
 * Browser-safe: no `node:` imports.
 */

import { pluralRules } from './format'
import {
  currentLocale,
  DEFAULT_LOCALE,
  englishMessage,
  getDictionary,
  hasEnglishMessage,
  isStrictI18n,
} from './runtime'
// Type-only, and load-bearing that it stays that way: the barrel merges all
// seven namespaces, so a value import here would inline the CLI's ~1,400
// messages into both SPA bundles. Types are erased, so `EnglishCatalog` costs
// nothing — the *values* arrive through `registerMessages` (§4.2).
import type { EnglishCatalog, MessageKey } from './messages/en'
import {
  isPluralForms,
  isSelectForms,
  type LocaleTag,
  type MessageSegment,
  type MessageValue,
  type PluralForms,
  type SelectForms,
} from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The `{named}` placeholders appearing in a literal message string. */
export type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Placeholders<Rest>
  : never

/**
 * The renderable string forms of a catalog value: the message itself, every
 * branch of a select table, or a plural table's `other` form.
 *
 * `other` alone for a plural, deliberately. Unioning the plural branches the way
 * the select branch does (`V[keyof V & string]`) is the semantically complete
 * answer — a `one`/`few`/`zero` form may name a parameter `other` does not — but
 * `keyof V` on an indexed access over `K` turns `ParamsOf<K>` into an *inference
 * site*, so `t(key, bag)` starts binding `K` from the params bag instead of the
 * literal key and rejects perfectly good call sites (measured: two `$select`
 * keys with identical parameters in `src/commands/import.ts`). The gap is closed
 * at the layer that can afford it instead: `checkCatalogs` in
 * `scripts/check-locales.ts` rejects an English `$plural` branch that introduces
 * a placeholder `other` does not carry, which is the only way this type could
 * ever be wrong.
 */
export type Forms<V> = V extends string
  ? V
  : V extends PluralForms
    ? V['other']
    : V extends SelectForms
      ? V[keyof V & string]
      : never

/** Every parameter name a message needs: its placeholders plus its selector. */
export type ParamsOf<K extends MessageKey> =
  | Placeholders<Forms<EnglishCatalog[K]>>
  // `'count'` is spelled out rather than read off `EnglishCatalog[K]['$plural']`:
  // an indexed access on `K` is an inference site, and it makes `t(key, bag)`
  // infer `K` from the *params bag* instead of the literal key. `PluralForms`
  // pins `$plural: 'count'`, so the two can only ever agree anyway.
  | (EnglishCatalog[K] extends PluralForms ? 'count' : never)
  | (EnglishCatalog[K] extends SelectForms ? EnglishCatalog[K]['$select'] : never)

/**
 * Every key whose message takes no parameters — the only keys safe to hold in a
 * `Record<Key, MessageKey>` label table, since a table lookup has already
 * widened the literal key away and `t`'s parameter checking can no longer fire.
 */
export type ParameterlessKey = {
  [K in MessageKey]: [ParamsOf<K>] extends [never] ? K : never
}[MessageKey]

/** The params object a message requires. */
export type MessageParams<K extends MessageKey> = Record<ParamsOf<K>, string | number>

/** `[]` for a params-free message, `[params]` otherwise. */
export type TranslateArgs<K extends MessageKey> = [ParamsOf<K>] extends [never]
  ? []
  : [params: MessageParams<K>]

/** The shape of `t` — also what `useT()` hands back to Solid components. */
export type TranslateFn = <K extends MessageKey>(key: K, ...args: TranslateArgs<K>) => string

/**
 * The shape of a translator for a key chosen at **runtime** — `useTDynamic()`
 * in a Solid component. Parameters are unchecked; see {@link tDynamic}.
 */
export type TranslateDynamicFn = (key: MessageKey, params?: RenderParams) => string

/** Any params bag, once the compile-time key is erased. */
export type RenderParams = Record<string, string | number>

/**
 * A message held **unrendered** — the key plus the parameters it interpolates —
 * so a later locale switch can re-render it.
 *
 * Declared once here and composed by everything that defers a message:
 * `ErrorMessageRef` (`src/errors.ts`), `ChangeMessage` (`src/change-message.ts`),
 * the `key` arm of `EditorStatusMessage`, and — flattened onto the wire, because
 * MCP already reads those field names — `ApiMessage`. Carrying a parameterised
 * key *without* its params is the failure this type exists to make obvious: the
 * client re-renders literal `{field}` tokens.
 */
export type MessageRef = {
  key: MessageKey
  params?: RenderParams
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** A message value together with the locale whose catalog supplied it. */
type ResolvedMessage = {
  value: MessageValue
  locale: LocaleTag
}

/**
 * Walk the fallback chain: the active locale, then English, then nothing. The
 * *resolving* locale is returned alongside the value because plural selection
 * must follow the language of the text actually rendered — English fallback
 * text under a Russian UI still picks English plural categories.
 */
function resolve(key: string, locale: LocaleTag): ResolvedMessage | undefined {
  if (locale !== DEFAULT_LOCALE) {
    const value = getDictionary(locale)?.[key]
    if (value !== undefined) return { value, locale }
  }
  const fallback = englishMessage(key)
  if (fallback !== undefined) return { value: fallback, locale: DEFAULT_LOCALE }
  return undefined
}

function strictFailure(reason: string): never {
  throw new Error(`i18n: ${reason} (RITUAL_I18N_STRICT=1)`)
}

/**
 * Reduce a catalog value to the single string to interpolate: pick the plural
 * category or the select branch, falling through to `other`.
 */
function selectForm(key: string, resolved: ResolvedMessage, params: RenderParams): string {
  const { value, locale } = resolved
  if (typeof value === 'string') return value
  if (isPluralForms(value)) {
    const count = Number(params[value.$plural])
    if (!Number.isFinite(count)) {
      if (isStrictI18n()) strictFailure(`message "${key}" needs a numeric "${value.$plural}" param`)
      return value.other
    }
    const category = pluralRules(locale).select(count)
    return value[category] ?? value.other
  }
  if (isSelectForms(value)) {
    const variant = params[value.$select]
    const branch = variant === undefined ? undefined : value[String(variant)]
    if (branch !== undefined) return branch
    // `other` is a deliberate catch-all, so an unmatched variant is only a gap
    // when the catalog supplies no catch-all either.
    const fallback = value.other
    if (fallback !== undefined) return fallback
    if (isStrictI18n()) {
      strictFailure(`message "${key}" has no "${String(variant)}" branch for "${value.$select}"`)
    }
    return key
  }
  return key
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{([^{}]+)\}/g

/**
 * Split a form into literal text and parameter segments. Used by both `t()`
 * (which joins them) and `tSegments()` (which hands them to the caller so a
 * parameter can be rendered as a button mid-sentence).
 */
function interpolate(key: string, form: string, params: RenderParams): MessageSegment[] {
  const segments: MessageSegment[] = []
  let lastIndex = 0
  for (const match of form.matchAll(PLACEHOLDER)) {
    const raw = match[0]
    const name = (match[1] ?? '').trim()
    const start = match.index
    if (start > lastIndex) {
      segments.push({ kind: 'text', value: form.slice(lastIndex, start) })
    }
    lastIndex = start + raw.length
    const value = params[name]
    if (value === undefined) {
      // A translation may carry a placeholder English does not (the catalog
      // validator rejects that); degrade by leaving the token visible rather
      // than rendering "undefined" into user-facing text.
      if (isStrictI18n()) strictFailure(`message "${key}" is missing the "${name}" param`)
      segments.push({ kind: 'text', value: raw })
      continue
    }
    segments.push({ kind: 'param', name, value: String(value) })
  }
  if (lastIndex < form.length) {
    segments.push({ kind: 'text', value: form.slice(lastIndex) })
  }
  return segments
}

function render(key: string, params: RenderParams, locale: LocaleTag): MessageSegment[] {
  const resolved = resolve(key, locale)
  if (resolved === undefined) {
    // Two ways to get here, one degradation: the key exists nowhere, or its
    // namespace was never registered by this surface's entry point
    // (`src/i18n/register/*`).
    if (isStrictI18n()) {
      strictFailure(`missing message key "${key}" — is its namespace registered?`)
    }
    // Last resort: the key itself. Greppable, obviously wrong, never a crash.
    return [{ kind: 'text', value: key }]
  }
  return interpolate(key, selectForm(key, resolved, params), params)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a message in the active locale. Never throws outside strict mode:
 * an unknown key falls back to English and then to the key string itself.
 */
export function t<K extends MessageKey>(key: K, ...args: TranslateArgs<K>): string {
  return tIn(currentLocale(), key, ...args)
}

/**
 * Render a message in an explicit locale, bypassing the active one. For the
 * rare producer that must render text for someone else's locale (an API
 * response rendered as English regardless of the operator's UI).
 */
export function tIn<K extends MessageKey>(
  locale: LocaleTag,
  key: K,
  ...args: TranslateArgs<K>
): string {
  return tDynamic(locale, key, paramsOf(args))
}

/**
 * The params bag out of a {@link TranslateArgs} tuple, or `undefined` for a
 * params-free key.
 *
 * `TranslateArgs<K>` is a conditional tuple, so a generic function cannot
 * destructure it without an assertion. Written once here rather than at each of
 * the four producers that build a deferred message from `...args`.
 */
export function paramsOf<K extends MessageKey>(args: TranslateArgs<K>): RenderParams | undefined {
  const [params] = args as readonly [RenderParams?]
  return params
}

/**
 * Render a message whose key was chosen at **runtime** — read out of a label
 * table, or carried across a wire as `ApiMessage.messageKey` / an
 * `EditorStatusMessage`.
 *
 * `t`'s parameter checking keys off the *literal* key, which a stored or
 * transmitted key has already erased. The producer (`apiMessage`,
 * `statusMessage`, `buildMessage`, `changeMessage`) checked the key/params pair
 * while it still had the literal, so the erasure is sound — and absorbing it
 * here, once, is why no consumer has to write `t as unknown as …`.
 */
export function tDynamic(locale: LocaleTag, key: MessageKey, params?: RenderParams): string {
  let out = ''
  for (const segment of render(key, params ?? {}, locale)) out += segment.value
  return out
}

/** {@link tDynamic} as ordered segments. See {@link tSegments}. */
export function tSegmentsDynamic(
  locale: LocaleTag,
  key: MessageKey,
  params?: RenderParams,
): MessageSegment[] {
  return render(key, params ?? {}, locale)
}

/**
 * Render a message as ordered segments so a caller can wrap an individual
 * parameter in markup — a clickable card name mid-sentence, for instance.
 * The translator keeps full control of word order.
 */
export function tSegments<K extends MessageKey>(
  key: K,
  params: MessageParams<K>,
): MessageSegment[] {
  return tSegmentsIn(currentLocale(), key, params)
}

/** {@link tSegments} in an explicit locale. See {@link tIn}. */
export function tSegmentsIn<K extends MessageKey>(
  locale: LocaleTag,
  key: K,
  params: MessageParams<K>,
): MessageSegment[] {
  return render(key, params, locale)
}

/**
 * Whether a string is a known message key. For the `messageKey` field carried
 * by API responses and error envelopes, which arrives as untyped JSON.
 *
 * "Known" means *registered by this surface* — an SPA that never registers the
 * `cli` namespace rightly rejects a `cli.*` key it could not render anyway.
 */
export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === 'string' && hasEnglishMessage(value)
}
