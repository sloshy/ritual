/**
 * The shapes a localized message can take, and the metadata that travels with
 * it. English is authored as `as const satisfies MessageCatalogShape` TypeScript
 * (the type source); every other locale ships as validated JSON data with the
 * same shape.
 *
 * This module is browser-safe (no `node:` imports) — the CLI, the public site,
 * and the admin site all share it.
 */

/**
 * A message whose wording depends on a count. The form is chosen by
 * `new Intl.PluralRules(locale).select(count)`, falling through to `other` when
 * the catalog does not supply the selected CLDR category.
 *
 * The plural argument is always named `count` so a translator never has to
 * guess which parameter drives the selection.
 */
export type PluralForms = {
  $plural: 'count'
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

/**
 * A message whose wording depends on an arbitrary variant (list type, gender,
 * tense). `$select` names the parameter to switch on; every other key is a
 * branch. Exactly one level is supported — a nested plural-in-select is
 * rejected by the catalog validator, which points at splitting the key instead.
 */
export type SelectForms = {
  $select: string
  [variant: string]: string
}

/** Any value a catalog entry may hold. */
export type MessageValue = string | PluralForms | SelectForms

/** The shape every message catalog (English or translated) conforms to. */
export type MessageCatalogShape = Record<string, MessageValue>

/**
 * Per-key translator metadata. `description` is mandatory — it is the only
 * context a translator gets. `maxLen` is a rendered-length budget, used by the
 * `cli.menu.*` namespace (the interactive session menu has a hard row budget)
 * and by the site's toolbar chips.
 */
export type MessageMeta = {
  description: string
  maxLen?: number
}

/**
 * The metadata table for a catalog fragment: every message key must carry an
 * entry, so a new message without a description is a compile error.
 */
export type MetaFor<C extends MessageCatalogShape> = {
  [K in keyof C]: MessageMeta
}

/** The shape of a merged metadata table. */
export type MessageMetaShape = Record<string, MessageMeta>

declare const localeTagBrand: unique symbol

/**
 * A BCP-47 language tag naming the language the *interface* speaks — never a
 * Scryfall card language (see `src/card-language.ts`; the two vocabularies are
 * deliberately kept apart).
 *
 * The type is **branded**, so only `parseLocaleTag` can mint one (plus the
 * single hand-minted `DEFAULT_LOCALE` in `constants.ts`). That turns "a tag is
 * validated exactly once, at the edge" from a convention into a compiler rule:
 * a raw `string` from argv, a query parameter, `localStorage`, or a JSON body
 * cannot be passed to `setLocale`, `loadDictionary`, `tIn`, or any `Intl`
 * wrapper without going through the parser — which is also what canonicalizes
 * `de-de` to `de-DE`, so dictionary lookups and cache keys agree.
 */
export type LocaleTag = string & { readonly [localeTagBrand]: true }

/** A loaded dictionary for one locale, keyed by message key. */
export type LocaleCatalog = Record<string, MessageValue>

/** A rendered message split into literal text and interpolated parameters. */
export type MessageSegment =
  | { kind: 'text'; value: string }
  | { kind: 'param'; name: string; value: string }

/**
 * True when the value is a {@link PluralForms} table.
 *
 * Takes `unknown` rather than `MessageValue` because the callers that most need
 * it hold untrusted JSON: narrowing the parameter would force each of them to
 * assert the very thing the guard exists to decide.
 */
export function isPluralForms(value: unknown): value is PluralForms {
  return typeof value === 'object' && value !== null && '$plural' in value
}

/** True when the value is a {@link SelectForms} table. See {@link isPluralForms}. */
export function isSelectForms(value: unknown): value is SelectForms {
  return typeof value === 'object' && value !== null && '$select' in value
}
