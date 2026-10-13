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

import { isFlatParams, type ApiMessage } from '../api/result'
import { renderSyncMessage, type SyncMessage } from '../sync/message'
import { CardCommandError, ExitCode } from '../util/errors'

/** A parser's refusal as a usage error (exit 2), worded in the CLI's language. */
export function apiRefusalError(refusal: ApiMessage | SyncMessage): CardCommandError {
  const key = refusal.messageKey
  if (key === undefined) {
    return new CardCommandError('usage_error', refusal.message, ExitCode.UsageError)
  }
  const params = refusal.messageParams
  // The error envelope's params are flat; a nested message keeps its key and
  // drops params it could not carry (the rendered `message` has them all).
  const flat = params === undefined || !isFlatParams(params) ? undefined : params
  return new CardCommandError(
    'usage_error',
    renderSyncMessage(refusal),
    ExitCode.UsageError,
    undefined,
    flat === undefined ? { key } : { key, params: flat },
  )
}
