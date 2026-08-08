/**
 * The message half of every admin API response, and the one way to build it.
 *
 * The admin HTTP API is Ritual's client-neutral surface: the admin SPA renders
 * these responses as alerts, and the MCP server dispatches the *same* handlers
 * in-process, where an agent reads `message` and expects English. Rather than
 * negotiate a language per client, the shape is widened once (plan §7.7):
 *
 * - `message` — rendered **English**, byte for byte what it has always been.
 *   MCP, `curl`, and scripts see no change, ever.
 * - `messageKey` + `messageParams` — the same sentence unrendered, so a client
 *   that has a translator can render it in the reader's locale. `useApiAction`
 *   prefers this pair, which is why switching language relabels alerts that are
 *   already on screen without a round trip.
 *
 * A handler that has no catalog entry for its prose simply omits the pair; the
 * English `message` is still there and the client still renders it. Conversion
 * is therefore incremental and never a wire break.
 *
 * Browser-safe: the SPA imports {@link renderApiMessage} from here, so nothing
 * in this module may reach for `node:`.
 */

import { DEFAULT_LOCALE } from '../../i18n/runtime'
import {
  paramsOf,
  tIn,
  type RenderParams,
  type TranslateArgs,
  type TranslateDynamicFn,
} from '../../i18n/t'
import type { MessageKey } from '../../i18n/messages/en'

/** The parameters a {@link ApiMessage.messageKey} interpolates. */
export type ApiMessageParams = RenderParams

/**
 * User-facing prose on a response: rendered English, plus the key and params it
 * was rendered from when the handler has one.
 */
export type ApiMessage = {
  /** Rendered English. Always present — the field every existing client reads. */
  message: string
  /** The catalog key `message` was rendered from, when the prose is localizable. */
  messageKey?: MessageKey
  /** The parameters that key interpolates. Absent for a message that takes none. */
  messageParams?: ApiMessageParams
}

/**
 * The shared admin response envelope: did it work, and what to tell the user.
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
 * Narrow a wider value down to just its message triple.
 *
 * Handlers thread a refusal around as an outcome object — status, flags, and
 * the message together — and the response body must carry only the message
 * half. Spreading the outcome instead is how `ok` and `status` end up on the
 * wire, so the projection is written once here rather than at each `return`.
 */
export function pickMessage(source: ApiMessage): ApiMessage {
  const { message, messageKey, messageParams } = source
  const picked: ApiMessage = { message }
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
