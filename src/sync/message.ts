/**
 * The human text a sync engine produces, as **messages** rather than rendered
 * strings.
 *
 * A sync runs on a server (the admin API, `ritual mcp`) as often as in the CLI,
 * and its text lands in three places that want three different languages: the
 * JSON report an agent or script reads (English — the contract every
 * {@link ApiMessage} keeps), the admin page watching the run (the *browser's*
 * language, relabelled when the reader switches it), and the CLI's console (the
 * CLI's own UI language). Rendering once, in whatever locale the engine's
 * process happens to run in, would get at least two of those wrong.
 *
 * So the engines build a {@link SyncMessage}: the English `message` every
 * existing reader reads, plus `messageKey` / `messageParams` — a
 * {@link MessageTriple}, the same shape an `ApiMessage` has — for a reader that
 * renders it itself.
 *
 * **Why not `ApiMessage` itself.** An `ApiMessage`'s params are flat strings and
 * numbers. Sync text is built from parts that are themselves translated: a
 * count rendered with its plural noun (`3 collection lists`), a list of lists
 * joined with the locale's "and", a duration, a language name, a nested reason.
 * Pre-rendering those parts in English would leave English fragments inside a
 * translated sentence, so a param here may itself be a message reference
 * ({@link SyncMessageRef}), a list ({@link SyncListParam}), a duration
 * ({@link SyncElapsedParam} for how long something took, {@link SyncDurationParam}
 * for an age or a timeout), a card language ({@link SyncLanguageParam}) or a data
 * size ({@link SyncSizeParam}) or a price ({@link SyncPriceParam}), and
 * {@link renderSyncMessage} renders the whole tree in one locale. The type is
 * deliberately not assignable to `ApiMessage`, so a sync message cannot reach
 * `renderApiMessage`, which would print a nested param as `[object Object]`.
 *
 * Browser-safe: the admin SPA renders these, so nothing here may reach for
 * `node:`.
 */

import { languageLabel, type CardLanguage } from '../card/card-language'
import { formatUnitList, listFormat, numberFormat } from '../i18n/format'
import type { EnglishCatalog, MessageKey } from '../i18n/messages/en'
import { currentLocale, DEFAULT_LOCALE } from '../i18n/runtime'
import {
  isMessageKey,
  tDynamic,
  unresolvedPlaceholders,
  type MessageRef,
  type MessageTriple,
  type ParamsOf,
  type RenderParams,
  type SelectBranch,
} from '../i18n/t'
import type { LocaleTag, PluralForms, SelectForms } from '../i18n/types'
import { formatDuration, formatElapsed } from '../util/duration'
import { formatPriceIn, isPriceCurrency, type PriceCurrency } from '../pricing/money-format'
import { isRecord } from '../util/json'

// ── Shapes ────────────────────────────────────────────────────────────

/**
 * A translated message held unrendered: the key, and what it interpolates.
 * Used for a message nested inside another, where the English text would be
 * dead weight on the wire.
 */
export type SyncMessageRef = {
  messageKey: MessageKey
  messageParams?: SyncMessageParams
}

/** How a {@link SyncListParam} is joined. */
export type SyncListJoin =
  /** The locale's "and" list: `A, B, and C`. */
  | 'and'
  /** The locale's unit list — no conjunction: `A, B, C`. Independent items and counts. */
  | 'unit'
  /** Independent clauses, joined pairwise through `domain.sync.clauseJoin` (`A; B`). */
  | 'clauses'
  /**
   * Plain concatenation, for clauses that carry their own separator in the
   * catalog (a deck's `Changes:` count and its `, 2 board moves` tail).
   */
  | 'concat'

/** Several parts rendered and joined in the enclosing message's locale. */
export type SyncListParam = { list: readonly SyncParam[]; join: SyncListJoin }

/**
 * A duration in milliseconds to second precision, rendered like `4.2 seconds`
 * in the enclosing message's locale (`formatElapsed`): how long something took,
 * or a time-out counted in seconds (a Scryfall request's).
 */
export type SyncElapsedParam = { elapsedMs: number }

/**
 * A coarser duration in milliseconds, rendered like `2 days, 3 hours` or
 * `less than a minute` in the enclosing message's locale (`formatDuration`,
 * whose floor is a minute): an age, or a wait counted in minutes (the cache
 * lock's). A time-out of seconds is a {@link SyncElapsedParam}, which this
 * would round down to "less than a minute".
 */
export type SyncDurationParam = { durationMs: number }

/** A card language, named in the enclosing message's locale (`Japanese`, `Japanisch`). */
export type SyncLanguageParam = { language: CardLanguage }

/**
 * A data size in bytes, rendered as a mebibyte figure to two decimals (`12.34`,
 * `12,34`) in the enclosing message's locale. The figure only: the enclosing
 * message spells the unit (`{size} MiB`), so one unit can close a pair of
 * sizes (`12.34/56.78 MiB`). Never digit-grouped, so the English figure is the
 * same as `toFixed(2)`'s.
 */
export type SyncSizeParam = { sizeBytes: number }

/**
 * A price, rendered in the enclosing message's locale by the one display
 * formatter prices use everywhere (`formatPriceIn`): `$0.50`, `0,50 €`,
 * `1.00 tix`. The amount stays a number, so a reader formats it in its own
 * language — and a currency this surface does not know is a shape it does not
 * know, so the message falls back to its English.
 */
export type SyncPriceParam = { amount: number; currency: PriceCurrency }

/**
 * One parameter of a sync message. A string is text rendered once and for all —
 * a card name, a list name, or an error message raised outside the catalog.
 */
export type SyncParam =
  | string
  | number
  | SyncMessageRef
  | SyncListParam
  | SyncElapsedParam
  | SyncDurationParam
  | SyncLanguageParam
  | SyncSizeParam
  | SyncPriceParam

/** The parameters a sync message interpolates. */
export type SyncMessageParams = Record<string, SyncParam>

/**
 * Human text a sync produced: a {@link MessageTriple} whose params may nest.
 *
 * `message` is English whenever the text comes from the catalog — the engines
 * render it with `DEFAULT_LOCALE`, nested parts included. The one exception is
 * text Ritual did not word itself: an error another module raised (a file it
 * could not read, an Archidekt client failure), or a refusal a caller's
 * callback returned as plain text. That arrives already rendered — engine
 * errors are worded where they are raised, in the active locale — and is
 * carried as it is, with no key, inside an otherwise English
 * message.
 */
export type SyncMessage = MessageTriple<SyncMessageParams>

/** Text a surface renders: literal text, or a message to render in the reader's locale. */
export type SyncText = string | SyncMessageRef

/** A list with at least one element. */
export type NonEmpty<T> = readonly [T, ...T[]]

/**
 * Compiles only when `rest` is empty. A wording function's `switch` destructures
 * the values each code carries and hands the rest here, so a value added to a
 * code's params fails to build until its sentence uses it.
 */
export function allUsed(rest: Record<string, never>): void {
  void rest
}

/** Whether a list has at least one element — the guard {@link joinSyncMessages} wants. */
export function isNonEmpty<T>(items: readonly T[]): items is NonEmpty<T> {
  return items.length > 0
}

// ── Typed params ──────────────────────────────────────────────────────

/**
 * `count` on a `$plural` key, `never` otherwise. Distributive over `K` (the
 * naked `K extends MessageKey` check), so a union of keys yields the union of
 * their answers rather than collapsing to `never` when they disagree.
 */
type PluralCountParam<K extends MessageKey> = K extends MessageKey
  ? EnglishCatalog[K] extends PluralForms
    ? 'count'
    : never
  : never

/** The selector parameter of a `$select` key, `never` otherwise. Distributive like the above. */
type SelectorParam<K extends MessageKey> = K extends MessageKey
  ? EnglishCatalog[K] extends SelectForms
    ? EnglishCatalog[K]['$select']
    : never
  : never

/**
 * The params a key takes. Any placeholder may be a nested message, list,
 * duration or language — except the two that steer the message itself: a
 * plural's `count` must be a number, and a select's selector one of its
 * branches, or the catalog would pick a form from a value it cannot read.
 */
export type SyncMessageParamsFor<K extends MessageKey> = Record<
  Exclude<ParamsOf<K>, PluralCountParam<K> | SelectorParam<K>>,
  SyncParam
> &
  Record<PluralCountParam<K>, number> &
  Record<SelectorParam<K>, SelectBranch<K>>

/**
 * `[]` for a params-free key, `[params]` otherwise — `TranslateArgs` for sync
 * messages. Not `TranslateArgs` itself (nor its `paramsOf`): those type every
 * param as flat text, which is exactly what a sync param is not.
 */
export type SyncArgs<K extends MessageKey> = [ParamsOf<K>] extends [never]
  ? []
  : [params: SyncMessageParamsFor<K>]

/**
 * The codes of a code → key table whose key's placeholders disagree with the
 * param names the code supplies (`Expected[C]`), or `never` when every code
 * agrees. For a module that words structured problems through a lookup table
 * — where `syncRef`'s per-call check cannot reach — to assert, at compile time,
 * that a placeholder renamed in the catalog or a value added to a code fails
 * to build rather than rendering a literal `{token}`.
 */
export type PlaceholderDrift<
  C extends string,
  Keys extends Record<C, MessageKey>,
  Expected extends Record<C, string>,
> = {
  [K in C]: [ParamsOf<Keys[K]>] extends [Expected[K]]
    ? [Expected[K]] extends [ParamsOf<Keys[K]>]
      ? never
      : K
    : K
}[C]

/**
 * The codes whose supplied params (`Given[C]`) are not what their key accepts —
 * a select's selector one of its branches, a plural's `count` a number — or
 * `never`. The type half of {@link PlaceholderDrift}.
 */
export type ParamTypeDrift<
  C extends string,
  Keys extends Record<C, MessageKey>,
  Given extends Record<C, unknown>,
> = {
  [K in C]: Given[K] extends SyncMessageParamsFor<Keys[K]> ? never : K
}[C]

// ── Builders ──────────────────────────────────────────────────────────

/** A {@link SyncMessageRef}, its params checked against the key's catalog entry. */
export function syncRef<K extends MessageKey>(key: K, ...args: SyncArgs<K>): SyncMessageRef {
  const [params] = args as readonly [SyncMessageParams?]
  return params === undefined ? { messageKey: key } : { messageKey: key, messageParams: params }
}

/** A {@link SyncMessage}: the English rendering plus the message it came from. */
export function syncMessage<K extends MessageKey>(key: K, ...args: SyncArgs<K>): SyncMessage {
  return toSyncMessage(syncRef(key, ...args))
}

/** Attach the English rendering to a reference, field by field. */
export function toSyncMessage(ref: SyncMessageRef): SyncMessage {
  const message: SyncMessage = {
    message: renderSyncMessage(ref, DEFAULT_LOCALE),
    messageKey: ref.messageKey,
  }
  if (ref.messageParams !== undefined) message.messageParams = ref.messageParams
  return message
}

/**
 * Text with no catalog entry, carried as it is — see {@link SyncMessage} for
 * when that is allowed.
 */
export function syncText(text: string): SyncMessage {
  return { message: text }
}

/** Text to send on as a message: a reference gains its English, literal text stays as it is. */
export function syncMessageOf(text: SyncText): SyncMessage {
  return typeof text === 'string' ? syncText(text) : toSyncMessage(text)
}

/** A message as a param of another: its reference when it has one, its text otherwise. */
export function nestSync(message: SyncMessage): SyncText {
  if (message.messageKey === undefined) return message.message
  return message.messageParams === undefined
    ? { messageKey: message.messageKey }
    : { messageKey: message.messageKey, messageParams: message.messageParams }
}

/** A list param. */
export function syncList(list: readonly SyncParam[], join: SyncListJoin): SyncListParam {
  return { list, join }
}

/** A duration param. */
export function syncElapsed(elapsedMs: number): SyncElapsedParam {
  return { elapsedMs }
}

/** An age or minutes-long wait param — see {@link SyncDurationParam}. */
export function syncDuration(durationMs: number): SyncDurationParam {
  return { durationMs }
}

/** A card-language param. */
export function syncLanguage(language: CardLanguage): SyncLanguageParam {
  return { language }
}

/** A data-size param — see {@link SyncSizeParam}. */
export function syncSize(sizeBytes: number): SyncSizeParam {
  return { sizeBytes }
}

/** A price param — see {@link SyncPriceParam}. */
export function syncPrice(amount: number, currency: PriceCurrency): SyncPriceParam {
  return { amount, currency }
}

/**
 * The members of `T` that declare `message` but are not a message: they carry
 * a field a {@link SyncMessage} does not have, so {@link isSyncMessage} would
 * misread them as a refusal. Distributes over a union. A string index
 * signature (`Record<string, …>`) declares no particular key, so it is not
 * read as declaring `message`.
 */
type MessageImpostors<T> = T extends unknown
  ? string extends keyof T
    ? never
    : 'message' extends keyof T
      ? [Exclude<keyof T, keyof SyncMessage>] extends [never]
        ? never
        : T
      : never
  : never

/**
 * The constraint {@link isSyncMessage} puts on its argument: `unknown` (none)
 * when no member of `T` is a {@link MessageImpostors | message impostor},
 * `never` (no `T` fits) when one is.
 */
export type NoMessageImpostor<T> = [MessageImpostors<T>] extends [never] ? unknown : never

/**
 * Whether a value is a {@link SyncMessage} — the one discriminant the sync
 * engines use for "a result, or the message saying why not". Structural: it
 * holds because no success type a sync function returns carries a string
 * `message` (a route, a target, a loaded list, a parse result) — and that is
 * checked, not assumed: a member of the argument's type that declares `message`
 * beside fields a message does not have fails to compile
 * ({@link NoMessageImpostor}), so a success type that grows a `message` cannot
 * be mistaken for a refusal at runtime.
 */
export function isSyncMessage<T extends NoMessageImpostor<T>>(value: T): value is T & SyncMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

/** The most reasons {@link joinSyncMessages} spells out; the rest are counted. */
export const MAX_JOINED_REASONS = 5

/** How {@link joinSyncMessages} treats a long list of reasons. */
export type JoinSyncMessagesOptions = {
  /**
   * Spell every reason out, however many there are. For a list bounded by
   * what the user wrote and that must be fixed whole — the problems of one CSV
   * row, the bad names of a removal priority — where a counted "N more" would
   * hide exactly what needs fixing.
   */
  complete?: boolean
}

/**
 * Several reasons as one — a deck whose plan hit two errors, a list that failed
 * for two cards. One reason is itself; several are independent clauses joined
 * pairwise through `domain.sync.clauseJoin` (`A; B`). Takes at least one, so a
 * caller cannot produce an empty reason.
 *
 * Unless `options.complete` says otherwise, at most {@link MAX_JOINED_REASONS}
 * are spelled out, and any beyond are counted in a closing "N more"
 * (`domain.sync.moreReasons`): a push that failed for two hundred cards must
 * not make a reason two hundred sentences long. The run log names each failure
 * as it happens.
 */
export function joinSyncMessages(
  messages: NonEmpty<SyncMessage>,
  options: JoinSyncMessagesOptions = {},
): SyncMessage {
  if (messages.length === 1) return messages[0]
  const limit = options.complete === true ? messages.length : MAX_JOINED_REASONS
  const shown: SyncParam[] = messages.slice(0, limit).map(nestSync)
  const more = messages.length - shown.length
  if (more > 0) shown.push(syncRef('domain.sync.moreReasons', { count: more }))
  return syncMessage('domain.sync.reasonList', { reasons: syncList(shown, 'clauses') })
}

// ── Parse refusals ────────────────────────────────────────────────────

/**
 * The refusal branch of a parser that returns `T | MessageParseError`
 * (AGENTS.md, "Parsers"): why the input was refused, held as a message so the
 * caller can word it in its reader's language or nest it whole in a refusal of
 * its own.
 */
export type MessageParseError = { error: SyncMessage }

/**
 * The members of `T` other than {@link MessageParseError} that declare an
 * `error` field, which {@link isMessageParseError} would misread as the
 * refusal. Distributes over a union; a string index signature declares no
 * particular key.
 */
type ErrorImpostors<T> = T extends unknown
  ? T extends MessageParseError
    ? never
    : string extends keyof T
      ? never
      : 'error' extends keyof T
        ? T
        : never
  : never

/** `unknown` when no success member of `T` has an `error` field, `never` (no `T` fits) otherwise. */
export type NoErrorImpostor<T> = [ErrorImpostors<T>] extends [never] ? unknown : never

/**
 * Whether a parse result is the refusal. Structural, and checked rather than
 * assumed: a success type that declares an `error` field fails to compile here
 * ({@link NoErrorImpostor}), so it can never be mistaken for a refusal.
 */
export function isMessageParseError<T extends NoErrorImpostor<T>>(
  value: T,
): value is T & MessageParseError {
  return (
    typeof value === 'object' && value !== null && 'error' in value && isSyncMessage(value.error)
  )
}

// ── Errors ────────────────────────────────────────────────────────────

/**
 * An error a sync-owned code path throws, carrying its message unrendered so a
 * report can still state it in English (and a reader in its own language). Its
 * `Error.message` is the active locale's rendering, as for any engine error —
 * display text only: never persist it or put it on the wire. Anything that
 * stores or sends the error reads {@link SyncMessageError.syncMessage}, whose
 * `message` is English.
 */
export class SyncMessageError extends Error {
  readonly syncMessage: SyncMessage
  /** `options` as `Error`'s own: a `cause` is kept the standard way. */
  constructor(message: SyncMessage, options?: ErrorOptions) {
    super(renderSyncMessage(message), options)
    this.name = 'SyncMessageError'
    this.syncMessage = message
  }
}

/** A `{ key, params }` pair an error may carry (`CardCommandError.messageRef`). */
type CarriedMessageRef = { key: MessageKey; params?: RenderParams }

function carriedRef(error: unknown): CarriedMessageRef | undefined {
  if (typeof error !== 'object' || error === null || !('messageRef' in error)) return undefined
  const ref = error.messageRef
  if (typeof ref !== 'object' || ref === null || !('key' in ref)) return undefined
  return isMessageKey(ref.key) ? (ref as CarriedMessageRef) : undefined
}

/**
 * A caught error as a message param: its message unrendered when it carries one
 * (a {@link SyncMessageError}, or any error with a `messageRef`), so it renders
 * in the reader's language like the sentence around it — and its text
 * otherwise, the words it was raised in.
 */
export function errorParam(error: unknown): SyncText {
  if (error instanceof SyncMessageError) return nestSync(error.syncMessage)
  const ref = carriedRef(error)
  if (ref !== undefined) {
    return ref.params === undefined
      ? { messageKey: ref.key }
      : { messageKey: ref.key, messageParams: ref.params }
  }
  return error instanceof Error ? error.message : String(error)
}

/** A caught error as a whole message — a reason, or a log line — per {@link errorParam}. */
export function errorMessage(error: unknown): SyncMessage {
  return syncMessageOf(errorParam(error))
}

// ── Rendering ─────────────────────────────────────────────────────────

/** The two joins `Intl` provides besides the unit list. */
const AND_LIST: Intl.ListFormatOptions = { style: 'long', type: 'conjunction' }

function joinRendered(parts: string[], join: SyncListJoin, locale: LocaleTag): string {
  switch (join) {
    case 'and':
      return listFormat(locale, AND_LIST).format(parts)
    case 'unit':
      return formatUnitList(locale, parts)
    case 'clauses':
      return parts.reduce((joined, part, index) =>
        index === 0
          ? part
          : tDynamic(locale, 'domain.sync.clauseJoin', { first: joined, second: part }),
      )
    case 'concat':
      return parts.join('')
  }
}

/**
 * Render a param. `strict` returns `undefined` as soon as any key in the tree
 * is not one this surface knows (an older bundle reading a newer server's
 * report), so the caller can fall back to the English it was sent; otherwise an
 * unknown key degrades the way `t()` does, to the key itself.
 */
function renderParam(
  param: SyncParam,
  locale: LocaleTag,
  strict: boolean,
): string | number | undefined {
  if (typeof param === 'string' || typeof param === 'number') return param
  // The shape is checked, not assumed: a param comes off the wire, and a newer
  // server may send a kind this bundle has never heard of. An unknown shape
  // renders as nothing — or, strictly, sends the whole message back to the
  // English it carries.
  if (typeof param !== 'object' || param === null) return strict ? undefined : ''
  if ('messageKey' in param && typeof param.messageKey === 'string') {
    return renderRef(param, locale, strict)
  }
  if ('list' in param && Array.isArray(param.list) && isListJoin(param.join)) {
    // Annotated: `Array.isArray` narrows a readonly array to `any[]`.
    const list: readonly SyncParam[] = param.list
    const parts: string[] = []
    for (const part of list) {
      const rendered = renderParam(part, locale, strict)
      if (rendered === undefined) return undefined
      parts.push(String(rendered))
    }
    return parts.length === 0 ? '' : joinRendered(parts, param.join, locale)
  }
  if ('language' in param && typeof param.language === 'string') {
    return languageLabel(param.language, locale)
  }
  if ('elapsedMs' in param && typeof param.elapsedMs === 'number') {
    return formatElapsed(param.elapsedMs, locale)
  }
  if ('durationMs' in param && typeof param.durationMs === 'number') {
    return formatDuration(param.durationMs, locale)
  }
  if ('sizeBytes' in param && typeof param.sizeBytes === 'number') {
    return formatMebibytes(param.sizeBytes, locale)
  }
  if (
    'amount' in param &&
    typeof param.amount === 'number' &&
    'currency' in param &&
    typeof param.currency === 'string' &&
    isPriceCurrency(param.currency)
  ) {
    return formatPriceIn(locale, param.amount, param.currency)
  }
  return strict ? undefined : ''
}

/** Bytes per mebibyte. */
const MEBIBYTE = 1024 * 1024

/** The mebibyte figure of a {@link SyncSizeParam}: two decimals, no digit grouping. */
const MEBIBYTE_FIGURE: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
}

function formatMebibytes(bytes: number, locale: LocaleTag): string {
  return numberFormat(locale, MEBIBYTE_FIGURE).format(bytes / MEBIBYTE)
}

/** Every join a {@link SyncListParam} may name. */
const LIST_JOINS: readonly string[] = ['and', 'unit', 'clauses', 'concat'] satisfies SyncListJoin[]

function isListJoin(value: unknown): value is SyncListJoin {
  return typeof value === 'string' && LIST_JOINS.includes(value)
}

function renderRef(ref: SyncMessageRef, locale: LocaleTag, strict: boolean): string | undefined {
  if (strict && !isMessageKey(ref.messageKey)) return undefined
  const params: RenderParams = {}
  for (const [name, value] of Object.entries(ref.messageParams ?? {})) {
    const rendered = renderParam(value, locale, strict)
    if (rendered === undefined) return undefined
    params[name] = rendered
  }
  // A placeholder with no param (a message built before its param was renamed)
  // would print as a raw `{token}`; strictly, the whole message falls back.
  if (strict && unresolvedPlaceholders(locale, ref.messageKey, params).length > 0) {
    return undefined
  }
  return tDynamic(locale, ref.messageKey, params)
}

/**
 * Whether this surface can render `ref` whole in `locale`: every key in its
 * tree is one it knows, every param a shape it knows, every placeholder filled
 * — the check {@link renderSyncMessage} falls back to English on. For a reader
 * deciding whether to nest a message another process sent (which may be newer
 * than this one) or to carry its English as it came: a nested reference that
 * fails the check would render as a raw key or `{token}`, its English lost.
 */
export function isRenderable(ref: SyncMessageRef, locale: LocaleTag = DEFAULT_LOCALE): boolean {
  return renderRef(ref, locale, true) !== undefined
}

/**
 * A message another process sent (a cache server's reply, a newer server's
 * report), as a param: nested when this surface can render it whole, so it
 * reads in the reader's language — and its English as it came otherwise. A
 * newer sender may use a key, a param or a param kind this surface does not
 * know, and nesting that would render its sentence as a raw key or `{token}`,
 * the English lost.
 */
export function nestReceived(message: SyncMessage): SyncText {
  const nested = nestSync(message)
  return typeof nested === 'string' || isRenderable(nested) ? nested : message.message
}

/**
 * Render a sync message — or a nested reference, or literal text — in one
 * locale, nested parts included.
 *
 * A message whose tree names a key this surface does not have (its namespace
 * unregistered, or a newer server's), or leaves one of its placeholders without
 * a param (an older server's, from before the param was renamed), renders as
 * the English it carries, whole — never a half-translated sentence with a raw
 * key or `{token}` in it. A bare
 * reference has no English to fall back on, so an unknown key in it degrades
 * the way `t()` does.
 *
 * `locale` defaults to the active UI locale, and reads it through the
 * registered reactive source: called inside a Solid component's JSX, the text
 * re-renders when the reader switches language. The English half of every
 * {@link SyncMessage} is this with `DEFAULT_LOCALE`.
 */
export function renderSyncMessage(
  message: SyncMessage | SyncText,
  locale: LocaleTag = currentLocale(),
): string {
  if (typeof message === 'string') return message
  if (message.messageKey === undefined) return 'message' in message ? message.message : ''
  const ref: SyncMessageRef =
    message.messageParams === undefined
      ? { messageKey: message.messageKey }
      : { messageKey: message.messageKey, messageParams: message.messageParams }
  if ('message' in message) return renderRef(ref, locale, true) ?? message.message
  return renderRef(ref, locale, false) ?? ''
}

/**
 * Render one param on its own — a list, a duration, a nested message — in
 * `locale`, for a caller that splices it into text of its own.
 */
export function renderSyncParam(param: SyncParam, locale: LocaleTag = currentLocale()): string {
  return String(renderParam(param, locale, false) ?? '')
}

// ── Flat references ───────────────────────────────────────────────────

/**
 * A message's key and params with every nested param flattened to its
 * **English** rendering, or `undefined` when it has no key — for a channel
 * whose params must be flat strings and numbers: the CLI's `--output json`
 * error envelope, a `CardCommandError`'s `messageRef`. Locale-invariant like
 * the key, and enough for a client to re-render the key whole (the same
 * convention as `import-changes --output json`).
 */
export function envelopeRef(message: SyncMessage): MessageRef | undefined {
  const key = message.messageKey
  if (key === undefined) return undefined
  const params = message.messageParams
  if (params === undefined) return { key }
  const flat: RenderParams = {}
  for (const [name, param] of Object.entries(params)) {
    flat[name] =
      typeof param === 'string' || typeof param === 'number'
        ? param
        : renderSyncParam(param, DEFAULT_LOCALE)
  }
  return { key, params: flat }
}

// ── Prefixed fields ───────────────────────────────────────────────────

/**
 * A message flattened onto a wider record under a field name of its own:
 * `reason` / `reasonKey` / `reasonParams` on a sync result, `card` / `cardKey`
 * / `cardParams` on a CSV failure. The English stays where every existing
 * reader looks for it; the key and params ride beside it, named after it.
 */
export type PrefixedMessage<P extends string> = { [K in P]?: string } & {
  [K in `${P}Key`]?: MessageKey
} & { [K in `${P}Params`]?: SyncMessageParams }

/** A message's fields under `prefix`, ready to spread into a record. */
export function prefixedFields<P extends string>(
  prefix: P,
  message: SyncMessage,
): PrefixedMessage<P> {
  // Computed keys erase the template-literal types; the shape is exactly
  // `PrefixedMessage<P>` by construction.
  const fields: Record<string, string | SyncMessageParams> = { [prefix]: message.message }
  if (message.messageKey !== undefined) fields[`${prefix}Key`] = message.messageKey
  if (message.messageParams !== undefined) fields[`${prefix}Params`] = message.messageParams
  return fields as PrefixedMessage<P>
}

/** The message stored under `prefix`, or `undefined` when the record carries none. */
export function prefixedMessage<P extends string>(
  prefix: P,
  // Any object — a typed `PrefixedMessage<P>`, or a body read off the wire.
  record: object,
): SyncMessage | undefined {
  const fields = record as Record<string, unknown>
  const text = fields[prefix]
  if (typeof text !== 'string') return undefined
  const message: SyncMessage = { message: text }
  // Kept even when this surface does not know the key (a newer server's):
  // `renderSyncMessage` checks it, and falls back to the English.
  const key = fields[`${prefix}Key`]
  if (typeof key === 'string') message.messageKey = key as MessageKey
  // Params off the wire are an object of params or nothing: an array or a
  // scalar in their place is dropped, and the key then renders only if it
  // needs none.
  const params = fields[`${prefix}Params`]
  if (isRecord(params)) message.messageParams = params as SyncMessageParams
  return message
}

/**
 * The message triple a response body carries, read off untyped JSON with its
 * params kept as they came (nested or flat) — or `null` when the body has no
 * `message` string. The key is kept on trust: {@link renderSyncMessage} checks
 * every key in the tree and falls back to the English for one it does not know.
 */
export function readSyncMessage(raw: unknown): SyncMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  return prefixedMessage('message', raw as PrefixedMessage<'message'>) ?? null
}

/**
 * The `reason` a per-item sync result carries, in the shape the JSON report
 * keeps: the English `reason` every existing reader reads, plus `reasonKey` /
 * `reasonParams`.
 */
export type SyncReasonFields = PrefixedMessage<'reason'>

/** A result's reason fields, from the message. */
export function reasonFields(reason: SyncMessage): SyncReasonFields {
  return prefixedFields('reason', reason)
}

/** A result's reason as a message, or `undefined` when it has none. */
export function reasonMessage(fields: SyncReasonFields): SyncMessage | undefined {
  return prefixedMessage('reason', fields)
}
