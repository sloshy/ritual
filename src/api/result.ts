/**
 * The message half of every API response, and the one way to build it.
 *
 * The HTTP API is Ritual's client-neutral surface: the admin SPA renders
 * these responses as alerts, and the MCP server dispatches the *same* handlers
 * in-process, where an agent reads `message` and expects English. Rather than
 * negotiate a language per client, the shape is widened once:
 *
 * - `message` — rendered **English**, byte for byte what it has always been.
 *   MCP, `curl`, and scripts see no change, ever.
 * - `messageKey` + `messageParams` — the same sentence unrendered, so a client
 *   that has a translator can render it in the reader's locale. The admin SPA
 *   holds the triple (an {@link ApiActionMessage}) and renders it through
 *   `renderSyncMessage`, which prefers the pair and falls back to the English
 *   for a key it does not know — which is why switching language relabels
 *   alerts that are already on screen without a round trip. A few responses
 *   nest their params (a sync message's, `src/sync/message.ts`); those are
 *   never an `ApiMessage`, and their refusals go through `nestedRefusal`.
 *
 * A refusal whose text has no catalog entry yet (an engine's, not yet
 * converted) goes through {@link plainMessage} and omits the pair; the English
 * `message` is still there and the client still renders it. Conversion is
 * therefore incremental and never a wire break.
 *
 * Browser-safe: the SPA imports {@link renderApiMessage} from here, so nothing
 * in this module may reach for `node:`.
 */

import { DEFAULT_LOCALE } from '../i18n/runtime'
import { parseEnumField } from '../util/parse-enum'
import {
  isMessageKey,
  paramsOf,
  tDynamic,
  tIn,
  type MessageTriple,
  type RenderParams,
  type TranslateArgs,
  type TranslateDynamicFn,
} from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'
import type { SyncMessage } from '../sync/message'

/** The parameters a {@link ApiMessage.messageKey} interpolates. */
export type ApiMessageParams = RenderParams

/**
 * User-facing prose on a response: rendered English, plus the key and params it
 * was rendered from when the handler has one — a {@link MessageTriple} with
 * flat params.
 */
export type ApiMessage = MessageTriple<ApiMessageParams>

/**
 * The shared API response envelope: did it work, and what to tell the user.
 *
 * Individual routes extend this with their own payload rather than returning it
 * bare — `success` is narrowed to `true` on a success arm, and the extra fields
 * (a new slug, a report, a content hash) are each route's own contract.
 */
export type ApiResult = ApiMessage & {
  success: boolean
}

/**
 * Build the message triple from a catalog key.
 *
 * The English text is rendered here, from the same catalog entry the client
 * will re-render — so the two can never say different things, and an edit to
 * the English message moves both at once. Rendered in {@link DEFAULT_LOCALE}
 * explicitly rather than the active locale: a server has no business inheriting
 * the operator's UI language into a response an agent reads.
 */
export function apiMessage<K extends MessageKey>(key: K, ...args: TranslateArgs<K>): ApiMessage {
  const params: ApiMessageParams | undefined = paramsOf(args)
  const message = tIn(DEFAULT_LOCALE, key, ...args)
  if (params === undefined) return { message, messageKey: key }
  return { message, messageKey: key, messageParams: params }
}

/**
 * The English rendering of a catalog key, alone — for a field that carries text
 * but has no room for its key: a progress note an MCP client shows, a warning in
 * a response's `warnings` array, a name the server writes into a new file. The
 * same {@link DEFAULT_LOCALE} rendering {@link apiMessage} puts in `message`.
 */
export function apiText<K extends MessageKey>(key: K, ...args: TranslateArgs<K>): string {
  return tIn(DEFAULT_LOCALE, key, ...args)
}

/**
 * {@link apiMessage} for a key chosen at **runtime** — one another module
 * already checked against its params while it still had the literal (an enum
 * refusal from `parseEnumField`, an error's `messageRef`). Rendered in
 * {@link DEFAULT_LOCALE}, so a refusal worded in the process's own locale still
 * reaches the client as English plus its key.
 */
export function apiMessageOf(key: MessageKey, params?: ApiMessageParams): ApiMessage {
  const message = tDynamic(DEFAULT_LOCALE, key, params)
  if (params === undefined) return { message, messageKey: key }
  return { message, messageKey: key, messageParams: params }
}

/**
 * The shared enum parser (`parseEnumField`) for a request field: the canonical
 * member, or its refusal as English plus its key. The parser words its refusal
 * in the process's own locale, which an API response must not inherit, so the
 * key is re-rendered here — the one place every route gets that right.
 */
export function parseEnumParam<T extends string>(
  raw: unknown,
  values: readonly T[],
  field: string,
): T | ApiMessage {
  const parsed = parseEnumField(raw, values, field)
  return parsed.ok ? parsed.value : apiMessageOf(parsed.messageKey, parsed.messageParams)
}

/**
 * Text with no catalog entry — an engine's refusal raised outside the catalog —
 * as a message triple with no key: clients show the text as it is.
 */
export function plainMessage(text: string): ApiMessage {
  return { message: text }
}

/**
 * The constraint for a parsed value that must be told apart from an
 * {@link ApiMessage} refusal: `unknown` (no constraint) when no member of `T`
 * declares `message`, `never` (no `T` fits) when one does — a union is checked
 * member by member. Written `T extends NotAMessage<T>`,
 * it turns the convention {@link isApiMessage} rests on into a compile error.
 */
export type NotAMessage<T> = [MessageBearingMembers<T>] extends [never] ? unknown : never

/** The members of `T` that declare a `message` — distributing over a union. */
type MessageBearingMembers<T> = T extends unknown ? ('message' extends keyof T ? T : never) : never

/**
 * Whether a value is an {@link ApiMessage} — the discriminant a request parser's
 * `T | ApiMessage` result is split on. Structural: it holds because no request
 * shape a parser returns carries a string `message`.
 */
export function isApiMessage(value: unknown): value is ApiMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

/** Whether a value is a flat params bag: every param a string or a number. */
export function isFlatParams(value: unknown): value is ApiMessageParams {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(
    (param) => typeof param === 'string' || typeof param === 'number',
  )
}

/**
 * The message triple a response body carries, read off untyped JSON — or
 * `null` when the body has no `message` string.
 *
 * A key is kept only when this surface knows it (`isMessageKey`): a server
 * ahead of (or behind) the reader may send one the catalog lacks, and rendering
 * it would print the raw key, or throw under `RITUAL_I18N_STRICT`. The English
 * `message` covers the gap, which is the fallback the design already relies on
 * for a handler that sends no key at all. So does a message whose params nest:
 * this reader is for flat `ApiMessage`s, and `readSyncMessage` for the rest.
 */
export function readApiMessage(raw: unknown): ApiMessage | null {
  if (typeof raw !== 'object' || raw === null || !('message' in raw)) return null
  if (typeof raw.message !== 'string') return null
  const read: ApiMessage = { message: raw.message }
  if (!('messageKey' in raw) || !isMessageKey(raw.messageKey)) return read
  const params = 'messageParams' in raw ? raw.messageParams : undefined
  if (params === undefined) return { ...read, messageKey: raw.messageKey }
  // Nested params (a sync message's) are not an `ApiMessage`'s: rendered flat
  // they would print `[object Object]`, so such a message keeps its English only.
  if (!isFlatParams(params)) return read
  return { ...read, messageKey: raw.messageKey, messageParams: params }
}

/**
 * Narrow a wider value down to just its message triple.
 *
 * Handlers thread a refusal around as an outcome object — status, flags, and
 * the message together — and the response body must carry only the message
 * half. Spreading the outcome instead is how `ok` and `status` end up on the
 * wire, so the projection is written once here rather than at each `return`.
 * Generic over the params, so it serves a sync message's nested params too.
 */
export function pickMessage<P>(source: MessageTriple<P>): MessageTriple<P> {
  const { message, messageKey, messageParams } = source
  const picked: MessageTriple<P> = { message }
  if (messageKey !== undefined) picked.messageKey = messageKey
  if (messageParams !== undefined) picked.messageParams = messageParams
  return picked
}

/**
 * Render a response's prose with the caller's translator — `useTDynamic()` in a
 * Solid component, so the text tracks the locale signal.
 *
 * Falls back to the server's English `message` whenever no key rode along,
 * which is what makes an unconverted handler render correctly instead of
 * rendering nothing.
 *
 * Takes the *dynamic* translator (`useTDynamic()`), not `t`: the key was chosen
 * at runtime and its parameters were checked by {@link apiMessage} at the
 * handler, while it still had the literal. `tDynamic` in `src/i18n/t.ts` is
 * where that erasure lives, once, so no consumer writes `t as unknown as …`.
 */
export function renderApiMessage(t: TranslateDynamicFn, result: ApiMessage): string {
  if (result.messageKey === undefined) return result.message
  return t(result.messageKey, result.messageParams)
}

/**
 * A status or error line held by the admin SPA (`useApiAction`, `useApiText`): either prose a caller
 * handed in already rendered, or the message triple a response carried.
 *
 * Held **unrendered**. An alert can sit on screen for minutes, so storing the
 * formatted string would freeze it in the language that was active when the
 * request came back — a locale switch would relabel the page around a stale
 * sentence. This is the same reason `useEditorStatus` stores its status as a
 * key.
 *
 * A {@link SyncMessage} rather than an `ApiMessage`: most responses carry flat
 * params, which a sync message's params include, but a summary built from
 * counted nouns (an import's "Successfully imported 'Burn' — 2 lines could not
 * be parsed…") nests them, and rendering that through `renderApiMessage` would
 * print `[object Object]`.
 */
export type ApiActionMessage = string | SyncMessage
