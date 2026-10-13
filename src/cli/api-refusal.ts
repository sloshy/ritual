/**
 * Raising an admin API parser's refusal from a CLI command.
 *
 * A few commands validate their input through the same parser an admin route
 * uses (`ritual metadata set`, `ritual set-list-image`), so the CLI and the API
 * refuse the same input with the same sentence. The parser hands back an
 * `ApiMessage` (or a `SyncMessage`, whose params may nest) — English plus its
 * key — and the CLI, unlike the API, speaks its own UI language: the key is
 * re-rendered here, in the active locale, and rides on the error so
 * `--output json` keeps the locale-invariant `messageKey`.
 */

import type { ApiMessage } from '../api/result'
import { DEFAULT_LOCALE } from '../i18n/runtime'
import type { MessageRef, RenderParams } from '../i18n/t'
import { renderSyncMessage, renderSyncParam, type SyncMessage } from '../sync/message'
import { CardCommandError, ExitCode } from '../util/errors'

/**
 * The `--output json` envelope's `messageKey`/`messageParams` for a message, or
 * `undefined` when it has no key. The envelope's params are flat strings and
 * numbers, so a nested param — a message inside the message, a list, a duration
 * — is flattened to its **English** rendering: locale-invariant like the key, and
 * enough for a client to re-render the key whole (the same convention as
 * `import-changes --output json`).
 */
export function envelopeRef(message: ApiMessage | SyncMessage): MessageRef | undefined {
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

/** A parser's refusal as a usage error (exit 2), worded in the CLI's language. */
export function apiRefusalError(refusal: ApiMessage | SyncMessage): CardCommandError {
  const ref = envelopeRef(refusal)
  if (ref === undefined) {
    return new CardCommandError('usage_error', refusal.message, ExitCode.UsageError)
  }
  return new CardCommandError(
    'usage_error',
    renderSyncMessage(refusal),
    ExitCode.UsageError,
    undefined,
    ref,
  )
}
